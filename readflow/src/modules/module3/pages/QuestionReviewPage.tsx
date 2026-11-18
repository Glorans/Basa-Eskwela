import { getQuestionGenerationError } from "../services/questionGenerationError";
import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, FileQuestion, LoaderCircle, Save } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import { useM3Content } from "../context/M3ContentContext";
import useAuthenticatedProfile from "../../../hooks/useAuthenticatedProfile";
import { getMaterialServiceError, getMaterialQuestionSet, saveMaterialQuestionSet, reviewMaterialQuestionSet, regenerateMaterialQuestionSet } from "../services/materialService";
import {
  canReviewMaterialQuestions,
  formatCorrectAnswer,
  toReviewableQuestions,
  normalizeReviewableQuestions,
  validateReviewableQuestions,
  type QuestionValidationIssue,
} from "../state/questionState";
import type {
  M3Role,
  MaterialQuestionSet,
  QuestionType,
  ReviewableComprehensionQuestion,
} from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";

interface QuestionReviewPageProps {
  editing?: boolean;
  role: Extract<M3Role, "admin" | "teacher" | "system_admin">;
}

export default function QuestionReviewPage({ role, editing = false }: QuestionReviewPageProps) {
  const { materialId, setId } = useParams<{ materialId: string; setId: string }>();
  const {
    getMaterial,
    materialsLoading,
  } = useM3Content();
  const { profile } = useAuthenticatedProfile();
  const material = getMaterial(materialId);
  const root = getM3WorkspaceRoot(role);
  const materialTarget = materialId ? `${root}/materials/${materialId}` : `${root}/materials`;
  const canReview = canReviewMaterialQuestions(role, material, profile?.id ?? "");
  const [questions, setQuestions] = useState<ReviewableComprehensionQuestion[]>([]);
  const [validationIssues, setValidationIssues] = useState<QuestionValidationIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [selectedSet, setSelectedSet] = useState<MaterialQuestionSet | null>(null);
  const [busy, setBusy] = useState(false);
  const requestPending = useRef(false);
  const [approving, setApproving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [feedback, setFeedback] = useState("");
  const identity = `${materialId}:${setId}:${editing}`;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setQuestions([]); setSelectedSet(null); setSaved(false); setSaveError("");
    setValidationIssues([]); setDirty(false); setRegenerating(false); setApproving(false); setFeedback(""); setBusy(false);
    if (!materialId || !setId || !canReview) { setLoading(false); return; }
    setLoading(true);
    getMaterialQuestionSet(materialId, setId).then(set => {
      if (active) { setSelectedSet(set); setQuestions(toReviewableQuestions(set.questions)); }
    }).catch(error => { if (active) setSaveError(getMaterialServiceError(error, "Unable to load questions.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [materialId, setId, canReview, editing, reload]);

  function markUnsaved() {
    setDirty(true);
    setFeedback("");
    setSaved(false);
    setValidationIssues([]);
  }

  function updateQuestion(
    questionId: string,
    changes: Partial<Pick<ReviewableComprehensionQuestion, "type" | "questionText" | "scaffoldingHint">>,
  ) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === questionId ? { ...question, ...changes } : question,
      ),
    );
    markUnsaved();
  }

  function updateOption(questionId: string, optionIndex: number, value: string) {
    setQuestions((current) =>
      current.map((question) => {
        if (question.id !== questionId) return question;

        const options = [...question.options] as ReviewableComprehensionQuestion["options"];
        options[optionIndex] = value;

        return {
          ...question,
          options,
        };
      }),
    );
    markUnsaved();
  }

  async function saveQuestions() {
    if (!material || !selectedSet || selectedSet.id !== setId || !canReview || busy || requestPending.current || !dirty || !editing || selectedSet.hasStudentAttempts) return;
    const normalized = normalizeReviewableQuestions(questions);
    const issues = validateReviewableQuestions(normalized);
    if (normalized.length !== selectedSet.questionCount || ["literal", "inferential", "critical"].some(type => normalized.filter(q => q.type === type).length !== selectedSet.questionCount / 3)) {
      issues.push({ messages: [`This set requires ${selectedSet.questionCount / 3} Literal, ${selectedSet.questionCount / 3} Inferential and ${selectedSet.questionCount / 3} Critical questions.`] });
    }
    setValidationIssues(issues);
    if (issues.length) return;
    requestPending.current = true;
    setSaveError(""); setFeedback(""); setBusy(true);
    try {
      const set = await saveMaterialQuestionSet(material.id, selectedSet.id, selectedSet.revision, normalized);
      if (activeIdentity.current !== identity) return;
      setSelectedSet(set); setQuestions(toReviewableQuestions(set.questions)); setSaved(true); setDirty(false);
    } catch (error) {
      if (activeIdentity.current === identity) { setSaved(false); setSaveError(getMaterialServiceError(error, "Unable to save changes.")); }
    } finally { requestPending.current = false; if (activeIdentity.current === identity) setBusy(false); }
  }

  async function approveQuestions() {
    if (!material || !selectedSet || selectedSet.id !== setId || !canReview || busy || requestPending.current || selectedSet.hasStudentAttempts || selectedSet.reviewStatus === "reviewed") return;
    if (dirty) {
      setSaveError("Save your changes before marking this set as reviewed.");
      return;
    }
    requestPending.current = true;
    setBusy(true); setApproving(true); setSaveError(""); setFeedback(""); setSaved(false);
    try {
      const set = await reviewMaterialQuestionSet(material.id, selectedSet.id, selectedSet.revision);
      if (activeIdentity.current !== identity) return;
      setSelectedSet(set); setQuestions(toReviewableQuestions(set.questions));
      setFeedback(`${set.name} marked as reviewed. It is now available for assignment.`);
    } catch (error) {
      if (activeIdentity.current === identity) setSaveError(getMaterialServiceError(error, "Unable to mark this set as reviewed."));
    } finally {
      requestPending.current = false;
      if (activeIdentity.current === identity) { setBusy(false); setApproving(false); }
    }
  }

  async function regenerate() {
    if (!material || !selectedSet || selectedSet.id !== setId || (role !== "teacher" && role !== "system_admin") || !canReview || busy || requestPending.current || dirty || selectedSet.hasStudentAttempts) return;
    requestPending.current = true;
    setBusy(true); setSaveError(""); setFeedback(""); setSaved(false);
    try {
      const set = await regenerateMaterialQuestionSet(material.id, selectedSet.id, selectedSet.revision);
      if (activeIdentity.current !== identity) return;
      setSelectedSet(set); setQuestions(toReviewableQuestions(set.questions)); setRegenerating(false);
      setFeedback(`${set.name} regenerated and saved. Other sets are unchanged.`);
    } catch (error) {
      if (activeIdentity.current === identity) setSaveError(getQuestionGenerationError(error));
    } finally { requestPending.current = false; if (activeIdentity.current === identity) setBusy(false); }
  }

  if (materialsLoading) {
    return (
      <div className="m3-empty-state m3-empty-state--page" role="status">
        <LoaderCircle className="m3-spinner" size={36} />
        <h1>Loading material...</h1>
      </div>
    );
  }

  if (!material) {
    return (
      <div className="m3-empty-state m3-empty-state--page">
        <FileQuestion size={36} />
        <h1>Material not found.</h1>
        <p>The requested material does not exist or is unavailable to your account.</p>
        <Link className={role === "system_admin" ? "m3-back-link" : "m3-button m3-button--primary"} to={role === "admin" ? root : `${root}/materials`}>
          {role === "system_admin" && <ArrowLeft size={17} aria-hidden="true" />} Back to Materials
        </Link>
      </div>
    );
  }

  if (!canReview) {
    return (
      <div className="m3-empty-state m3-empty-state--page">
        <FileQuestion size={36} />
        <h1>Question review unavailable</h1>
        <p>This review route is restricted to authorized administrators or the material owner.</p>
        <Link className={role === "system_admin" ? "m3-back-link" : "m3-button m3-button--primary"} to={`${root}/materials`}>
          {role === "system_admin" && <ArrowLeft size={17} aria-hidden="true" />} Back to Materials
        </Link>
      </div>
    );
  }

  const reviewStatus = selectedSet?.reviewStatus;
  // Students' saved answers point at these questions, so answered sets stay read-only.
  const locked = Boolean(selectedSet?.hasStudentAttempts);

  return (
    <div className="m3-page-stack m3-page-stack--wide">
      <Link className="m3-back-link" to={materialTarget}>
        <ArrowLeft size={17} /> Back to Material
      </Link>
      <M3PageHeader
        eyebrow={role === "system_admin" ? undefined : `${role === "admin" ? "Admin" : "Teacher"} question review`}
        title={selectedSet?.name ?? "Question Set"}
        description={`${material.title} - ${selectedSet?.questionCount ?? 0} Saved Questions`}
        actions={
          reviewStatus ? (
            <M3StatusBadge
              value={reviewStatus}
              label={reviewStatus === "reviewed" ? "Reviewed" : "Needs Review"}
            />
          ) : undefined
        }
      />

      <div className="m3-material-split">
      <aside className="m3-detail-card m3-material-split__text" aria-label="Material text">
        <div className="m3-reading-preview">
          <p className="m3-eyebrow">Reviewed material text</p>
          <p>{material.contentText || "Extracted text is not available for this material."}</p>
        </div>
      </aside>

      <div className="m3-page-stack m3-material-split__main">
      <div className="m3-review-callout">
        <CheckCircle2 size={20} />
        <p>
          Correct answers are system-selected and read-only. Learner views never receive answer-key data.
        </p>
      </div>

      {locked && <p className="m3-error-message" role="status">
        Students have already answered this set in a class activity, so it cannot be edited or regenerated. Generate a new set from the material page instead.
      </p>}
      {!locked && Boolean(selectedSet?.assignedCount) && <p className="m3-review-callout" role="status">
        This set is assigned to a class activity. No student has answered it yet, so you can still change it.
        Saved edits require another review before students can answer the changed questions. Regenerating replaces the questions and also requires review.
      </p>}
      {saveError && <div className="m3-error-message" role="alert">{saveError}
        <button type="button" className="m3-button m3-button--secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>Reload Saved Set</button>
      </div>}
      {feedback && <p className="m3-success-message" role="status">{feedback}</p>}
      {!editing && selectedSet && !locked && <Link className="m3-button m3-button--primary" to={`${materialTarget}/question-sets/${selectedSet.id}/edit`}>Edit This Set</Link>}

      {loading || (selectedSet && selectedSet.id !== setId) ? (
        <div className="m3-empty-state" role="status">
          <LoaderCircle className="m3-spinner" size={34} />
          <h2>Loading generated questions...</h2>
        </div>
      ) : questions.length > 0 ? (
        <div className="m3-question-list">
          {([...questions].sort((a, b) => ["literal", "inferential", "critical"].indexOf(a.type) - ["literal", "inferential", "critical"].indexOf(b.type))).map((question, questionIndex, ordered) => (
            <Fragment key={question.id}>
            {(questionIndex === 0 || ordered[questionIndex - 1].type !== question.type) && <h2>{question.type.toUpperCase()}</h2>}
            <article className="m3-question-editor">
              <fieldset className="m3-set-question-fields" disabled={busy || !editing || locked}>
              <header>
                <div>
                  <span className="m3-question-number">Question {questionIndex + 1}</span>
                  <M3StatusBadge
                    value={question.type}
                    label={question.type.charAt(0).toUpperCase() + question.type.slice(1)}
                  />
                </div>
                <div className="m3-question-selects">
                  <label>
                    <span>Category</span>
                    <select
                      value={question.type}
                      onChange={(event) =>
                        updateQuestion(question.id, {
                          type: event.target.value as QuestionType,
                        })
                      }
                    >
                      <option value="literal">Literal</option>
                      <option value="inferential">Inferential</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                </div>
              </header>

              <label className="m3-field">
                <span>Question</span>
                <textarea
                  rows={3}
                  value={question.questionText}
                  onChange={(event) =>
                    updateQuestion(question.id, { questionText: event.target.value })
                  }
                />
              </label>

              <fieldset className="m3-options-editor">
                <legend>Answer options</legend>
                {question.options.map((option, optionIndex) => (
                  <label key={`${question.id}-${optionIndex}`}>
                    <span>{String.fromCharCode(65 + optionIndex)}</span>
                    <input
                      value={option}
                      onChange={(event) =>
                        updateOption(question.id, optionIndex, event.target.value)
                      }
                    />
                  </label>
                ))}
              </fieldset>

              <div className="m3-form-grid">
                <div className="m3-field">
                  <span id={`${question.id}-correct-answer-label`}>Correct answer</span>
                  <output
                    className="m3-readonly-answer"
                    aria-labelledby={`${question.id}-correct-answer-label`}
                  >
                    {formatCorrectAnswer(question)}
                  </output>
                </div>
                <label className="m3-field">
                  <span>Scaffolding hint</span>
                  <input
                    value={question.scaffoldingHint}
                    onChange={(event) =>
                      updateQuestion(question.id, { scaffoldingHint: event.target.value })
                    }
                  />
                </label>
              </div>
              </fieldset>
            </article>
            </Fragment>
          ))}

          {validationIssues.length > 0 && (
            <div className="m3-error-message" role="alert">
              <strong>Please fix the following before saving or approving:</strong>
              <ul>
                {validationIssues.flatMap((issue, issueIndex) =>
                  issue.messages.map((message) => (
                    <li key={`${issue.questionId ?? "questions"}-${issueIndex}-${message}`}>
                      {issue.questionNumber ? `Question ${issue.questionNumber}: ` : ""}
                      {message}
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}

          {saved && (
            <p className="m3-success-message" role="status">
              Changes saved. Questions you changed need review.
            </p>
          )}
          {dirty && <p role="status">Unsaved changes. Save changes before marking this set as reviewed.</p>}
          {!locked && <div className="m3-form-actions">
            <button className="m3-button m3-button--primary" type="button" disabled={busy || !editing || !dirty} aria-busy={busy && !approving} onClick={() => void saveQuestions()}>
              <Save size={17} /> {busy && !approving ? "Saving..." : "Save Changes"}
            </button>
            <button className="m3-button m3-button--primary" type="button" disabled={busy || !selectedSet || reviewStatus === "reviewed"} aria-busy={approving} onClick={() => void approveQuestions()}>
              <CheckCircle2 size={17} /> {approving ? "Marking as Reviewed..." : "Mark as Reviewed"}
            </button>
          </div>}
          {(role === "teacher" || role === "system_admin") && selectedSet && !locked && (
            <section className="m3-detail-card m3-saved-set-card" aria-label="Regenerate selected set">
              <h2>Need a different version of this set?</h2>
              {dirty && <p>Save your edits before regenerating this set.</p>}
              {regenerating ? <>
                <p>Regenerating will replace ONLY {selectedSet.name}. Other saved sets will stay unchanged.</p>
                <div className="m3-form-actions">
                  <button type="button" className="m3-button m3-button--secondary" disabled={busy} onClick={() => setRegenerating(false)}>Cancel</button>
                  <button type="button" className="m3-button m3-button--coral" disabled={busy || dirty} aria-busy={busy} onClick={() => void regenerate()}>Regenerate This Set</button>
                </div>
              </> : <button type="button" className="m3-button m3-button--secondary" disabled={busy || dirty} onClick={() => setRegenerating(true)}>Regenerate This Set</button>}
              {busy && !approving && <p role="status">Saving questions for {selectedSet.name}...</p>}
            </section>
          )}
        </div>
      ) : (
        <div className="m3-empty-state">
          <FileQuestion size={34} />
          <h2>No generated questions are available yet.</h2>
          <p>Generate questions from the material page before opening the review workflow.</p>
          <Link className={role === "system_admin" ? "m3-back-link" : "m3-button m3-button--primary"} to={materialTarget}>
            {role === "system_admin" && <ArrowLeft size={17} aria-hidden="true" />} Back to Material
          </Link>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
