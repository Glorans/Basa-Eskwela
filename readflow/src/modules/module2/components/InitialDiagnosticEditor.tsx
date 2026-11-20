import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  EMPTY_QUESTION,
  LANGUAGE_LABELS,
  activateInitialVersion,
  changeVersionStatus,
  createPackageVersion,
  deletePackageDraft,
  returnToBuiltInInitial,
  savePackageDraft,
  toEditableContent,
  AssessmentPackageRequestError,
  type ChoiceId,
  type PackageContent,
  type PackageDetail,
  type PackageSummary,
  type QuestionType,
  type VersionDetail,
} from "../services/assessmentPackages";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import { useAssessmentLeaveGuard } from "../hooks/useAssessmentLeaveGuard";
import { PASSAGE_LIMITS, assessmentRequirements, passageStats, passageToText, textToPassage } from "../services/assessmentEditor";
import { INITIAL_STATUS_LABELS as STATUS_LABELS, initialAssessmentName, versionStateLabel } from "../utils/initialDiagnosticLabels";
import AssessmentPreviewDialog from "./AssessmentPreviewDialog";
import "./InitialDiagnosticEditor.css";

/**
 * M2 F6 + F7: the System Admin's Initial Diagnostic editor (English and Filipino), at the existing package route.
 * Workflow: Create or Edit -> Save Draft -> Preview -> Publish Version -> Try Assessment. Activation for learners
 * stays a separate, confirmed action. Submitted, approved, published and retired versions are never edited:
 * a change always starts a new draft version (the database enforces this as well).
 * One action bar, shown on every tab, carries the actions for the selected version.
 */
export const INITIAL_LIST_PATH = "/system-admin/assessment/initial";
const PACKAGE_PATH = "/system-admin/assessment-packages";
const OPEN = new Set(["draft", "in_review", "approved"]);
const CHOICES: ChoiceId[] = ["a", "b", "c", "d"];
const TYPES: { value: QuestionType; label: string }[] = [
  { value: "literal", label: "Literal" },
  { value: "inferential", label: "Inferential" },
  { value: "critical", label: "Critical" },
];
const TABS = ["Overview and Versions", "Reading Passage", "Comprehension Questions"];
const words = (paragraphs: string[]) => paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "");
const message = (e: unknown) => e instanceof AssessmentPackageRequestError ? [e.message, ...e.issues].join("\n")
  : e instanceof Error ? e.message : "Unable to complete the request.";
/**
 * F7 Try Assessment for the SELECTED version: the built-in 3.0 uses the built-in practice; a published authored version
 * (or the authored version learners take) is practised with its own content. Drafts and other versions: preview only.
 */
export function tryAssessment(pkg: PackageSummary, v: VersionDetail): { to: string } | { reason: string } {
  if (v.source === "code_import") return v.versionLabel === "3.0" ? { to: `/practice/diagnostic/${pkg.language}/reading` } : { reason: "This built-in version cannot be practised." };
  if (v.status === "published" || v.activeForLearners) return { to: `/practice/diagnostic/version/${v.id}/${pkg.language}/reading` };
  if (v.status === "retired") return { reason: "Retired versions cannot be practised." };
  return { reason: "Publish this version to try it. Drafts can be previewed only." };
}

/**
 * Activate for Learners always acts on the SELECTED version:
 *   the version learners take now      -> "Already Active" (disabled)
 *   built-in 3.0, another one active    -> enabled; uses the existing, authorised return-to-built-in action
 *   a published authored version         -> enabled when the server marks it eligible
 *   a retired authored version           -> disabled (only the published version can be activated)
 *   drafts, in review, approved          -> not offered
 */
export function activationState(pkg: PackageSummary, v: VersionDetail):
  { kind: "none" } | { kind: "active" } | { kind: "activate"; enabled: boolean; reason: string; builtIn: boolean } {
  const activation = pkg.activation;
  if (!activation?.canManage) return { kind: "none" };
  if (v.activeForLearners) return { kind: "active" };
  if (!activation.available) return { kind: "activate", enabled: false, reason: "Activation is not installed in this database.", builtIn: false };
  if (v.source === "code_import") {
    return v.versionLabel === "3.0" && activation.activeVersionId
      ? { kind: "activate", enabled: true, reason: "", builtIn: true }
      : { kind: "activate", enabled: false, reason: "This built-in version cannot be activated.", builtIn: true };
  }
  if (v.status === "retired") return { kind: "activate", enabled: false, reason: "Only the published version can be activated.", builtIn: false };
  if (v.status !== "published") return { kind: "none" };
  // No educator endorsement is required for the initial diagnostic (approved 2026-11-20); the server decides eligibility.
  return v.canActivate ? { kind: "activate", enabled: true, reason: "", builtIn: false }
    : { kind: "activate", enabled: false, reason: "This version cannot be activated.", builtIn: false };
}

