import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  EMPTY_QUESTION,
  LANGUAGE_LABELS,
  REVIEW_CHECK_LABELS,
  archiveAssessmentPackage,
  changeVersionStatus,
  createPackageVersion,
  deletePackageDraft,
  renameAssessmentPackage,
  savePackageDraft,
  toEditableContent,
  AssessmentPackageRequestError,
  type ChoiceId,
  type PackageContent,
  type PackageDetail,
  type QuestionType,
  type VersionDetail,
} from "../services/assessmentPackages";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import { useAssessmentLeaveGuard } from "../hooks/useAssessmentLeaveGuard";
import { PASSAGE_LIMITS, assessmentRequirements, passageStats, passageToText, textToPassage } from "../services/assessmentEditor";
import { INITIAL_STATUS_LABELS as STATUS_LABELS } from "../utils/initialDiagnosticLabels";
import AssessmentPreviewDialog from "./AssessmentPreviewDialog";
import "./InitialDiagnosticEditor.css";
import "./ReassessmentPackageEditor.css";

/**
 * M2 F10 reassessment packages, in the F6 Initial Diagnostic layout, for every role that manages them:
 *   system  — System Admin, central Independent Learner packages
 *   school  — School Admin, school packages
 *   teacher — Teacher, own private packages
 * Final workflow (project owner, 2026-11-21): Create New Version -> Edit Draft -> Preview -> Publish Version, by the
 * package's managers. No submission, approval or educator endorsement. Published versions are never edited: a change
 * starts a new draft version. Try Assessment practises the selected PUBLISHED version (Practice Mode, never saved).
 * Publishing never assigns or delivers anything: classroom packages are assigned
 * separately (F9); Independent Learners start one only while reassessment is turned on and they are eligible.
 * Permissions and validation come from the server (package.permissions, version.issues); nothing here grants more.
 */
export type ReassessmentEditorVariant = "system" | "school" | "teacher";
export const REASSESSMENT_LIST_PATH = "/system-admin/assessment/reassessment";
export const SCHOOL_REASSESSMENT_LIST_PATH = "/admin/assessment-packages";
export const TEACHER_REASSESSMENT_LIST_PATH = "/m3/teacher/assessment-packages";
const BACK: Record<ReassessmentEditorVariant, [string, string]> = {
  system: [REASSESSMENT_LIST_PATH, "Back to Reassessment"],
  school: [SCHOOL_REASSESSMENT_LIST_PATH, "Back to Reassessment Packages"],
  teacher: [TEACHER_REASSESSMENT_LIST_PATH, "Back to Reassessment Packages"],
};
const OPEN = new Set(["draft", "in_review", "approved"]);
const CHOICES: ChoiceId[] = ["a", "b", "c", "d"];
const TYPES: { value: QuestionType; label: string }[] = [
  { value: "literal", label: "Literal" },
  { value: "inferential", label: "Inferential" },
  { value: "critical", label: "Critical" },
];
const TABS = ["Overview and Versions", "Reading Passage", "Comprehension Questions"];
/** Each role's package pages (Exit Practice returns to the package that opened it). */
const PACKAGE_PAGES: Record<ReassessmentEditorVariant, string> = {
  system: "/system-admin/assessment-packages", school: SCHOOL_REASSESSMENT_LIST_PATH, teacher: TEACHER_REASSESSMENT_LIST_PATH,
};
/** F10 Try Assessment: Practice Mode for the SELECTED published version (server re-checks access and status). */
export const practicePath = (versionId: string, language: string) => `/practice/diagnostic/version/${encodeURIComponent(versionId)}/${language}/reading`;
export const TRY_NEEDS_PUBLISHED = "Publish this version to try it. Drafts can be previewed only.";
const words = (paragraphs: string[]) => paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "");
const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "");
const message = (e: unknown) => e instanceof AssessmentPackageRequestError ? [e.message, ...e.issues].join("\n")
  : e instanceof Error ? e.message : "Unable to complete the request.";
