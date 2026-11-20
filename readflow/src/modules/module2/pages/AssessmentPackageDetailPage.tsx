import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  EMPTY_QUESTION,
  CATEGORY_LABELS,
  LANGUAGE_LABELS,
  STATUS_LABELS,
  activateInitialVersion,
  archiveAssessmentPackage,
  changeVersionStatus,
  returnToBuiltInInitial,
  createPackageVersion,
  EDUCATOR_EVIDENCE_NOTICE,
  REVIEW_CHECK_LABELS,
  recordEducatorReview,
  deletePackageDraft,
  getAssessmentPackage,
  listAssessmentPackages,
  type PackageSummary,
  renameAssessmentPackage,
  savePackageDraft,
  toEditableContent,
  AssessmentPackageRequestError,
  type ChoiceId,
  type EducatorReviewInput,
  type PackageContent,
  type PackageDetail,
  type QuestionType,
  type VersionAction,
  type VersionDetail,
} from "../services/assessmentPackages";
import { ASSESSMENT_PACKAGE_PATHS, type AssessmentPackageRole } from "./AssessmentPackagesPage";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import { useAssessmentLeaveGuard } from "../hooks/useAssessmentLeaveGuard";
import { passageToText, textToPassage, assessmentRequirements } from "../services/assessmentEditor";
import InitialDiagnosticEditor, { INITIAL_LIST_PATH } from "../components/InitialDiagnosticEditor";
import ReassessmentPackageEditor from "../components/ReassessmentPackageEditor";
import { ArrowLeft } from "lucide-react";
import "../../module7/m7.css";
import "./AssessmentPackages.css";

const OPEN = new Set(["draft", "in_review", "approved"]);
const CHOICES: ChoiceId[] = ["a", "b", "c", "d"];
const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "literal", label: "Literal" },
  { value: "inferential", label: "Inferential" },
  { value: "critical", label: "Critical" },
];
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "");
const wordCount = (paragraphs: string[]) => paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;

const TABS = ["Overview and Versions", "Reading Passage", "Comprehension Questions", "Preview and Publishing"];

