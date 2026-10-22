import "../components/DiagnosticProgress.css";
import { createPassageDiagnosticResult } from "../services/diagnosticPassage";
import { useDiagnosticSession } from "../components/DiagnosticSessionProvider";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import DiagnosticLayout from "../components/DiagnosticLayout";
import { getDiagnosticPassageText } from "../data/diagnosticData";
import {
  type DiagnosticAnswers,
} from "../services/diagnosticScoring";
import { DiagnosticDatabaseError, saveInitialDiagnosticResult } from "../services/diagnosticDatabase";
import { logDiagnosticScoreAudit } from "../services/diagnosticScoreAudit";
import type {
  DiagnosticAssessment,
  DiagnosticResult,
} from "../types/diagnostic";
import "./DiagnosticQuestionsPage.css";

/** Display-only shuffle: choice ids and the answer key in the data never change. */
function shuffleChoiceOrder(assessment: DiagnosticAssessment) {
  return Object.fromEntries(assessment.questions.map(question => {
    const ids = question.choices.map(choice => choice.id);
    for (let index = ids.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [ids[index], ids[swap]] = [ids[swap], ids[index]];
    }
    return [question.id, ids];
  }));
}

interface DiagnosticQuestionsPageProps {
  assessment: DiagnosticAssessment;
}

export default function DiagnosticQuestionsPage({
  assessment,
}: DiagnosticQuestionsPageProps) {
  const navigate = useNavigate();
  const diagnosticSession = useDiagnosticSession();
  const [session] = useState(() => diagnosticSession.get(assessment));
  const reading = session?.reading;
  const mounted = useRef(false);
  const saving = useRef(false);
  const advancedQuestion = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { questions } = assessment;
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(session?.questionIndex ?? 0);
  const [answers, setAnswers] = useState<DiagnosticAnswers>(session?.answers ?? {});
  const [pendingResult, setPendingResult] = useState<DiagnosticResult | null>(
    null,
  );
  const [choiceOrder] = useState(() => shuffleChoiceOrder(assessment));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentQuestionIndex];
  const selectedChoiceId = currentQuestion
    ? answers[currentQuestion.id]
    : undefined;
  const isFinalQuestion = currentQuestionIndex === totalQuestions - 1;

  useEffect(() => {
    if (session) diagnosticSession.save(assessment, { ...session, answers, questionIndex: currentQuestionIndex });
  }, [session, diagnosticSession, assessment, answers, currentQuestionIndex]);

  if (!reading || !session) return <Navigate to={`/diagnostic/${assessment.language}/reading`} replace />;

  if (!currentQuestion) {
    return (
      <DiagnosticLayout
        className="diagnostic-questions-panel"
        labelledBy="diagnostic-questions-title"
      >
        <h1 id="diagnostic-questions-title">Answer the Questions</h1>
        <p>No diagnostic questions are available yet.</p>
      </DiagnosticLayout>
    );
  }

  function selectAnswer(choiceId: string) {
    if (pendingResult) return;

    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [currentQuestion.id]: choiceId,
    }));
  }

  async function continueAssessment() {
    if (!reading || !selectedChoiceId || isSaving || saving.current) return;

    if (!isFinalQuestion) {
      if (advancedQuestion.current === currentQuestion.id) return;
      advancedQuestion.current = currentQuestion.id;
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      return;
    }

    if (questions.some(q => !q.choices.some(c => c.id === answers[q.id]))) return;

    const result =
      pendingResult ??
      createPassageDiagnosticResult(assessment, reading, answers);

    if (!pendingResult) setPendingResult(result);

    saving.current = true;
    setIsSaving(true);
    setSaveError(null);

    try {
      const savedResult = await saveInitialDiagnosticResult(result);
      if (!mounted.current) return;
      logDiagnosticScoreAudit(
        getDiagnosticPassageText(assessment), reading.transcription.text, reading.oralReadingMetrics,
        assessment.language,
      );
      diagnosticSession.clear(assessment);
      navigate(`/diagnostic/${savedResult.result.language}/result`);
    } catch (error) {
      if (!mounted.current) return;
      const code = error instanceof DiagnosticDatabaseError ? error.code : undefined;
      if (code === "ALREADY_COMPLETED") {
        // A verified result already exists for this diagnostic; show that one.
        diagnosticSession.clear(assessment);
        navigate(`/diagnostic/${assessment.language}/result`, { replace: true });
        return;
      }
      if (code === "READING_NOT_VERIFIED") {
        // The saved reading cannot be scored (for example, older than a day);
        // drop it so "Back to the story" starts a new recording.
        diagnosticSession.clear(assessment);
        setPendingResult(null);
      }
      setSaveError(
        code === "READING_NOT_VERIFIED" || code === "ASSESSMENT_CHANGED" || code === "AUTH_REQUIRED"
          ? (error as Error).message
          : "We couldn't save your result. Your answers are still here—please try again.",
      );
    } finally {
      saving.current = false;
      if (mounted.current) setIsSaving(false);
    }
  }

  const displayedChoices = (choiceOrder[currentQuestion.id] ?? [])
    .flatMap(id => currentQuestion.choices.filter(choice => choice.id === id));

  return (
    <DiagnosticLayout
      className="diagnostic-questions-panel"
      labelledBy="diagnostic-questions-title"
    >
      <button type="button" className="diagnostic-recording-secondary-button" disabled={isSaving || pendingResult !== null} onClick={() => navigate(`/diagnostic/${assessment.language}/reading`)}>Back to the story</button>
      <header className="diagnostic-questions-header">
        <h1 id="diagnostic-questions-title">Answer the Questions</h1>
        <p>Choose the best answer. Take your time!</p>
      </header>

      <section
        className="diagnostic-question-card"
        aria-labelledby="diagnostic-question-prompt"
      >
        <p className="diagnostic-question-counter">
          Question {currentQuestionIndex + 1} of {totalQuestions}
        </p>
        <h2 id="diagnostic-question-prompt">{currentQuestion.prompt}</h2>

        <fieldset className="diagnostic-answer-list">
          <legend className="diagnostic-visually-hidden">
            Select one answer
          </legend>
          {displayedChoices.map((choice) => (
            <label
              className={`diagnostic-answer${
                selectedChoiceId === choice.id
                  ? " diagnostic-answer--selected"
                  : ""
              }`}
              key={choice.id}
            >
              <input
                type="radio"
                name={currentQuestion.id}
                value={choice.id}
                checked={selectedChoiceId === choice.id}
                disabled={isSaving || pendingResult !== null}
                onChange={() => selectAnswer(choice.id)}
              />
              <span className="diagnostic-answer-indicator" aria-hidden="true" />
              <span>{choice.label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      {saveError && (
        <p className="diagnostic-save-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="diagnostic-actions">
        <button
          className="diagnostic-primary-button"
          type="button"
          disabled={!selectedChoiceId || isSaving}
          onClick={() => void continueAssessment()}
        >
          {isSaving
            ? "Saving Result..."
            : saveError
              ? "Try Saving Again"
              : isFinalQuestion
                ? "View Result"
                : "Next"}
        </button>
      </div>
    </DiagnosticLayout>
  );
}