const CHECK_KEYS = Object.keys(REVIEW_CHECK_LABELS) as (keyof typeof REVIEW_CHECK_LABELS)[];

export default function ReassessmentPackageEditor({ detail, onDetail, variant = "system" }: {
  detail: PackageDetail; onDetail: (detail: PackageDetail) => void; variant?: ReassessmentEditorVariant;
}) {
  const [backTo, backLabel] = BACK[variant];
  const navigate = useNavigate();
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
  const [renaming, setRenaming] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  useAssessmentLeaveGuard(dirty || busy || renaming);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (dirtyRef.current || !selected) return;
    setContent(toEditableContent(selected.content));
    setStory(passageToText(selected.content.paragraphs));
  }, [selected?.id, selected?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected) {
    return <main className="m7-page m2-packages-page m2-id-page">
      <Link className="m3-back-link" to={backTo}><ArrowLeft size={17} aria-hidden="true" /> {backLabel}</Link>
      <h1>{pkg.title}</h1>
      <p className="m2-packages-empty">This package has no versions yet.</p>
    </main>;
  }
  const perms = pkg.permissions;
  const archived = pkg.archived;
  const isDraft = selected.status === "draft";
  const editable = editing && isDraft && perms.manage && !archived;
  const shown = editable ? content : selected.content;
  const requirements = assessmentRequirements(content);
  const stats = passageStats(content.paragraphs);
  const saveReason = editable && stats.saveIssues.length ? "Fix the passage limits above before saving." : "";
  const blockers = isDraft ? [...new Set([...requirements, ...selected.issues])] : [];
  const languageName = LANGUAGE_LABELS[pkg.language];
  const classroom = variant !== "system";

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
  const editDraft = () => { if (isDraft && perms.manage) { setEditing(true); setTab((t) => (t === 0 ? 1 : t)); } };
  const doneEditing = async () => { if (await guardUnsaved()) { discard(); setEditing(false); } };
  const save = async () => { if (saveReason) return; if (await run(() => savePackageDraft(pkg.id, selected.id, content), "Draft saved.")) setDirty(false); };
  const confirmed = async (text: string, action: "publish" | "retire" | "reopen", done: string, confirm?: string) => {
    if (busy || dirty || !await confirmReadFlow(text, confirm ? { confirm } : undefined)) return;
    if (await run(() => changeVersionStatus(pkg.id, selected.id, action), done)) setEditing(false);
  };
  const publish = () => confirmed(
    `Publish version ${selected.versionLabel}?${published && published.id !== selected.id ? ` Version ${published.versionLabel} becomes Retired.` : ""}`
      + " A published version cannot be edited."
      + (classroom ? " It is not assigned to any Student until you assign it." : " Independent Learners can start it only while reassessment is turned on and they are eligible."),
    "publish", `Version ${selected.versionLabel} is published.`, "Publish Version");
  const retire = () => confirmed(`Retire version ${selected.versionLabel}? It can no longer be assigned or started.`, "retire", `Version ${selected.versionLabel} was retired.`, "Retire Version");
  const reopen = () => confirmed(`Move version ${selected.versionLabel} back to draft so it can be edited?`, "reopen", `Version ${selected.versionLabel} is a draft again.`, "Move Back to Draft");
  const removeDraft = async () => {
    if (!await confirmReadFlow(`Delete draft version ${selected.versionLabel}? This cannot be undone.`, { confirm: "Delete Draft" })) return;
    if (await run(() => deletePackageDraft(pkg.id, selected.id), "Draft deleted.")) { setDirty(false); setEditing(false); setSelectedId(""); }
  };
  const archive = async () => {
    if (!await confirmReadFlow(`Archive "${pkg.title}"? It becomes read-only and is never deleted.`, { confirm: "Archive Package" })) return;
    await run(() => archiveAssessmentPackage(pkg.id), "Package archived.");
  };
  const rename = (title: string) => void run(() => renameAssessmentPackage(pkg.id, title), "Package title saved.").then((ok) => { if (ok) setRenaming(false); });

  const reason = (id: string, text: string) => (text ? <span id={id} className="m2-id-reason">{text}</span> : null);
  /** Five fixed actions, the same order and positions for every version, language and role. */
  type Slot = { key: string; label: string; enabled: boolean; reason: string; onClick?: () => void; primary?: boolean; pressed?: boolean; extra?: ReactNode };
  const off = (why: string) => ({ enabled: false, reason: why });
  const on = (onClick: () => void) => ({ enabled: true, reason: "", onClick });
  const lock = archived ? off("This package is archived (read-only).") : busy ? off("Please wait.") : dirty ? off("Save or discard your changes first.") : null;
  const slots: Slot[] = [
    { key: "create", label: "Create New Version", ...(archived ? off("This package is archived (read-only).") : !perms.manage ? off("You cannot create versions.")
      : isDraft ? off("This version is already a draft.")
      : open ? off(open.status === "draft" ? `Draft ${open.versionLabel} already exists.` : `Version ${open.versionLabel} is not published yet.`)
      : busy ? off("Please wait.") : on(() => void createVersion())) },
    { key: "edit", label: "Edit Draft", pressed: editable, ...(archived ? off("This package is archived (read-only).") : !perms.manage ? off("You cannot edit this version.")
      : !isDraft ? off(selected.status === "in_review" ? "Move it back to draft to edit it (Overview)." : `${STATUS_LABELS[selected.status]} versions cannot be edited.`)
      : editable ? off("Editing now.") : busy ? off("Please wait.") : on(editDraft)) },
    { key: "preview", label: "Preview", ...on(() => setPreview("passage")) },
    { key: "publish", label: "Publish Version", primary: true, ...(lock ?? (!perms.publish ? off("You cannot publish this package.")
      : selected.status === "published" ? off("Already published.") : selected.status === "retired" ? off("Retired versions cannot be published again.")
      : blockers.length ? off(`${blockers.length} requirement${blockers.length === 1 ? "" : "s"} missing.`) : on(() => void publish()))),
      extra: isDraft && blockers.length > 0 && !dirty && !archived
        ? <button type="button" className="m2-id-link" aria-expanded={showMissing} aria-controls="m2-id-missing"
            onClick={() => setShowMissing((v) => !v)}>{showMissing ? "Hide" : "What's missing?"}</button> : undefined },
    { key: "try", label: "Try Assessment", ...(selected.status === "retired" ? off("Retired versions cannot be practised.")
      : selected.status !== "published" ? off(TRY_NEEDS_PUBLISHED) : busy ? off("Please wait.") : dirty ? off("Save or discard your changes first.")
      : on(() => navigate(practicePath(selected.id, pkg.language), { state: { practiceExitTo: `${PACKAGE_PAGES[variant]}/${pkg.id}` } }))) },
  ];

  const availability = (v: VersionDetail) => v.status !== "published" ? "Not available (not published)"
    : classroom ? "Published. Assign it to Students separately (Reassessment Assignments)."
    : "Published. Eligible Independent Learners can start it only while reassessment is turned on.";

  const actionBar = (
    <div className="m2-id-bar" role="region" aria-label="Version actions">
      <div className="m2-id-bar-status">
        <span className="m2-id-chip m2-id-chip--selected">Selected: Version {selected.versionLabel} · {STATUS_LABELS[selected.status]}</span>
        <span className="m2-id-chip">{published ? `Published: Version ${published.versionLabel}` : "No published version"}</span>
      </div>
      {error && <div role="alert" className="m2-id-bar-error m2-editor-message">{error}</div>}
      {notice && !error && <p role="status" className="m2-id-bar-notice">{notice}</p>}
      {showMissing && blockers.length > 0 && <div className="m2-id-missing" role="status" id="m2-id-missing">
        <p>Before publishing version {selected.versionLabel}:</p>
        <ul>{blockers.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      </div>}
      {editable && <div className="m2-id-edit-row" aria-label="Editing">
        <span className="m2-id-chip" role="status">{busy ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>
        <span className="m2-id-action"><button type="button" disabled={busy || !dirty || Boolean(saveReason)} aria-describedby={saveReason ? "m2-rp-save-reason" : undefined}
          onClick={() => void save()}>Save Draft</button>{reason("m2-rp-save-reason", saveReason)}</span>
        <button type="button" disabled={busy} onClick={() => void doneEditing()}>{dirty ? "Cancel Editing" : "Done Editing"}</button>
      </div>}
      <div className="m2-id-slots m2-rp-slots">
        {slots.map((slot) => {
          const reasonId = `m2-rp-slot-${slot.key}-reason`;
          return <div key={slot.key} className="m2-id-slot" data-slot={slot.key}>
            <button type="button" className={slot.primary && slot.enabled ? "m2-id-primary" : undefined}
              aria-disabled={slot.enabled ? undefined : true} aria-pressed={slot.key === "edit" ? Boolean(slot.pressed) : undefined}
              aria-describedby={slot.reason ? reasonId : undefined}
              onClick={() => { if (slot.enabled) slot.onClick?.(); }}>{slot.label}</button>
            <span id={reasonId} className="m2-id-slot-reason">{slot.reason}</span>
            {slot.extra}
          </div>;
        })}
      </div>
    </div>
  );

  const cleanUp = !archived && perms.manage;
  return (
    <main className="m7-page m2-packages-page m2-id-page">
      <Link className="m3-back-link" to={backTo}><ArrowLeft size={17} aria-hidden="true" /> {backLabel}</Link>
      <header className="m2-id-header">
        <h1>{pkg.title}</h1>
        <dl className="m2-id-facts">
          <div><dt>Language</dt><dd>{languageName}</dd></div>
          <div><dt>Published version</dt><dd>{published ? `Version ${published.versionLabel}` : "None"}</dd></div>
          <div><dt>Draft version</dt><dd>{draft ? `Version ${draft.versionLabel}` : "None"}</dd></div>
        </dl>
        {archived && <p className="m2-packages-meta" role="status">Archived: read-only.</p>}
        <label className="m2-id-select">Selected version
          <select disabled={busy} value={selected.id} onChange={(e) => void choose(e.target.value)}>
            {versions.map((v) => <option key={v.id} value={v.id}>Version {v.versionLabel} — {STATUS_LABELS[v.status]}</option>)}
          </select>
        </label>
      </header>

      <div className="m2-editor-tabs m2-id-tabs" role="tablist" aria-label="Reassessment sections">
        {TABS.map((label, i) => <button key={label} type="button" role="tab" id={`m2-rp-tab-${i}`} aria-controls={`m2-rp-panel-${i}`}
          aria-selected={tab === i} tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)} onKeyDown={(e) => {
            const next = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : null;
            if (next !== null) { e.preventDefault(); setTab(next); document.getElementById(`m2-rp-tab-${next}`)?.focus(); }
          }}>{label}</button>)}
      </div>

      <section role="tabpanel" id="m2-rp-panel-0" aria-labelledby="m2-rp-tab-0" hidden={tab !== 0} className="m2-packages-panel">
        <div className="m2-id-version-head">
          <h2>Version {selected.versionLabel}</h2>
          <span className="m2-packages-status" data-status={selected.status}>{STATUS_LABELS[selected.status]}</span>
        </div>
        <dl className="m2-id-facts m2-id-version-facts">
          <div><dt>Package</dt><dd>{pkg.title}</dd></div>
          <div><dt>Passage title</dt><dd>{shown.passageTitle || "Untitled passage"}</dd></div>
          <div><dt>Content</dt><dd>{words(shown.paragraphs)} words · {shown.questions.length} questions</dd></div>
          <div><dt>Availability</dt><dd>{availability(selected)}</dd></div>
        </dl>
        {isDraft && blockers.length > 0 && !archived && <div className="m2-packages-issues" role="status"><p>Before publishing version {selected.versionLabel}:</p>
          <ul>{blockers.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        {selected.status === "in_review" && <p className="m2-packages-meta" role="status">This version was submitted under the earlier review workflow. Publish it, or move it back to draft to edit it.</p>}
        {open && open.id !== selected.id && <p className="m2-id-open-draft">
          <button type="button" className="m2-id-link" disabled={busy} onClick={() => void choose(open.id)}>
            {open.status === "draft" ? `Open Existing Draft ${open.versionLabel}` : `Open Version ${open.versionLabel} (not published)`}</button>
        </p>}
        <h3>Versions</h3>
        <table className="m2-id-versions">
          <thead><tr><th scope="col">Version</th><th scope="col">Passage title</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col"><span className="diagnostic-visually-hidden">Select</span></th></tr></thead>
          <tbody>{versions.map((v) => <tr key={v.id} aria-current={v.id === selected.id ? "true" : undefined}>
            <td>{v.versionLabel}</td>
            <td>{v.content.passageTitle || "Untitled passage"}</td>
            <td><span className="m2-packages-status" data-status={v.status}>{STATUS_LABELS[v.status]}</span></td>
            <td>{formatDate(v.createdAt)}</td>
            <td>{v.id === selected.id ? <span className="m2-packages-meta">Selected</span>
              : <button type="button" disabled={busy} onClick={() => void choose(v.id)}>Select</button>}</td>
          </tr>)}</tbody>
        </table>
        <details className="m2-rp-details">
          <summary>Version history and details — Version {selected.versionLabel}</summary>
          <ReviewHistory version={selected} />
        </details>
        {cleanUp && <div className="m2-id-danger-zone" aria-label="Package and version clean-up">
          {isDraft && <button type="button" className="m2-packages-danger" disabled={busy} onClick={() => void removeDraft()}>Delete Draft</button>}
          {selected.status === "in_review" && <button type="button" disabled={busy || dirty} onClick={() => void reopen()}>Move Back to Draft</button>}
          {(selected.status === "approved" || selected.status === "published") && perms.publish && <button type="button" disabled={busy || dirty} onClick={() => void retire()}>Retire Version</button>}
          <button type="button" disabled={busy || dirty} onClick={() => setRenaming(true)}>Rename Package</button>
          <button type="button" className="m2-packages-danger" disabled={busy || dirty} onClick={() => void archive()}>Archive Package</button>
        </div>}
      </section>

      <section role="tabpanel" id="m2-rp-panel-1" aria-labelledby="m2-rp-tab-1" hidden={tab !== 1} className="m2-packages-panel">
        <div className="m2-id-version-head"><h2>Reading Passage</h2><span className="m2-packages-meta">Version {selected.versionLabel} · {STATUS_LABELS[selected.status]}</span></div>
        <div className="m2-id-actions"><button type="button" onClick={() => setPreview("passage")}>Preview Reading Passage</button></div>
        {editable ? <fieldset disabled={busy} className="m2-editor-fields">
          <label>Passage Title<input value={content.passageTitle} maxLength={200} onChange={(e) => update({ ...content, passageTitle: e.target.value })} /></label>
          <p id="m2-rp-story-limits" className="m2-id-limits">Allowed length: {PASSAGE_LIMITS.minWords}–{PASSAGE_LIMITS.maxWords} words · up to {PASSAGE_LIMITS.maxParagraphs} paragraphs
            · up to {PASSAGE_LIMITS.maxParagraphChars.toLocaleString("en-US")} characters per paragraph. Type or paste the whole story; leave a blank line between paragraphs.</p>
          <label>Reading Passage<textarea rows={14} value={story} aria-describedby="m2-rp-story-limits m2-rp-story-count" onChange={(e) => {
            setStory(e.target.value); update({ ...content, paragraphs: textToPassage(e.target.value, selected.content.paragraphs) });
          }} /></label>
          <div id="m2-rp-story-count" className="m2-id-counter" data-state={stats.wordState} role="status" aria-live="polite">
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

      <section role="tabpanel" id="m2-rp-panel-2" aria-labelledby="m2-rp-tab-2" hidden={tab !== 2} className="m2-packages-panel">
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
                <label className="m2-packages-correct"><input type="radio" name={`m2-rp-correct-${selected.id}-${q.id || i}`} checked={q.correctChoiceId === id}
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
      {renaming && <RenameDialog title={pkg.title} busy={busy} onCancel={() => setRenaming(false)} onSave={rename} />}
    </main>
  );
}

/** Audit details for one version, kept out of the main view. Records from the earlier review workflow stay visible. */
function ReviewHistory({ version }: { version: VersionDetail }) {
  const rows: [string, string | null][] = [
    ["Created", [version.createdBy, formatDateTime(version.createdAt)].filter(Boolean).join(", ")],
    ["Submitted (earlier workflow)", version.submittedAt ? [version.submittedBy, formatDateTime(version.submittedAt)].filter(Boolean).join(", ") : null],
    ["Approved (earlier workflow)", version.reviewedAt ? [version.reviewedBy ?? "Removed account", formatDateTime(version.reviewedAt)].filter(Boolean).join(", ") : null],
    ["Approval statement (earlier workflow)", version.educatorReviewAttestation],
    ["Note", version.reviewNote],
    ["Published", version.publishedAt ? [version.publishedBy, formatDateTime(version.publishedAt)].filter(Boolean).join(", ") : null],
    ["Retired", version.retiredAt ? [version.retiredBy, formatDateTime(version.retiredAt)].filter(Boolean).join(", ") : null],
    ["Content fingerprint", version.contentSha256 ? version.contentSha256.slice(0, 12) : null],
  ];
  return (
    <div className="m2-rp-history">
      <dl className="m2-packages-facts">{rows.filter(([, v]) => v).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {version.educatorReviews.length > 0 && <>
        <h4>Educator reviews (earlier workflow, kept as history)</h4>
        <ul className="m2-packages-review-list">{version.educatorReviews.map((review) => <li key={review.id} data-outcome={review.outcome}>
          <p><strong>{review.outcome === "endorsed" ? "Endorsed" : "Changes requested"}</strong>{` by ${review.reviewerName} (${review.reviewerQualification}), reviewed ${review.reviewedOn}`}</p>
          <ul>{CHECK_KEYS.map((key) => <li key={key}>{review[key] ? "Yes" : "No"}: {REVIEW_CHECK_LABELS[key]}</li>)}</ul>
          {review.notes && <p>{review.notes}</p>}
          <p className="m2-packages-meta">Recorded by {review.recordedBy}, {formatDateTime(review.recordedAt)}</p>
        </li>)}</ul>
      </>}
    </div>
  );
}

function RenameDialog({ title, busy, onCancel, onSave }: { title: string; busy: boolean; onCancel: () => void; onSave: (title: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && typeof d.showModal === "function" && !d.open) d.showModal(); }, []);
  const [value, setValue] = useState(title);
  const ready = Boolean(value.trim()) && value.trim() !== title;
  return (
    <dialog ref={ref} className="m2-id-dialog" aria-labelledby="m2-rp-rename-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onSave(value.trim()); }}>
        <h2 id="m2-rp-rename-title">Rename Package</h2>
        <label>Package title<input maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <div className="m2-id-dialog-actions">
          <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="m2-id-primary" disabled={busy || !ready}>{busy ? "Saving…" : "Save Title"}</button>
        </div>
      </form>
    </dialog>
  );
}
