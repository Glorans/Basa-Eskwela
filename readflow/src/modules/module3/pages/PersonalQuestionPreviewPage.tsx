import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, Pencil, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import M3PageHeader from "../components/M3PageHeader";
import { useM3Content } from "../context/M3ContentContext";
import QuestionBankEditorModal, { type EditableQuestion } from "../components/QuestionBankEditorModal";
import ComprehensionStudentPreview from "../components/ComprehensionStudentPreview";
import QuestionCountInput from "../components/QuestionCountInput";
import { checkQuestionCount } from "../utils/questionCount";
import {
  getPersonalEditableBank,
  savePersonalEditableBank,
  type PersonalEditableBank,
  getMaterialServiceError,
  getNewPersonalQuestions,
  getPersonalPracticeState,
  getPersonalQuestionPreview,
  type PersonalPracticeState,
  type PersonalQuestionPreview,
} from "../services/materialService";
import { getQuestionGenerationError } from "../services/questionGenerationError";
import { QUESTION_LOCKS, REGENERATE_CONFIRMATION } from "../components/PersonalMaterialPractice";
import "./PersonalQuestionPreviewPage.css";

const TYPE_ORDER = ["literal", "inferential", "critical"] as const;
const TYPE_LABEL = { literal: "Literal", inferential: "Inferential", critical: "Critical" } as const;
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Independent Learner: review the generated questions before the comprehension. Read-only: the server sends only the
 * question and its choices, never the answer, explanation, evidence or hint, and previewing saves nothing, so it never
 * uses the one comprehension assessment. Before any assessment the learner may Regenerate Questions (a whole new set for
 * the same text; the server applies the usual limits and refuses once an assessment exists).
 * M3 all-role refinement: Edit Questions opens the learner's own private set with its answers in the shared editor
 * (their private practice: no XP, no one else sees it). Saving keeps the same questions and categories; it is locked
 * once the comprehension for this material has started, because that assessment is scored from these answers.
 */