/** Selected version and editor stay mounted while users move between sections. */
export default function AssessmentPackageDetailPage({ role }: { role: AssessmentPackageRole }) {
  const { packageId = "" } = useParams();
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [siblings, setSiblings] = useState<PackageSummary[]>([]);
  useEffect(() => { if (role === "system_admin") void listAssessmentPackages().then(list => setSiblings(list.packages.filter(p => p.category === "initial"))).catch(() => {}); }, [role]);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  useAssessmentLeaveGuard(dirty || renaming !== null || busy);
  const load = useCallback(async () => {
    setError("");
    try { setDetail(await getAssessmentPackage(packageId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load the package."); }
  }, [packageId]);
  useEffect(() => { setDetail(null); setSelectedId(""); setDirty(false); setRenaming(null); void load(); }, [load]);
  const selected = detail?.versions.find(v => v.id === selectedId)
    ?? detail?.versions.find(v => OPEN.has(v.status)) ?? detail?.versions[0];
  const working = detail?.versions.find(v => OPEN.has(v.status));
  const pkg = detail?.package;
  const act = async (work: () => Promise<PackageDetail>, message = "Changes saved.") => {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try { setDetail(await work()); setNotice(message); return true; }
    catch (e) {
      setError(e instanceof AssessmentPackageRequestError ? [e.message, ...e.issues].join("\n")
        : e instanceof Error ? e.message : "Unable to complete the request.");
      return false;
    } finally { setBusy(false); }
  };
  const confirmAction = async (message: string, work: () => Promise<PackageDetail>) => {
    if (dirty || renaming !== null) { setError("Save or discard your unsaved changes before this action."); return; }
    if (await confirmReadFlow(message)) await act(work, "Action completed.");
  };
  const selectVersion = async (id: string) => {
    if (busy || id === selected?.id) return;
    if (dirty && !await confirmReadFlow("Discard unsaved changes and switch versions?", { confirm: "Discard Changes" })) return;
    setDirty(false); setSelectedId(id); setNotice(""); setError("");
  };
  // M2 F6/F7: the System Admin's Initial Diagnostic has its own three-tab editor at this same route.
  if (role === "system_admin" && detail?.package.category === "initial") {
    return <InitialDiagnosticEditor key={detail.package.id} detail={detail} siblings={siblings} onDetail={setDetail} />;
  }
  // M2 F10: the System Admin's central Independent Learner reassessment packages use the same layout (F10 rules kept).
  // School Admin and Teacher reassessment packages keep the editor below.
  if (role === "system_admin" && detail?.package.category === "independent") {
    return <ReassessmentPackageEditor key={detail.package.id} detail={detail} onDetail={setDetail} />;
  }
  return <main className="m7-page m2-packages-page">
    {role === "system_admin"
      ? <Link className="m3-back-link" to={pkg?.category === "initial" ? INITIAL_LIST_PATH : "/system-admin/assessment/reassessment"}><ArrowLeft size={17} aria-hidden="true" /> {pkg?.category === "initial" ? "Back to Initial Diagnostic" : "Back to Reassessment"}</Link>
      : <Link className="m2-editor-back" to={ASSESSMENT_PACKAGE_PATHS[role]}><span aria-hidden="true">←</span> Back to Assessment</Link>}
    {!detail && !error && <p role="status">Loading the package...</p>}
    {error && <div role="alert" className="m2-packages-error m2-editor-message">{error}{!detail && <button onClick={() => void load()}>Try Again</button>}</div>}
    {notice && <p role="status" className="m2-editor-success">{notice}</p>}
    {pkg && detail && <>
      <header className="m2-editor-header">
        <p className="m2-packages-intro">{CATEGORY_LABELS[pkg.category]} · {LANGUAGE_LABELS[pkg.language]}{pkg.ownerName ? ` · ${pkg.ownerName}` : ""}{pkg.archived ? " · Archived (read-only)" : ""}</p>
        <h1>{pkg.category === "initial" ? "Initial Diagnostic" : pkg.title}</h1>
        {role === "system_admin" && pkg.category === "initial" && <nav className="m2-language-tabs" aria-label="Diagnostic language">
          {(["en", "fil"] as const).map(language => {
            const sibling = siblings.find(p => p.language === language && !p.archived);
            return <Link key={language} aria-current={pkg.language === language ? "page" : undefined}
              to={sibling ? `${ASSESSMENT_PACKAGE_PATHS[role]}/${sibling.id}` : "/system-admin/assessment/initial"}>{LANGUAGE_LABELS[language]}</Link>;
          })}
        </nav>}
        <dl className="m2-packages-facts">
          <div><dt>Active for learner assessment</dt><dd>{pkg.activeVersion
            ? `Version ${pkg.activeVersion} (the current initial diagnostic)`
            : pkg.category === "initial" ? "None" : "No (reassessment is not available to learners yet)"}</dd></div>
          <div><dt>Published in library</dt><dd>{pkg.publishedVersion ? `Version ${pkg.publishedVersion}` : "None"}</dd></div>
          <div><dt>Draft version</dt><dd>{detail.versions.find(v => v.status === "draft")?.versionLabel ?? "None"}</dd></div>
        </dl>
        {selected && <label className="m2-editor-selection">Selected version
          <select disabled={busy} value={selected.id} onChange={e => void selectVersion(e.target.value)}>
            {detail.versions.map(v => <option key={v.id} value={v.id}>Version {v.versionLabel} — {STATUS_LABELS[v.status]}{v.activeForLearners ? " · Active for Learners" : ""}</option>)}
          </select>
        </label>}
        {pkg.category === "initial" && pkg.activation?.available && <section className="m2-packages-activation" aria-labelledby="m2-packages-activation">
          <h2 id="m2-packages-activation">Initial Diagnostic for Learners</h2>
          <p className="m2-packages-note">
            {pkg.activation.activeVersionId
              ? `New learners take version ${pkg.activeVersion ?? ""} (activated by a System Admin).`
              : "New learners take the built-in initial diagnostic (version 3.0)."}
            {" "}Publishing a version never changes this. Completed results always stay valid, and English and Filipino are set separately.
          </p>
          {pkg.activation.canManage && <p className="m2-packages-meta">To change it, select a version and open Preview and Publishing.</p>}
        </section>}
      </header>
      <div className="m2-editor-tabs" role="tablist" aria-label="Assessment sections">
        {TABS.map((label, i) => <button key={label} type="button" role="tab" id={`m2-tab-${i}`} aria-controls={`m2-panel-${i}`}
          aria-selected={tab === i} tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)} onKeyDown={e => {
            const next = e.key === "ArrowRight" ? (i + 1) % 4 : e.key === "ArrowLeft" ? (i + 3) % 4 : e.key === "Home" ? 0 : e.key === "End" ? 3 : null;
            if (next !== null) { e.preventDefault(); setTab(next); document.getElementById(`m2-tab-${next}`)?.focus(); }
          }}>{label}</button>)}
      </div>
      <section role="tabpanel" id="m2-panel-0" aria-labelledby="m2-tab-0" hidden={tab !== 0}>
        <div className="m2-packages-panel">
          <h2>Overview and Versions</h2>
          <p>Create / Edit → Save Draft → Preview → Publish to Library → Try Assessment (eligible versions)</p>
          <p className="m2-packages-meta">Library publishing requires submission and approval. Learner activation is a separate action and requires documented educator endorsement.</p>
          <p className="m2-packages-notice">Publishing a version does not automatically activate it for learners. Library status and learner activation are tracked separately.</p>
          {pkg.permissions.manage && <div className="m2-packages-actions">
            {renaming === null ? <button disabled={busy} onClick={() => setRenaming(pkg.title)}>Rename</button> : <form className="m2-packages-inline" onSubmit={e => {
              e.preventDefault(); void act(() => renameAssessmentPackage(pkg.id, renaming), "Package title saved.").then(ok => { if (ok) setRenaming(null); });
            }}><label>Package title<input disabled={busy} maxLength={200} value={renaming} onChange={e => setRenaming(e.target.value)} /></label>
              <button disabled={busy}>Save Title</button><button type="button" disabled={busy} onClick={() => setRenaming(null)}>Cancel</button></form>}
            {!working && <button disabled={busy} onClick={() => void act(() => createPackageVersion(pkg.id), "New draft created.").then(ok => { if (ok) setSelectedId(""); })}>New Version</button>}
            {pkg.category !== "initial" && <button disabled={busy} onClick={() => void confirmAction("Archive this package? It will become read-only.", () => archiveAssessmentPackage(pkg.id))}>Archive Package</button>}
          </div>}
          <h3>Version History</h3>
          <ul className="m2-editor-versions">{detail.versions.map(v => <li key={v.id}>
            <button disabled={busy} aria-pressed={selected?.id === v.id} onClick={() => void selectVersion(v.id)}>Version {v.versionLabel}</button>
            <StatusTag version={v} />{v.source === "code_import" && <span className="m2-packages-tag">Built-in diagnostic</span>}
            {v.activeForLearners && <span className="m2-packages-tag">Active for learners</span>}
            {selected?.id === v.id && <span className="m2-packages-tag">Selected</span>}
            <span className="m2-packages-meta">Created {formatDate(v.createdAt)}</span>
          </li>)}</ul>
          {selected && <VersionRecord version={selected} />}
          {selected && pkg.category === "initial" && (selected.source === "code_import" && selected.versionLabel === "3.0"
            ? <div><Link className="m2-editor-back" to={`/practice/diagnostic/${pkg.language}/reading`} state={{ practiceExitTo: `${ASSESSMENT_PACKAGE_PATHS[role]}/${pkg.id}` }}>Try Assessment — {LANGUAGE_LABELS[pkg.language]} — Built-in Version 3.0</Link><p className="m2-packages-meta">Practice only. No official results are saved. This tries the built-in content represented by this imported version.</p></div>
            : <p className="m2-packages-note">Try Assessment is unavailable for version {selected.versionLabel}. Practice currently supports only the built-in version 3.0. Use the Reading Passage and Comprehension Questions tabs for a content preview.</p>)}
        </div>
      </section>
      {selected && <WorkingVersion key={`${selected.id}:${selected.status}`} version={selected} detail={detail} busy={busy} tab={tab} onPreview={() => setTab(3)} onDirtyChange={setDirty}
        confirming="" setConfirming={() => {}}
        onSave={content => act(() => savePackageDraft(pkg.id, selected.id, content), "Draft saved successfully.")}
        onDelete={() => act(() => deletePackageDraft(pkg.id, selected.id), "Draft deleted.")}
        onAction={(action, input) => act(() => changeVersionStatus(pkg.id, selected.id, action, input), "Version status updated.")}
        onReview={input => act(() => recordEducatorReview(pkg.id, selected.id, input), "Educator review recorded.")} />}
      <div hidden={tab !== 3} className="m2-packages-actions">
        {selected?.canActivate && pkg.activation && <button disabled={busy || dirty} onClick={() => void confirmAction(
          `Activate version ${selected.versionLabel} for new learners? New learners will take version ${selected.versionLabel}. Learners who already completed the initial diagnostic keep their result and are not asked to retake it. Learners who already started keep the version they started for up to 24 hours.`,
          () => activateInitialVersion(pkg.id, selected.id, pkg.activation?.activeVersionId ?? null))}>Activate for Learners</button>}
        {pkg.activation?.canManage && pkg.activation.activeVersionId && <button disabled={busy || dirty} onClick={() => void confirmAction(
          "Return new learners to the built-in diagnostic version 3.0?", () => returnToBuiltInInitial(pkg.id, pkg.activation?.activeVersionId ?? null))}>Return to Built-in 3.0</button>}
        {selected?.status === "published" && pkg.permissions.publish && pkg.category !== "initial" && <button disabled={busy || dirty}
          onClick={() => void confirmAction("Retire this published version?", () => changeVersionStatus(pkg.id, selected.id, "retire"))}>Retire Version</button>}
      </div>
    </>}
  </main>;
}

function StatusTag({ version }: { version: VersionDetail }) {
  return <span className="m2-packages-status" data-status={version.status}>{STATUS_LABELS[version.status]}</span>;
}

export function VersionRecord({ version }: { version: VersionDetail }) {
  const rows: [string, string | null][] = [
    ["Library status", version.stageLabel],
    ["Active for learner assessment", `${version.activeForLearners ? "Yes" : "No"}. ${version.activationNote}`],
    ["Educator endorsement", version.educatorEndorsed ? "Endorsed (documented educator review)"
      : version.educatorReviews.length ? "Not endorsed (latest review requested changes)" : "Not recorded"],
    ["Created", [version.createdBy, formatDate(version.createdAt)].filter(Boolean).join(", ")],
    ["Submitted for review", version.submittedAt ? [version.submittedBy, formatDate(version.submittedAt)].filter(Boolean).join(", ") : null],
    ["Approved for library", version.reviewedAt ? [version.reviewedBy ?? "Removed account", formatDate(version.reviewedAt)].filter(Boolean).join(", ") : null],
    ["Library approval statement", version.educatorReviewAttestation],
    ["Review note", version.reviewNote],
    ["Published", version.publishedAt ? [version.publishedBy, formatDate(version.publishedAt)].filter(Boolean).join(", ") : null],
    ["Retired", version.retiredAt ? [version.retiredBy, formatDate(version.retiredAt)].filter(Boolean).join(", ") : null],
    ["Content fingerprint", version.contentSha256 ? version.contentSha256.slice(0, 12) : null],
  ];
  return (
    <dl className="m2-packages-facts">
      {rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

/** Read-only passage and questions. Answer keys are shown: this page is staff-only. */
export function ContentView({ content }: { content: PackageContent }) {
  return (
    <div className="m2-packages-content">
      <h3>{content.passageTitle || "Untitled passage"}</h3>
      {content.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      <p className="m2-packages-meta">{wordCount(content.paragraphs)} words</p>
      <ol>
        {content.questions.map((q) => (
          <li key={q.id}>
            <p><strong>{q.prompt || "No prompt"}</strong> <span className="m2-packages-meta">({q.type || "no type"})</span></p>
            <ul className="m2-packages-choices">
              {q.choices.map((c) => (
                <li key={c.id} data-correct={c.id === q.correctChoiceId ? "true" : undefined}>
                  {c.id.toUpperCase()}. {c.label}{c.id === q.correctChoiceId ? " (correct answer)" : ""}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

const EMPTY_REVIEW = (): EducatorReviewInput => ({
  reviewerName: "", reviewerQualification: "", reviewedOn: "", passageSuitable: false, questionsSound: false,
  answerKeysCorrect: false, languageAccurate: false, outcome: "endorsed", notes: "",
});
const CHECK_KEYS = Object.keys(REVIEW_CHECK_LABELS) as (keyof typeof REVIEW_CHECK_LABELS)[];

/** Educator review evidence for one frozen version, and (for reviewers) the form to record a new review. */
export function EducatorReviews({ version, canRecord, busy, onReview, onDirtyChange }: {
  version: VersionDetail; canRecord: boolean; busy: boolean; onReview: (input: EducatorReviewInput) => Promise<boolean>; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<EducatorReviewInput | null>(null);
  useEffect(() => { onDirtyChange?.(form !== null); }, [form, onDirtyChange]);
  const allChecks = form ? CHECK_KEYS.every((key) => form[key]) : false;
  const ready = Boolean(form && form.reviewerName.trim() && form.reviewerQualification.trim() && form.reviewedOn
    && (form.outcome === "changes_requested" || allChecks));
  return (
    <div className="m2-packages-reviews">
      <h3>Educator Review</h3>
      <p className="m2-packages-meta">{EDUCATOR_EVIDENCE_NOTICE}</p>
      {version.educatorReviews.length === 0 ? <p className="m2-packages-empty">No educator review recorded.</p> : (
        <ul className="m2-packages-review-list">
          {version.educatorReviews.map((review) => (
            <li key={review.id} data-outcome={review.outcome}>
              <p>
                <strong>{review.outcome === "endorsed" ? "Endorsed" : "Changes requested"}</strong>
                {` by ${review.reviewerName} (${review.reviewerQualification}), reviewed ${review.reviewedOn}`}
              </p>
              <ul>
                {CHECK_KEYS.map((key) => <li key={key}>{review[key] ? "Yes" : "No"}: {REVIEW_CHECK_LABELS[key]}</li>)}
              </ul>
              {review.notes && <p>{review.notes}</p>}
              <p className="m2-packages-meta">Recorded by {review.recordedBy}, {formatDate(review.recordedAt)}</p>
            </li>
          ))}
        </ul>
      )}
      {canRecord && version.status !== "draft" && (form === null ? (
        <button type="button" disabled={busy} onClick={() => setForm(EMPTY_REVIEW())}>Record Educator Review</button>
      ) : (
        <form className="m2-packages-review-form" onSubmit={(event) => {
          event.preventDefault();
          if (ready) void onReview(form).then((ok) => { if (ok) setForm(null); });
        }}>
          <label><span>Reviewer's name</span>
            <input value={form.reviewerName} maxLength={200} onChange={(event) => setForm({ ...form, reviewerName: event.target.value })} />
          </label>
          <label><span>Reviewer's stated qualification</span>
            <input value={form.reviewerQualification} maxLength={500} placeholder="For example: Grade 5 English teacher, reading coordinator"
              onChange={(event) => setForm({ ...form, reviewerQualification: event.target.value })} />
          </label>
          <label><span>Review date</span>
            <input type="date" value={form.reviewedOn} onChange={(event) => setForm({ ...form, reviewedOn: event.target.value })} />
          </label>
          <fieldset>
            <legend>Review checks</legend>
            {CHECK_KEYS.map((key) => (
              <label key={key} className="m2-packages-correct">
                <input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />
                <span>{REVIEW_CHECK_LABELS[key]}</span>
              </label>
            ))}
          </fieldset>
          <label><span>Outcome</span>
            <select value={form.outcome} onChange={(event) => setForm({ ...form, outcome: event.target.value as EducatorReviewInput["outcome"] })}>
              <option value="endorsed">Endorsed</option>
              <option value="changes_requested">Changes requested</option>
            </select>
          </label>
          {form.outcome === "endorsed" && !allChecks && (
            <p className="m2-packages-meta" role="status">An endorsement needs all four checks passed.</p>
          )}
          <label><span>Notes</span>
            <textarea rows={2} maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="m2-packages-actions">
            <button type="submit" disabled={busy || !ready}>Save Educator Review</button>
            <button type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ))}
    </div>
  );
}

interface WorkingVersionProps {
  version: VersionDetail; detail: PackageDetail; busy: boolean; tab?: number; onPreview?: () => void;
  confirming: string; setConfirming: (value: string) => void;
  onDirtyChange?: (value: boolean) => void;
  onSave: (content: PackageContent) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onAction: (action: VersionAction, input?: { note?: string; attestation?: string }) => Promise<boolean>;
  onReview?: (input: EducatorReviewInput) => Promise<boolean>;
}

export function WorkingVersion({ version, detail, busy, tab = 1, onPreview, onDirtyChange, onSave, onDelete, onAction, onReview }: WorkingVersionProps) {
  const { permissions } = detail.package;
  const [content, setContent] = useState<PackageContent>(() => toEditableContent(version.content));
  const [story, setStory] = useState(() => passageToText(version.content.paragraphs));
  const [dirty, setDirty] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [note, setNote] = useState("");
  const [attestation, setAttestation] = useState("");
  const editable = version.status === "draft" && permissions.manage;
  useEffect(() => { onDirtyChange?.(dirty || reviewDirty || Boolean(note || attestation)); }, [dirty, reviewDirty, note, attestation, onDirtyChange]);
  const update = (next: PackageContent) => { setContent(next); setDirty(true); };
  const setQuestion = (index: number, patch: Partial<PackageContent["questions"][number]>) =>
    update({ ...content, questions: content.questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  const requirements = assessmentRequirements(content);
  const save = async () => {
    if (await onSave(content)) { setDirty(false); }
  };
  const run = async (action: VersionAction, input?: { note?: string; attestation?: string }) => {
    if (await confirmReadFlow(`${action === "submit" ? "Submit this draft for educator review? It becomes read-only." : action === "publish" ? "Publish this version in the library? This does not activate it for learners." : action === "retire" ? "Retire this version without publishing?" : action === "approve" ? "Approve this version for the library? Educator endorsement remains separate." : "Return this version to an editable draft?"}`)) {
      if (await onAction(action, input)) { setNote(""); setAttestation(""); setDirty(false); }
    }
  };
  return <>
    <section role="tabpanel" id="m2-panel-1" aria-labelledby="m2-tab-1" hidden={tab !== 1} className="m2-packages-panel">
      <h2>Reading Passage <span className="m2-packages-meta">Version {version.versionLabel}</span></h2>
      {editable ? <fieldset disabled={busy} className="m2-editor-fields">
        <label>Passage Title<input value={content.passageTitle} maxLength={200} onChange={e => update({ ...content, passageTitle: e.target.value })} /></label>
        <label>Reading Passage (Complete Story)<textarea rows={16} value={story} aria-describedby="m2-story-help" onChange={e => {
          setStory(e.target.value); update({ ...content, paragraphs: textToPassage(e.target.value, version.content.paragraphs) });
        }} /></label>
        <p id="m2-story-help" className="m2-packages-meta">Type or paste the complete story. Use a blank line between paragraphs. {wordCount(content.paragraphs)} words · {content.paragraphs.length} paragraphs</p>
      </fieldset> : <div className="m2-editor-story"><h3>{version.content.passageTitle}</h3>{version.content.paragraphs.map((p, i) => <p key={i}>{p}</p>)}<p>{wordCount(version.content.paragraphs)} words · Read-only version</p></div>}
    </section>
    <section role="tabpanel" id="m2-panel-2" aria-labelledby="m2-tab-2" hidden={tab !== 2} className="m2-packages-panel">
      <h2>Comprehension Questions <span className="m2-packages-meta">{content.questions.length}/8</span></h2>
      <p className="m2-packages-meta">{QUESTION_TYPES.map(t => `${t.label}: ${content.questions.filter(q => q.type === t.value).length}`).join(" · ")}</p>
      {content.questions.length < 5 && <p role="status">Add at least {5 - content.questions.length} more question(s). A complete assessment needs 5–8 questions and all three categories.</p>}
      <div className="m2-packages-editor">
        {content.questions.map((q, i) => <details key={q.id || i} className="m2-editor-question">
          <summary>Question {i + 1} — {QUESTION_TYPES.find(t => t.value === q.type)?.label ?? "Choose a type"}<span className="m2-editor-question-preview">{q.prompt || "New question"}</span></summary>
          {editable ? <fieldset disabled={busy} className="m2-editor-fields"><legend>Question {i + 1}</legend>
            <label>Question type<select value={q.type} onChange={e => setQuestion(i, { type: e.target.value as QuestionType })}><option value="">Choose a type</option>{QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
            <label>Question text<textarea rows={2} value={q.prompt} maxLength={500} onChange={e => setQuestion(i, { prompt: e.target.value })} /></label>
            {CHOICES.map(id => <div className="m2-packages-choice" key={id}>
              <label className="m2-packages-correct"><input type="radio" name={`correct-${version.id}-${q.id || i}`} checked={q.correctChoiceId === id} onChange={() => setQuestion(i, { correctChoiceId: id })} />Correct answer {id.toUpperCase()}</label>
              <label>Choice {id.toUpperCase()}<input maxLength={300} value={q.choices.find(c => c.id === id)?.label ?? ""} onChange={e => setQuestion(i, { choices: q.choices.map(c => c.id === id ? { ...c, label: e.target.value } : c) })} /></label>
            </div>)}
            <button type="button" className="m2-packages-danger" onClick={async () => {
              if (await confirmReadFlow(`Remove question ${i + 1}? Save Draft to keep this change.`, { confirm: "Remove Question" })) update({ ...content, questions: content.questions.filter((_, j) => j !== i) });
            }}>Remove Question {i + 1}</button>
          </fieldset> : <div><p>{q.prompt}</p><ul className="m2-packages-choices">{q.choices.map(c => <li key={c.id} data-correct={c.id === q.correctChoiceId ? "true" : undefined}>{c.id.toUpperCase()}. {c.label}{c.id === q.correctChoiceId ? " (correct answer)" : ""}</li>)}</ul></div>}
        </details>)}
      </div>
      {editable && <button className="m2-editor-add" type="button" disabled={busy || content.questions.length >= 8} onClick={() => update({ ...content, questions: [...content.questions, { ...EMPTY_QUESTION(), id: crypto.randomUUID() }] })}>+ Add Question</button>}
    </section>
    <section role="tabpanel" id="m2-panel-3" aria-labelledby="m2-tab-3" hidden={tab !== 3} className="m2-packages-panel">
      <h2>Preview and Publishing <StatusTag version={version} /></h2>
      <details className="m2-content-preview" open><summary>Preview Content</summary><ContentView content={content} /></details>
      <details><summary>Version and review history</summary><VersionRecord version={version} /></details>
      <h3>Assessment Requirements</h3>
      <p>Complete the passage and required comprehension questions before submitting for review. An educator will review the content for accuracy and suitability for learners.</p>
      {editable && <><ul className="m2-editor-checklist">{requirements.length ? requirements.map(issue => <li key={issue}>{issue}</li>) : <li>Passage and question requirements complete.</li>}</ul>
        <p className="m2-packages-note">5–8 questions are supported by this editor. Submission uses the database requirements; the local database still requires six until its update is approved.</p>
        <p className="m2-packages-meta">These checks are about structure only. Whether the passage and questions are educationally suitable is decided by the educator review.</p>
        {!dirty && version.issues.length > 0 && <div role="status" className="m2-packages-issues"><p>Database validation</p><ul>{version.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
        {dirty && <p role="status">Save your changes to refresh database validation.</p>}
      </>}
      {editable && <div className="m2-packages-actions"><button disabled={busy || dirty || requirements.length > 0 || version.issues.length > 0} onClick={() => void run("submit")}>Submit for Review</button><p className="m2-packages-meta">Required before approval and library publishing. No review is recorded automatically.</p></div>}
      {version.status !== "draft" && onReview && <EducatorReviews version={version} canRecord={permissions.review} busy={busy} onReview={onReview} onDirtyChange={setReviewDirty} />}
      {version.status === "draft" && !permissions.manage && <p>This draft is still being written by its author.</p>}
      {version.status === "in_review" && permissions.review && <fieldset disabled={busy} className="m2-packages-review m2-editor-fields">
        <label>Library approval statement (required to approve for the library)<textarea rows={3} maxLength={2000} value={attestation} onChange={e => setAttestation(e.target.value)} /></label>
        <p className="m2-packages-meta">Approving for the library is not educational validation. Record the educator's review separately above.</p>
        <label>Review note<textarea rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="m2-packages-actions"><button disabled={busy || reviewDirty || !attestation.trim()} onClick={() => void run("approve", { attestation, note })}>Approve for Library</button>
          <button disabled={busy || reviewDirty || !note.trim()} onClick={() => void run("return", { note })}>Return for Changes</button></div>
      </fieldset>}
      {version.status === "in_review" && !permissions.review && <p>Waiting for review. {detail.package.category === "teacher" ? "Your School Admin reviews Teacher packages." : ""}</p>}
      {version.status === "approved" && permissions.publish && <div className="m2-packages-actions"><button disabled={busy || reviewDirty} onClick={() => void run("publish")}>Publish Version {version.versionLabel} in Library</button><button disabled={busy || reviewDirty} onClick={() => void run("retire")}>Retire Without Publishing</button></div>}
      {version.status === "approved" && detail.package.publishedVersion && <p>Publishing in the library replaces version {detail.package.publishedVersion} there; it is kept unchanged as a retired version. Publishing does not change what learners take: the current initial diagnostic stays active until a separate, approved activation.</p>}
    </section>
    {editable && <div className="m2-editor-toolbar" aria-label="Draft actions">
      <span role="status">{busy ? "Saving or updating…" :dirty ? "Unsaved changes" : "All changes saved"}</span>
      <button disabled={busy || !dirty} onClick={() => void save()}>Save Draft</button>
      <button disabled={busy} onClick={onPreview}>Preview</button>
      <button className="m2-packages-danger" disabled={busy} onClick={async () => { if (await confirmReadFlow("Delete this draft and all unsaved changes? This cannot be undone.", { confirm: "Delete Draft" })) { if (await onDelete()) onDirtyChange?.(false); } }}>Delete Draft</button>
    </div>}
  </>;
}