export default function InitialDiagnosticEditor({ detail, siblings, onDetail }: {
  detail: PackageDetail; siblings: PackageSummary[]; onDetail: (detail: PackageDetail) => void;
}) {
  const pkg = detail.package;
  const versions = detail.versions;
  const [selectedId, setSelectedId] = useState("");
  const selected = versions.find((v) => v.id === selectedId) ?? versions.find((v) => OPEN.has(v.status)) ?? versions[0];
  const draft = versions.find((v) => v.status === "draft");
  const open = versions.find((v) => OPEN.has(v.status));
  const published = versions.find((v) => v.status === "published");
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState<PackageContent>(() => toEditableContent(selected?.content ?? { passageTitle: "", paragraphs: [], questions: [] }));
  const [story, setStory] = useState(() => passageToText(selected?.content.paragraphs ?? []));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<null | "passage" | "questions">(null);
  const [publishing, setPublishing] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [statement, setStatement] = useState("");
  useAssessmentLeaveGuard(dirty || busy || Boolean(statement.trim()));

  // Show the selected version's saved content whenever it changes and nothing unsaved would be lost.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (dirtyRef.current || !selected) return;
    setContent(toEditableContent(selected.content));
    setStory(passageToText(selected.content.paragraphs));
  }, [selected?.id, selected?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected) return <p className="m2-packages-empty">This initial diagnostic has no versions yet.</p>;
  const perms = pkg.permissions;
  const isDraft = selected.status === "draft";
  const editable = editing && isDraft && perms.manage;
  const shown = editable ? content : selected.content;
  const requirements = assessmentRequirements(content);
  const stats = passageStats(content.paragraphs);
  const saveReason = editable && stats.saveIssues.length ? "Fix the passage limits above before saving." : "";
  // Missing requirements for the WHOLE version: the editor's checks plus the database's own validation of the saved draft.
  const blockers = isDraft ? [...new Set([...requirements, ...selected.issues])] : [];
  const canPublishFlow = perms.manage && perms.review && perms.publish && OPEN.has(selected.status);
  const publishReason = busy ? "Please wait." : dirty ? "Save your changes before publishing." : blockers.length
    ? `${blockers.length} requirement${blockers.length === 1 ? "" : "s"} missing.` : "";
  const activeVersion = versions.find((v) => v.activeForLearners);
  const learnersTake = activeVersion?.versionLabel ?? pkg.activeVersion ?? "3.0";
  const activation = activationState(pkg, selected);

  /** One request at a time: the ref blocks a second click before React re-renders the disabled button. */
  const guarded = async <T,>(work: () => Promise<T>) => {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try { return await work(); }
    catch (e) { setError(message(e)); return null; }
    finally { inFlight.current = false; setBusy(false); }
  };
  const run = async (work: () => Promise<PackageDetail>, done: string) => guarded(async () => {
    const next = await work(); onDetail(next); setNotice(done); return next;
  });
  const guardUnsaved = async () => !dirty || await confirmReadFlow("Discard your unsaved changes?", { confirm: "Discard Changes", cancel: "Keep Editing" });
  const discard = () => { setDirty(false); setContent(toEditableContent(selected.content)); setStory(passageToText(selected.content.paragraphs)); };
  const choose = async (id: string) => {
    if (busy || id === selected.id || !await guardUnsaved()) return;
    setDirty(false); setEditing(false); setShowMissing(false); setSelectedId(id); setError(""); setNotice("");
  };
  const update = (next: PackageContent) => { setContent(next); setDirty(true); };
  const setQuestion = (index: number, patch: Partial<PackageContent["questions"][number]>) =>
    update({ ...content, questions: content.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });

  const createVersion = async () => {
    if (!await guardUnsaved()) return;
    const next = await run(() => createPackageVersion(pkg.id, { basedOnVersionId: selected.id }),
      `New draft created from version ${selected.versionLabel}. Version ${selected.versionLabel} is unchanged.`);
    const created = next?.versions.find((v) => v.status === "draft");
    if (created) { setDirty(false); setSelectedId(created.id); setEditing(true); setTab((t) => (t === 0 ? 1 : t)); }
  };
  const editDraft = async () => {
    if (!isDraft || !perms.manage) return;
    setEditing(true);
    setTab((t) => (t === 0 ? 1 : t));
  };
  const doneEditing = async () => { if (await guardUnsaved()) { discard(); setEditing(false); } };
  const save = async () => { if (saveReason) return; if (await run(() => savePackageDraft(pkg.id, selected.id, content), "Draft saved.")) setDirty(false); };
  const removeDraft = async () => {
    if (!await confirmReadFlow(`Delete draft version ${selected.versionLabel}? This cannot be undone.`, { confirm: "Delete Draft" })) return;
    if (await run(() => deletePackageDraft(pkg.id, selected.id), "Draft deleted.")) { setDirty(false); setEditing(false); setSelectedId(""); }
  };
  const openPublish = () => {
    if (busy || dirty) { setError("Save your changes before publishing."); return; }
    if (blockers.length) { setShowMissing(true); return; }
    setPublishing(true);
  };

  /** Publish Version = the existing submit -> approve -> publish steps for the whole version (passage and questions
   *  together), performed by this System Admin in order. The approval statement is their own words. */
  const publish = async () => {
    const note = statement.trim();
    if (dirty || (selected.status !== "approved" && !note)) return;
    let status = selected.status;
    const ok = await guarded(async () => {
      try {
        if (status === "draft") { onDetail(await changeVersionStatus(pkg.id, selected.id, "submit")); status = "in_review"; }
        if (status === "in_review") { onDetail(await changeVersionStatus(pkg.id, selected.id, "approve", { attestation: note })); status = "approved"; }
        if (status === "approved") onDetail(await changeVersionStatus(pkg.id, selected.id, "publish"));
        return true;
      } catch (e) {
        throw new Error(`${message(e)}${status !== selected.status ? `\nVersion ${selected.versionLabel} is now "${STATUS_LABELS[status]}". Press Publish Version to continue.` : ""}`);
      }
    });
    setPublishing(false);
    if (ok) {
      setStatement(""); setEditing(false);
      setNotice(`Version ${selected.versionLabel} is published. Active: Version ${learnersTake} (unchanged).`);
    }
  };
  const returnToDraft = async () => {
    if (!await confirmReadFlow(`Return version ${selected.versionLabel} to an editable draft?`)) return;
    await run(() => changeVersionStatus(pkg.id, selected.id, "return", { note: "Returned to draft by the System Admin for more edits." }), "Returned to draft.");
  };
  /** Activates the SELECTED version. The built-in 3.0 is activated through the existing return-to-built-in action. */
  const activate = async () => {
    if (busy || dirty || activation.kind !== "activate" || !activation.enabled) return;
    const languageName = LANGUAGE_LABELS[pkg.language];
    const label = activation.builtIn ? `${selected.versionLabel} (built-in)` : selected.versionLabel;
    if (!await confirmReadFlow(`Activate ${languageName} version ${label} for new learners? It replaces the active version ${learnersTake} for new ${languageName} learners. Learners who already completed the initial diagnostic keep their result and are not asked to retake it. Learners who already started keep the version they started for up to 24 hours.`, { confirm: "Activate" })) return;
    const expected = pkg.activation?.activeVersionId ?? null;
    await run(() => (activation.builtIn ? returnToBuiltInInitial(pkg.id, expected) : activateInitialVersion(pkg.id, selected.id, expected)),
      `${languageName} version ${label} is now the active version for new learners.`);
  };
  const practice = tryAssessment(pkg, selected);

  const reason = (id: string, text: string) => (text ? <span id={id} className="m2-id-reason">{text}</span> : null);

  /**
   * The SAME six actions, in the SAME order and positions, for every selected version in both languages. An action
   * that does not apply stays in place, greyed out (aria-disabled, still reachable by keyboard) with a short reason.
   */
  type Slot = { key: string; label: string; enabled: boolean; reason: string; onClick?: () => void; to?: string; primary?: boolean; pressed?: boolean; extra?: ReactNode };
  const languageName = LANGUAGE_LABELS[pkg.language];
  const off = (why: string) => ({ enabled: false, reason: why });
  const on = (onClick: () => void) => ({ enabled: true, reason: "", onClick });
  const wait = busy ? off("Please wait.") : null;
  const notDraftReason = selected.status === "published" ? "Published versions cannot be edited."
    : selected.status === "retired" ? "Retired versions cannot be edited." : "Submitted versions cannot be edited.";
  const slots: Slot[] = [
    { key: "create", label: "Create New Version", ...(!perms.manage ? off("You cannot create versions.")
      : isDraft ? off("This version is already a draft.")
      : open ? off(open.status === "draft" ? `Draft ${open.versionLabel} already exists.` : `Version ${open.versionLabel} is being published.`)
      : wait ?? on(() => void createVersion())) },
    { key: "edit", label: "Edit Draft", pressed: editable, ...(!perms.manage ? off("You cannot edit this version.")
      : !isDraft ? off(notDraftReason) : editable ? off("Editing now.") : wait ?? on(() => void editDraft())) },
    { key: "preview", label: "Preview", ...on(() => setPreview("passage")) },
    { key: "publish", label: "Publish Version", primary: true,
      ...(!canPublishFlow ? off(selected.status === "published" ? "Already published."
          : selected.status === "retired" ? "Retired versions cannot be published again." : "You cannot publish this version.")
        : publishReason ? off(publishReason) : on(openPublish)),
      extra: canPublishFlow && blockers.length > 0 && !dirty
        ? <button type="button" className="m2-id-link" aria-expanded={showMissing} aria-controls="m2-id-missing"
            onClick={() => setShowMissing((v) => !v)}>{showMissing ? "Hide" : "What's missing?"}</button> : undefined },
    activation.kind === "active"
      ? { key: "activate", label: "Already Active", ...off(`This is the active version for new ${languageName} learners.`) }
      : { key: "activate", label: "Activate for Learners", primary: true,
          ...(activation.kind === "none" ? off(pkg.activation?.canManage ? "Publish this version before activating it." : "You cannot activate versions.")
            : !activation.enabled ? off(activation.reason) : dirty ? off("Save or discard your changes first.") : wait ?? on(() => void activate())) },
    { key: "try", label: "Try Assessment", ...("to" in practice ? { enabled: true, reason: "", to: practice.to } : off(practice.reason)) },
  ];
  const actionBar = (
    <div className="m2-id-bar" role="region" aria-label="Version actions">
      <div className="m2-id-bar-status">
        <span className="m2-id-chip m2-id-chip--selected">Selected: Version {selected.versionLabel} · {versionStateLabel(selected.status, selected.activeForLearners)}</span>
        <span className="m2-id-chip">{selected.activeForLearners ? "Active Version" : `Active: Version ${learnersTake}`}</span>
      </div>
      {error && <div role="alert" className="m2-id-bar-error m2-editor-message">{error}</div>}
      {notice && !error && <p role="status" className="m2-id-bar-notice">{notice}</p>}
      {showMissing && blockers.length > 0 && <div className="m2-id-missing" role="status" id="m2-id-missing">
        <p>Before publishing version {selected.versionLabel}:</p>
        <ul>{blockers.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      </div>}
      {editable && <div className="m2-id-edit-row" aria-label="Editing">
        <span className="m2-id-chip" role="status">{busy ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>
        <span className="m2-id-action"><button type="button" disabled={busy || !dirty || Boolean(saveReason)} aria-describedby={saveReason ? "m2-id-save-reason" : undefined}
          onClick={() => void save()}>Save Draft</button>{reason("m2-id-save-reason", saveReason)}</span>
        <button type="button" disabled={busy} onClick={() => void doneEditing()}>{dirty ? "Cancel Editing" : "Done Editing"}</button>
      </div>}
      <div className="m2-id-slots">
        {slots.map((slot) => {
          const reasonId = `m2-id-slot-${slot.key}-reason`;
          return <div key={slot.key} className="m2-id-slot" data-slot={slot.key}>
            {slot.to && slot.enabled
              ? <Link className="m2-id-button" to={slot.to} state={{ practiceExitTo: `${PACKAGE_PATH}/${pkg.id}` }}>{slot.label}</Link>
              : <button type="button" className={slot.primary && slot.enabled ? "m2-id-primary" : undefined}
                  aria-disabled={slot.enabled ? undefined : true} aria-pressed={slot.key === "edit" ? Boolean(slot.pressed) : undefined}
                  aria-describedby={slot.reason ? reasonId : undefined}
                  onClick={() => { if (slot.enabled) slot.onClick?.(); }}>{slot.label}</button>}
            <span id={reasonId} className="m2-id-slot-reason">{slot.reason}</span>
            {slot.extra}
          </div>;
        })}
      </div>
    </div>
  );

  return (
    <main className="m7-page m2-packages-page m2-id-page">
      <Link className="m3-back-link" to={INITIAL_LIST_PATH}><ArrowLeft size={17} aria-hidden="true" /> Back to Initial Diagnostic</Link>
      <header className="m2-id-header">
        <h1>{initialAssessmentName(pkg.language)}</h1>
        <nav className="m2-language-tabs" aria-label="Diagnostic language">
          {(["en", "fil"] as const).map((language) => {
            const sibling = siblings.find((p) => p.language === language && !p.archived);
            return <Link key={language} aria-current={pkg.language === language ? "page" : undefined}
              to={sibling ? `${PACKAGE_PATH}/${sibling.id}` : INITIAL_LIST_PATH}>{LANGUAGE_LABELS[language]}</Link>;
          })}
        </nav>
        <dl className="m2-id-facts">
          <div><dt>Active version</dt><dd>Version {learnersTake}</dd></div>
          <div><dt>Published version</dt><dd>{published ? `Version ${published.versionLabel}` : "None"}</dd></div>
          <div><dt>Draft version</dt><dd>{draft ? `Version ${draft.versionLabel}` : "None"}</dd></div>
        </dl>
        <label className="m2-id-select">Selected version
          <select disabled={busy} value={selected.id} onChange={(e) => void choose(e.target.value)}>
            {versions.map((v) => <option key={v.id} value={v.id}>Version {v.versionLabel} — {versionStateLabel(v.status, v.activeForLearners)}</option>)}
          </select>
        </label>
      </header>

      <div className="m2-editor-tabs m2-id-tabs" role="tablist" aria-label="Initial diagnostic sections">
        {TABS.map((label, i) => <button key={label} type="button" role="tab" id={`m2-id-tab-${i}`} aria-controls={`m2-id-panel-${i}`}
          aria-selected={tab === i} tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)} onKeyDown={(e) => {
            const next = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : null;
            if (next !== null) { e.preventDefault(); setTab(next); document.getElementById(`m2-id-tab-${next}`)?.focus(); }
          }}>{label}</button>)}
      </div>

      <section role="tabpanel" id="m2-id-panel-0" aria-labelledby="m2-id-tab-0" hidden={tab !== 0} className="m2-packages-panel">
        <div className="m2-id-version-head">
          <h2>Version {selected.versionLabel}</h2>
          <span className="m2-packages-status" data-status={selected.status}>{STATUS_LABELS[selected.status]}</span>
          {selected.activeForLearners && <span className="m2-packages-tag m2-id-active-tag">Active</span>}
          {selected.source === "code_import" && <span className="m2-packages-tag">Built-in</span>}
        </div>
        <dl className="m2-id-facts m2-id-version-facts">
          <div><dt>Assessment</dt><dd>{initialAssessmentName(pkg.language)}</dd></div>
          <div><dt>Passage title</dt><dd>{shown.passageTitle || "Untitled passage"}</dd></div>
          <div><dt>Content</dt><dd>{words(shown.paragraphs)} words · {shown.questions.length} questions</dd></div>
        </dl>
        {canPublishFlow && blockers.length > 0 && <div className="m2-packages-issues" role="status"><p>Before publishing version {selected.versionLabel}:</p>
          <ul>{blockers.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        {open && open.id !== selected.id && <p className="m2-id-open-draft">
          <button type="button" className="m2-id-link" disabled={busy} onClick={() => void choose(open.id)}>
            {open.status === "draft" ? `Open Existing Draft ${open.versionLabel}` : `Open Version ${open.versionLabel} (being published)`}</button>
        </p>}
        {((isDraft && perms.manage) || (selected.status === "in_review" && perms.review)) && <div className="m2-id-danger-zone" aria-label="Draft clean-up">
          {isDraft && perms.manage && <button type="button" className="m2-packages-danger" disabled={busy} onClick={() => void removeDraft()}>Delete Draft</button>}
          {selected.status === "in_review" && perms.review && <button type="button" disabled={busy} onClick={() => void returnToDraft()}>Return to Draft</button>}
        </div>}
        <h3>Versions</h3>
        <table className="m2-id-versions">
          <thead><tr><th scope="col">Version</th><th scope="col">Passage title</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col"><span className="diagnostic-visually-hidden">Select</span></th></tr></thead>
          <tbody>{versions.map((v) => <tr key={v.id} aria-current={v.id === selected.id ? "true" : undefined}>
            <td>{v.versionLabel}</td>
            <td>{v.content.passageTitle || "Untitled passage"}</td>
            <td><span className="m2-packages-status" data-status={v.status}>{STATUS_LABELS[v.status]}</span>
              {v.activeForLearners && <span className="m2-packages-tag m2-id-active-tag">Active</span>}</td>
            <td>{formatDate(v.createdAt)}</td>
            <td>{v.id === selected.id ? <span className="m2-packages-meta">Selected</span>
              : <button type="button" disabled={busy} onClick={() => void choose(v.id)}>Select</button>}</td>
          </tr>)}</tbody>
        </table>
      </section>

      <section role="tabpanel" id="m2-id-panel-1" aria-labelledby="m2-id-tab-1" hidden={tab !== 1} className="m2-packages-panel">
        <div className="m2-id-version-head"><h2>Reading Passage</h2><span className="m2-packages-meta">Version {selected.versionLabel} · {STATUS_LABELS[selected.status]}</span></div>
        <div className="m2-id-actions"><button type="button" onClick={() => setPreview("passage")}>Preview Reading Passage</button></div>
        {editable ? <fieldset disabled={busy} className="m2-editor-fields">
          <label>Passage Title<input value={content.passageTitle} maxLength={200} onChange={(e) => update({ ...content, passageTitle: e.target.value })} /></label>
          <p id="m2-id-story-limits" className="m2-id-limits">Allowed length: {PASSAGE_LIMITS.minWords}–{PASSAGE_LIMITS.maxWords} words · up to {PASSAGE_LIMITS.maxParagraphs} paragraphs
            · up to {PASSAGE_LIMITS.maxParagraphChars.toLocaleString("en-US")} characters per paragraph. Type or paste the whole story; leave a blank line between paragraphs.</p>
          <label>Reading Passage<textarea rows={14} value={story} aria-describedby="m2-id-story-limits m2-id-story-count" onChange={(e) => {
            setStory(e.target.value); update({ ...content, paragraphs: textToPassage(e.target.value, selected.content.paragraphs) });
          }} /></label>
          <div id="m2-id-story-count" className="m2-id-counter" data-state={stats.wordState} role="status" aria-live="polite">
            <strong>{stats.words} / {PASSAGE_LIMITS.maxWords} words</strong>
            <span>{stats.wordState === "below" ? `Below the minimum of ${PASSAGE_LIMITS.minWords} words`
              : stats.wordState === "over" ? `Over the maximum of ${PASSAGE_LIMITS.maxWords} words` : "Within the accepted range"}</span>
            <span>{stats.paragraphs} / {PASSAGE_LIMITS.maxParagraphs} paragraphs</span>
          </div>
          {stats.issues.length > 0 && <ul className="m2-id-passage-issues">{stats.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        </fieldset> : <div className="m2-editor-story">
          <h3>{shown.passageTitle || "Untitled passage"}</h3>
          {shown.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          <p className="m2-packages-meta">{words(shown.paragraphs)} words · {shown.paragraphs.filter((p) => p.trim()).length} paragraphs · Read-only version</p>
        </div>}
      </section>

      <section role="tabpanel" id="m2-id-panel-2" aria-labelledby="m2-id-tab-2" hidden={tab !== 2} className="m2-packages-panel">
        <div className="m2-id-version-head"><h2>Comprehension Questions</h2><span className="m2-packages-meta">Version {selected.versionLabel} · {STATUS_LABELS[selected.status]}</span></div>
        <p className="m2-packages-meta">{shown.questions.length} questions · {TYPES.map((t) => `${t.label} ${shown.questions.filter((q) => q.type === t.value).length}`).join(" · ")}</p>
        <div className="m2-id-actions"><button type="button" disabled={shown.questions.length === 0} onClick={() => setPreview("questions")}>Preview Questions</button></div>
        {editable && (content.questions.length < 5 || content.questions.length > 8) && <p role="status" className="m2-packages-meta">Use 5 to 8 questions, with at least one literal, inferential and critical question.</p>}
        <div className="m2-id-questions">
          {shown.questions.map((q, i) => <details key={q.id || i} className="m2-editor-question">
            <summary>Question {i + 1} — {TYPES.find((t) => t.value === q.type)?.label ?? "Choose a type"}<span className="m2-editor-question-preview">{q.prompt || "New question"}</span></summary>
            {editable ? <fieldset disabled={busy} className="m2-editor-fields"><legend className="diagnostic-visually-hidden">Question {i + 1}</legend>
              <label>Question type<select value={q.type} onChange={(e) => setQuestion(i, { type: e.target.value as QuestionType })}>
                <option value="">Choose a type</option>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
              <label>Question text<textarea rows={2} value={q.prompt} maxLength={500} onChange={(e) => setQuestion(i, { prompt: e.target.value })} /></label>
              {CHOICES.map((id) => <div className="m2-packages-choice" key={id}>
                <label className="m2-packages-correct"><input type="radio" name={`m2-id-correct-${selected.id}-${q.id || i}`} checked={q.correctChoiceId === id}
                  onChange={() => setQuestion(i, { correctChoiceId: id })} />Correct answer {id.toUpperCase()}</label>
                <label>Choice {id.toUpperCase()}<input maxLength={300} value={q.choices.find((c) => c.id === id)?.label ?? ""}
                  onChange={(e) => setQuestion(i, { choices: q.choices.map((c) => (c.id === id ? { ...c, label: e.target.value } : c)) })} /></label>
              </div>)}
              <button type="button" className="m2-packages-danger" onClick={async () => {
                if (await confirmReadFlow(`Remove question ${i + 1}? Save Draft to keep this change.`, { confirm: "Remove Question" })) {
                  update({ ...content, questions: content.questions.filter((_, j) => j !== i) });
                }
              }}>Remove Question</button>
            </fieldset> : <ul className="m2-packages-choices">{q.choices.map((c) => <li key={c.id} data-correct={c.id === q.correctChoiceId ? "true" : undefined}>
              {c.id.toUpperCase()}. {c.label}{c.id === q.correctChoiceId ? " (correct answer)" : ""}</li>)}</ul>}
          </details>)}
        </div>
        {editable && <button type="button" className="m2-editor-add" disabled={busy || content.questions.length >= 8}
          onClick={() => update({ ...content, questions: [...content.questions, { ...EMPTY_QUESTION(), id: `new-${Date.now()}` }] })}>+ Add Question</button>}
      </section>

      {actionBar}

      {preview && <AssessmentPreviewDialog content={shown} language={pkg.language} start={preview} onClose={() => setPreview(null)} />}
      {publishing && <PublishDialog version={selected} questionCount={selected.content.questions.length}
        replaces={published && published.id !== selected.id ? published.versionLabel : null}
        needsStatement={selected.status !== "approved"} statement={statement} busy={busy} onStatement={setStatement}
        onCancel={() => { setPublishing(false); setStatement(""); }} onConfirm={() => void publish()} />}
    </main>
  );
}

function PublishDialog({ version, questionCount, replaces, needsStatement, statement, busy, onStatement, onCancel, onConfirm }: {
  version: VersionDetail; questionCount: number; replaces: string | null; needsStatement: boolean; statement: string; busy: boolean;
  onStatement: (value: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && typeof d.showModal === "function" && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} className="m2-id-dialog" aria-labelledby="m2-id-publish-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (!busy) onConfirm(); }}>
        <h2 id="m2-id-publish-title">Publish Version {version.versionLabel}?</h2>
        <p>This publishes the whole version: the reading passage and all {questionCount} comprehension questions together.
          {replaces ? ` The current published version ${replaces} becomes Retired.` : ""} Publishing does not change the Active version: learners are not affected until a version is activated.</p>
        {needsStatement && <label>Publishing note (required)
          <textarea rows={3} maxLength={2000} value={statement} placeholder="What you checked, for example: passage, questions and answer keys."
            onChange={(e) => onStatement(e.target.value)} /></label>}
        {needsStatement && <p className="m2-packages-meta">Saved with this version, with your name as the approver.</p>}
        <div className="m2-id-dialog-actions">
          <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="m2-id-primary" disabled={busy || (needsStatement && !statement.trim())}>{busy ? "Publishing…" : "Publish Version"}</button>
        </div>
      </form>
    </dialog>
  );
}