export default function PersonalQuestionPreviewPage() {
  const { materialId = "" } = useParams<{ materialId: string }>();
  const { getMaterial } = useM3Content();
  const material = getMaterial(materialId);
  const [preview, setPreview] = useState<PersonalQuestionPreview | null>(null);
  const [practice, setPractice] = useState<PersonalPracticeState | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [questionCount, setQuestionCount] = useState("9");
  const [editing, setEditing] = useState<PersonalEditableBank | null>(null);
  const [opening, setOpening] = useState(false);
  const [previewing, setPreviewing] = useState<EditableQuestion[] | null>(null);
  const root = `/m3/general/materials/${encodeURIComponent(materialId)}`;

  const load = useCallback(async () => {
    const [questions, state] = await Promise.all([getPersonalQuestionPreview(materialId), getPersonalPracticeState(materialId)]);
    setPreview(questions); setPractice(state);
  }, [materialId]);
  useEffect(() => {
    let active = true;
    load().catch((loadError) => { if (active) setError(getMaterialServiceError(loadError, "Unable to load your questions.")); });
    return () => { active = false; };
  }, [load]);

  async function openEditor() {
    if (opening) return;
    setOpening(true); setActionError(""); setNotice("");
    try {
      const bank = await getPersonalEditableBank(materialId);
      if (bank.locked || !bank.setId) { setActionError("These questions are locked because your comprehension for this material has started."); return; }
      setEditing(bank);
    } catch (openError) {
      setActionError(getMaterialServiceError(openError, "Unable to open your questions for editing."));
    } finally { setOpening(false); }
  }

  const toEditable = (bank: PersonalEditableBank): EditableQuestion[] => bank.questions.map((question) => ({
    id: question.id, type: question.type, questionText: question.questionText,
    options: [0, 1, 2, 3].map((index) => question.options[index] ?? "") as EditableQuestion["options"],
    correctIndex: question.correctOptionIndex, scaffoldingHint: question.scaffoldingHint ?? "",
    answerExplanation: question.answerExplanation ?? "", supportingEvidence: question.supportingEvidence ?? "",
  }));

  async function getNewQuestions() {
    const count = checkQuestionCount(questionCount);
    if (replacing || !count.ok) return;
    if (!(await confirmReadFlow(REGENERATE_CONFIRMATION, { confirm: "Regenerate Questions", cancel: "Keep my questions" }))) return;
    setReplacing(true); setActionError(""); setNotice("");
    try {
      await getNewPersonalQuestions(materialId, count.value);
      await load();
      setNotice("Your new questions are ready.");
    } catch (replaceError) {
      setActionError(getQuestionGenerationError(replaceError));
    } finally {
      setReplacing(false);
    }
  }

  const back = <Link className="m3-back-link" to={root}><ArrowLeft size={17} aria-hidden="true" /> Back to Material</Link>;
  if (error) {
    return <div className="m3-page-stack m3-page-stack--narrow">{back}
      <div className="m3-empty-state" role="alert"><h2>Questions unavailable</h2><p>{error}</p>
        <Link className="m3-button m3-button--secondary" to={root}>Back to Material</Link></div></div>;
  }
  if (!preview || !practice) {
    return <div className="m3-page-stack m3-page-stack--narrow">{back}
      <div className="m3-empty-state" role="status"><LoaderCircle className="m3-spinner" size={34} aria-hidden="true" /><h2>Loading your questions...</h2></div></div>;
  }

  const ordered = [...preview.questions].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const completed = practice.attemptStatus === "completed";
  const canStart = !practice.attemptId && practice.reviewed && Boolean(practice.readingId);

  return (
    <div className="m3-page-stack m3-page-stack--narrow m3-question-preview">
      {back}
      <M3PageHeader
        eyebrow="Preview Questions"
        title={material?.title ?? "Your reading"}
        description={`Your question set · ${preview.questions.length} questions`}
      />
      <p className="m3-question-preview__note">Review your questions before starting comprehension. The answers appear after you finish, unless you open Edit Questions.</p>
      {!practice.attemptId && <div className="m3-form-actions">
        <button type="button" className="m3-button m3-button--secondary" disabled={opening || replacing} onClick={() => void openEditor()}>
          <Pencil size={17} aria-hidden="true" /> {opening ? "Opening..." : "Edit Questions"}</button>
      </div>}
      {notice && <p className="m3-success-message" role="status">{notice}</p>}
      {actionError && <p className="m3-error-message" role="alert">{actionError}</p>}

      <div className="m3-question-preview__list" aria-label="Your questions">
        {ordered.map((question, index) => (
          <article className="m3-question-preview__item" key={question.id}>
            <div className="m3-question-preview__meta">
              <p className="m3-question-preview__number">Question {index + 1}</p>
              <span className="m3-question-preview__type">{TYPE_LABEL[question.type]}</span>
            </div>
            <p className="m3-question-preview__text">{question.questionText}</p>
            <ol className="m3-question-preview__options" aria-label={`Choices for question ${index + 1}`}>
              {question.options.map((option, optionIndex) => (
                <li key={optionIndex}><span aria-hidden="true">{LETTERS[optionIndex]}</span>{option}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      <section className="m3-panel m3-question-preview__actions" aria-label="What to do next">
        {practice.attemptId ? <>
          <p>{QUESTION_LOCKS[completed ? "assessment_completed" : "assessment_unfinished"]}</p>
          <Link className="m3-button m3-button--primary" to={`/m3/general/comprehension/${encodeURIComponent(practice.attemptId)}`}>
            {completed ? "View Comprehension Result" : "Resume Comprehension"}</Link>
        </> : canStart ? <>
          <p>Ready? You can answer the questions one time.</p>
          <Link className="m3-button m3-button--primary"
            to={`${root}/comprehension?oralReadingAttemptId=${encodeURIComponent(practice.readingId ?? "")}`}>Start Comprehension</Link>
        </> : <>
          <p>Read the text aloud first. Then you can answer the questions.</p>
          <Link className="m3-button m3-button--primary" to={`${root}/read-aloud?recordAgain=1`}>Read Aloud</Link>
        </>}
        {practice.canGetNewQuestions && <QuestionCountInput value={questionCount} onChange={setQuestionCount} disabled={replacing} label="Questions in a new set" />}
        {practice.canGetNewQuestions && (
          <button type="button" className="m3-button m3-button--secondary" disabled={replacing || !checkQuestionCount(questionCount).ok} onClick={() => void getNewQuestions()}>
            {replacing ? <LoaderCircle className="m3-spinner" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            {replacing ? "Making new questions…" : "Regenerate Questions"}
          </button>
        )}
        <Link className="m3-button m3-button--secondary" to={root}>Back to Material</Link>
      </section>
      {editing && editing.setId && (
        <QuestionBankEditorModal
          title={`Edit Questions · ${material?.title ?? "Your reading"}`}
          subtitle={`${editing.questions.length} questions in your private set`}
          questions={toEditable(editing)}
          rules={{ requireExplanation: true, requireEvidence: true, evidenceSource: material?.contentText ?? undefined }}
          notice="This editor shows the correct answers. Your comprehension for this material is scored from the answers you save here. Editing is private practice: it earns no XP and no one else sees it."
          onPreview={(questions) => setPreviewing(questions)}
          onClose={() => setEditing(null)}
          onSave={async (questions) => {
            try {
              await savePersonalEditableBank(materialId, editing.setId as string, questions.map((question) => ({
                id: question.id, type: question.type, questionText: question.questionText, options: [...question.options],
                correctOptionIndex: question.correctIndex, scaffoldingHint: question.scaffoldingHint,
                answerExplanation: question.answerExplanation, supportingEvidence: question.supportingEvidence,
              })));
            } catch (saveError) {
              throw new Error(getMaterialServiceError(saveError, "Your questions could not be saved. Your edits are still here."));
            }
            setEditing(null);
            await load();
            setNotice("Your edited questions were saved.");
          }}
        />
      )}
      {previewing && <ComprehensionStudentPreview title={material?.title ?? "Your reading"} questions={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}
