import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
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

/** M2 F6 + F10: one package with its versions; drafts are edited here and versions move through review. */
export default function AssessmentPackageDetailPage({ role }: { role: AssessmentPackageRole }) {
  const { packageId = "" } = useParams();
  const basePath = ASSESSMENT_PACKAGE_PATHS[role];
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState<{ message: string; issues: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await getAssessmentPackage(packageId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the package.");
    } finally {
      setLoading(false);
    }
  }, [packageId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (work: () => Promise<PackageDetail>) => {
    if (busy) return false;
    setBusy(true);
    setActionError(null);
    setConfirming("");
    try {
      setDetail(await work());
      return true;
    } catch (actError) {
      setActionError({
        message: actError instanceof Error ? actError.message : "Unable to complete the request.",
        issues: actError instanceof AssessmentPackageRequestError ? actError.issues : [],
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pkg = detail?.package;
  const working = useMemo(() => detail?.versions.find((v) => OPEN.has(v.status)) ?? null, [detail]);
  const history = useMemo(() => detail?.versions.filter((v) => v !== working) ?? [], [detail, working]);

  return (
    <main className="m7-page m2-packages-page">
      <p><Link to={basePath}>Back to packages</Link></p>
      {loading && !detail && <p role="status">Loading the package...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}
      {pkg && detail && (
        <>
          <h1>{pkg.title}</h1>
          <p className="m2-packages-intro">
            {CATEGORY_LABELS[pkg.category]} · {LANGUAGE_LABELS[pkg.language]}
            {pkg.ownerName ? ` · ${pkg.ownerName}` : ""}
            {pkg.archived ? " · Archived (read-only)" : ""}
          </p>
          <dl className="m2-packages-facts">
            <div><dt>Published in library</dt><dd>{pkg.publishedVersion ? `Version ${pkg.publishedVersion}` : "None"}</dd></div>
            <div>
              <dt>Active for learner assessment</dt>
              <dd>{pkg.activeVersion
                ? `Version ${pkg.activeVersion} (the current initial diagnostic)`
                : pkg.category === "initial" ? "None" : "No (reassessment is not available to learners yet)"}</dd>
            </div>
          </dl>
          {pkg.category === "initial" && pkg.activation?.available && (
            <section className="m2-packages-activation" aria-labelledby="m2-packages-activation">
              <h2 id="m2-packages-activation">Initial Diagnostic for Learners</h2>
              <p className="m2-packages-note">
                {pkg.activation.activeVersionId
                  ? `New learners take version ${pkg.activeVersion ?? ""} (activated by a System Admin).`
                  : "New learners take the built-in initial diagnostic (version 3.0)."}
                {" "}Publishing a version never changes this. Completed results always stay valid, and English and Filipino are set separately.
              </p>
              {pkg.activation.canManage && pkg.activation.activeVersionId && (confirming === "builtin" ? (
                <div className="m2-packages-actions">
                  <button type="button" disabled={busy}
                    onClick={() => void act(() => returnToBuiltInInitial(pkg.id, pkg.activation?.activeVersionId ?? null))}>
                    Confirm Return to Built-in 3.0
                  </button>
                  <button type="button" onClick={() => setConfirming("")}>Cancel</button>
                </div>
              ) : (
                <div className="m2-packages-actions">
                  <button type="button" disabled={busy} onClick={() => setConfirming("builtin")}>Return to Built-in 3.0</button>
                </div>
              ))}
            </section>
          )}

          {pkg.permissions.manage && (
            <div className="m2-packages-actions">
              {renaming === null ? (
                <button type="button" disabled={busy} onClick={() => setRenaming(pkg.title)}>Rename</button>
              ) : (
                <form className="m2-packages-inline" onSubmit={(event) => {
                  event.preventDefault();
                  void act(() => renameAssessmentPackage(pkg.id, renaming)).then((ok) => { if (ok) setRenaming(null); });
                }}>
                  <label><span>Package title</span>
                    <input value={renaming} maxLength={200} onChange={(event) => setRenaming(event.target.value)} />
                  </label>
                  <button type="submit" disabled={busy}>Save Title</button>
                  <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              )}
              {!working && (
                <button type="button" disabled={busy} onClick={() => void act(() => createPackageVersion(pkg.id))}>
                  New Version
                </button>
              )}
              {pkg.category !== "initial" && (confirming === "archive" ? (
                <>
                  <button type="button" className="m2-packages-danger" disabled={busy}
                    onClick={() => void act(() => archiveAssessmentPackage(pkg.id))}>Confirm Archive</button>
                  <button type="button" onClick={() => setConfirming("")}>Cancel</button>
                </>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirming("archive")}>Archive Package</button>
              ))}
            </div>
          )}

          {actionError && (
            <div role="alert" className="m2-packages-error">
              <p>{actionError.message}</p>
              {actionError.issues.length > 0 && <ul>{actionError.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
            </div>
          )}

          {working && (
            <WorkingVersion
              key={`${working.id}:${working.status}`}
              version={working}
              detail={detail}
              busy={busy}
              confirming={confirming}
              setConfirming={setConfirming}
              onSave={(content) => act(() => savePackageDraft(pkg.id, working.id, content))}
              onDelete={() => act(() => deletePackageDraft(pkg.id, working.id))}
              onAction={(action, input) => act(() => changeVersionStatus(pkg.id, working.id, action, input))}
              onReview={(input) => act(() => recordEducatorReview(pkg.id, working.id, input))}
            />
          )}

          <section aria-labelledby="m2-packages-history">
            <h2 id="m2-packages-history">Version History</h2>
            {history.length === 0 ? <p className="m2-packages-empty">No other versions.</p> : history.map((version) => (
              <details key={version.id} className="m2-packages-version">
                <summary>
                  Version {version.versionLabel} <StatusTag version={version} />
                  {version.source === "code_import" && <span className="m2-packages-tag">Built-in diagnostic</span>}
                  {version.activeForLearners && <span className="m2-packages-tag">Active for learners</span>}
                </summary>
                <VersionRecord version={version} />
                <EducatorReviews version={version} canRecord={pkg.permissions.review} busy={busy}
                  onReview={(input) => act(() => recordEducatorReview(pkg.id, version.id, input))} />
                <ContentView content={version.content} />
                {version.canActivate && pkg.activation && (
                  confirming === `activate:${version.id}` ? (
                    <div className="m2-packages-actions" role="group" aria-label={`Activate version ${version.versionLabel}`}>
                      <p className="m2-packages-note">
                        New learners will take version {version.versionLabel}. Learners who already completed the initial
                        diagnostic keep their result and are not asked to retake it. Learners who already started keep the
                        version they started for up to 24 hours.
                      </p>
                      <button type="button" disabled={busy}
                        onClick={() => void act(() => activateInitialVersion(pkg.id, version.id, pkg.activation?.activeVersionId ?? null))}>
                        Confirm Activation
                      </button>
                      <button type="button" onClick={() => setConfirming("")}>Cancel</button>
                    </div>
                  ) : (
                    <div className="m2-packages-actions">
                      <button type="button" disabled={busy} onClick={() => setConfirming(`activate:${version.id}`)}>Activate for Learners</button>
                    </div>
                  )
                )}
                {version.status === "published" && pkg.permissions.publish && pkg.category !== "initial" && (
                  confirming === `retire:${version.id}` ? (
                    <div className="m2-packages-actions">
                      <button type="button" className="m2-packages-danger" disabled={busy}
                        onClick={() => void act(() => changeVersionStatus(pkg.id, version.id, "retire"))}>Confirm Retire</button>
                      <button type="button" onClick={() => setConfirming("")}>Cancel</button>
                    </div>
                  ) : (
                    <div className="m2-packages-actions">
                      <button type="button" disabled={busy} onClick={() => setConfirming(`retire:${version.id}`)}>Retire Version</button>
                    </div>
                  )
                )}
              </details>
            ))}
          </section>
        </>
      )}
    </main>
  );
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
export function EducatorReviews({ version, canRecord, busy, onReview }: {
  version: VersionDetail; canRecord: boolean; busy: boolean; onReview: (input: EducatorReviewInput) => Promise<boolean>;
}) {
  const [form, setForm] = useState<EducatorReviewInput | null>(null);
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
  version: VersionDetail;
  detail: PackageDetail;
  busy: boolean;
  confirming: string;
  setConfirming: (value: string) => void;
  onSave: (content: PackageContent) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onAction: (action: VersionAction, input?: { note?: string; attestation?: string }) => Promise<boolean>;
  onReview?: (input: EducatorReviewInput) => Promise<boolean>;
}

export function WorkingVersion({ version, detail, busy, confirming, setConfirming, onSave, onDelete, onAction, onReview }: WorkingVersionProps) {
  const { permissions } = detail.package;
  const [content, setContent] = useState<PackageContent>(() => toEditableContent(version.content));
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [attestation, setAttestation] = useState("");
  const editable = version.status === "draft" && permissions.manage;

  const update = (next: PackageContent) => { setContent(next); setDirty(true); };
  const setQuestion = (index: number, patch: Partial<PackageContent["questions"][number]>) =>
    update({ ...content, questions: content.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });
  const save = async () => { if (await onSave(content)) setDirty(false); };

  return (
    <section className="m2-packages-panel" aria-labelledby="m2-packages-working">
      <h2 id="m2-packages-working">Version {version.versionLabel} <StatusTag version={version} /></h2>
      <VersionRecord version={version} />
      {version.status !== "draft" && onReview && (
        <EducatorReviews version={version} canRecord={permissions.review} busy={busy} onReview={onReview} />
      )}

      {editable ? (
        <div className="m2-packages-editor">
          <label>
            <span>Passage title</span>
            <input value={content.passageTitle} maxLength={200}
              onChange={(event) => update({ ...content, passageTitle: event.target.value })} />
          </label>
          <fieldset>
            <legend>Passage ({wordCount(content.paragraphs)} words)</legend>
            {content.paragraphs.map((paragraph, i) => (
              <div key={i} className="m2-packages-paragraph">
                <label>
                  <span>Paragraph {i + 1}</span>
                  <textarea rows={3} value={paragraph} maxLength={3000}
                    onChange={(event) => update({ ...content, paragraphs: content.paragraphs.map((p, j) => (j === i ? event.target.value : p)) })} />
                </label>
                {content.paragraphs.length > 1 && (
                  <button type="button" onClick={() => update({ ...content, paragraphs: content.paragraphs.filter((_, j) => j !== i) })}>
                    Remove Paragraph {i + 1}
                  </button>
                )}
              </div>
            ))}
            {content.paragraphs.length < 10 && (
              <button type="button" onClick={() => update({ ...content, paragraphs: [...content.paragraphs, ""] })}>Add Paragraph</button>
            )}
          </fieldset>
          {content.questions.map((q, i) => (
            <fieldset key={i} className="m2-packages-question">
              <legend>Question {i + 1}</legend>
              <label>
                <span>Question type</span>
                <select value={q.type} onChange={(event) => setQuestion(i, { type: event.target.value as QuestionType })}>
                  <option value="">Choose a type</option>
                  {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label>
                <span>Question</span>
                <input value={q.prompt} maxLength={500} onChange={(event) => setQuestion(i, { prompt: event.target.value })} />
              </label>
              {CHOICES.map((choiceId) => (
                <div key={choiceId} className="m2-packages-choice">
                  <label className="m2-packages-correct">
                    <input type="radio" name={`correct-${i}`} checked={q.correctChoiceId === choiceId}
                      onChange={() => setQuestion(i, { correctChoiceId: choiceId })} />
                    <span>Correct answer {choiceId.toUpperCase()}</span>
                  </label>
                  <label>
                    <span>Choice {choiceId.toUpperCase()}</span>
                    <input value={q.choices.find((c) => c.id === choiceId)?.label ?? ""} maxLength={300}
                      onChange={(event) => setQuestion(i, {
                        choices: q.choices.map((c) => (c.id === choiceId ? { ...c, label: event.target.value } : c)),
                      })} />
                  </label>
                </div>
              ))}
            </fieldset>
          ))}

          {!dirty && version.issues.length > 0 && (
            <div className="m2-packages-issues" role="status">
              <p>Before submitting for review:</p>
              <ul>{version.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            </div>
          )}
          <p className="m2-packages-meta">
            These checks are about structure only. Whether the passage and questions are educationally suitable is decided
            by the educator review.
          </p>
          <div className="m2-packages-actions">
            <button type="button" disabled={busy || !dirty} onClick={() => void save()}>Save Draft</button>
            <button type="button" disabled={busy || dirty || version.issues.length > 0}
              title={dirty ? "Save the draft first" : undefined}
              onClick={() => void onAction("submit")}>Submit for Review</button>
            {confirming === "delete" ? (
              <>
                <button type="button" className="m2-packages-danger" disabled={busy} onClick={() => void onDelete()}>Confirm Delete Draft</button>
                <button type="button" onClick={() => setConfirming("")}>Cancel</button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirming("delete")}>Delete Draft</button>
            )}
          </div>
        </div>
      ) : (
        <ContentView content={version.content} />
      )}

      {version.status === "draft" && !permissions.manage && (
        <p className="m2-packages-meta">This draft is still being written by its author.</p>
      )}

      {version.status === "in_review" && permissions.review && (
        <div className="m2-packages-review">
          <label>
            <span>Library approval statement (required to approve for the library)</span>
            <textarea rows={3} maxLength={2000} value={attestation}
              placeholder="What you checked before adding this version to the library"
              onChange={(event) => setAttestation(event.target.value)} />
          </label>
          <p className="m2-packages-meta">
            Approving for the library is not educational validation. Record the educator's review separately above.
          </p>
          <label>
            <span>Review note</span>
            <textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="m2-packages-actions">
            <button type="button" disabled={busy || !attestation.trim()}
              onClick={() => void onAction("approve", { attestation, note })}>Approve for Library</button>
            <button type="button" disabled={busy || !note.trim()} title={note.trim() ? undefined : "Add a review note first"}
              onClick={() => void onAction("return", { note })}>Return for Changes</button>
          </div>
        </div>
      )}
      {version.status === "in_review" && !permissions.review && (
        <p className="m2-packages-meta">Waiting for review. {detail.package.category === "teacher" ? "Your School Admin reviews Teacher packages." : ""}</p>
      )}

      {version.status === "approved" && permissions.publish && (
        <div className="m2-packages-actions">
          {confirming === "publish" ? (
            <>
              <button type="button" disabled={busy} onClick={() => void onAction("publish")}>Confirm Publish</button>
              <button type="button" onClick={() => setConfirming("")}>Cancel</button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirming("publish")}>
              Publish Version {version.versionLabel} in Library
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void onAction("retire")}>Retire Without Publishing</button>
        </div>
      )}
      {version.status === "approved" && detail.package.publishedVersion && (
        <p className="m2-packages-meta">
          Publishing in the library replaces version {detail.package.publishedVersion} there; it is kept unchanged as a retired version.
          {detail.package.category === "initial"
            ? " Publishing does not change what learners take: the current initial diagnostic stays active until a separate, approved activation."
            : " Learners are not affected: reassessment is not available to learners yet."}
        </p>
      )}
    </section>
  );
}
