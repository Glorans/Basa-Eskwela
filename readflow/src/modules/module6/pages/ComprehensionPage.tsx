import { activityLanguageFromState, activityLanguageState, getActivityText } from "../../../pages/reading-activity/activityLanguage";
import OralReadingSummary from "../../module5/components/OralReadingSummary";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  getComprehension,
  startComprehension,
  sendComprehensionAction,
  type ComprehensionAttempt,
  type ComprehensionAction,
  type ComprehensionQuestion,
} from "../services/comprehensionService";
import "./ComprehensionPage.css";

type Props = {
  role: "student" | "general_user";
  results?: boolean;
};

const questionTypes = [
  "literal",
  "inferential",
  "critical",
] as const;

const typeLabels = {
  literal: "Literal",
  inferential: "Inferential",
  critical: "Critical",
} as const;

const practiceTips = {
  literal:
    "Look for details stated directly in the passage, such as who, what, where, and when.",
  inferential:
    "Connect clues in the passage to work out something the writer does not say directly.",
  critical:
    "Think about the characters' choices or the writer's message. Use details from the passage to support your judgment.",
} as const;

function AnswerFeedback({
  question, t,
}: {
  question: ComprehensionQuestion;
  t: ReturnType<typeof getActivityText>["t"];
}) {
  if (!question.resolved) return null;

  const correctIndex = question.correctOptionIndex;
  const correctAnswer =
    typeof correctIndex === "number"
      ? question.options[correctIndex]
      : undefined;

  return (
    <aside className="m6-answer-feedback">
      {correctAnswer && (
        <p>
          <strong>{t("Correct answer: ")}</strong>
          {correctAnswer}
        </p>
      )}

      {question.answerExplanation && (
        <p>
          <strong>{t("Why this answer fits: ")}</strong>
          {question.answerExplanation}
        </p>
      )}

      {question.supportingEvidence && (
        <p>
          <strong>{t("Evidence from the passage: ")}</strong>
          <q>{question.supportingEvidence}</q>
        </p>
      )}

      {!question.answerExplanation && (
        <p>{t("Think back to the story you just read and remember the clues that support the correct answer.")}</p>
      )}
    </aside>
  );
}

export default function ComprehensionPage({ role, results = false }: Props) {
  const { moduleId, materialId, attemptId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [loadedAttempt, setAttempt] =
    useState<ComprehensionAttempt | null>(null);
  const attempt = loadedAttempt?.id === attemptId ? loadedAttempt : null;
  const ui = getActivityText(attempt ? attempt.language : activityLanguageFromState(location.state));
  const { language, t } = ui;
  const activityState = activityLanguageState(language);
  const [index, setIndex] = useState(0);
  const drafts = useRef<Record<number, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const lock = useRef(false);
  const completing = useRef("");
  const autoStarted = useRef("");
  const pending = useRef<ComprehensionAction | null>(null);
  const submissionId = useRef<string | null>(null);

  const passageId = params.get("passageId");
  const roomId = params.get("roomId");
  const assignmentId = params.get("assignmentId");
  const activityAssignmentId = params.get("activityAssignmentId");
  const oralReadingAttemptId = params.get("oralReadingAttemptId");
  const sourceKey = `${moduleId}:${materialId}:${passageId}:${roomId}:${assignmentId}:${activityAssignmentId}:${oralReadingAttemptId}:${attemptId}`;
  const currentSource = useRef(sourceKey);
  currentSource.current = sourceKey;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const hasSource = Boolean(materialId ? activityAssignmentId && roomId && oralReadingAttemptId : moduleId && passageId);

  const resultBase =
    role === "student"
      ? "/dashboard/comprehension"
      : "/m3/general/comprehension";

  const home = (attempt?.materialId ?? materialId) && (attempt?.roomId ?? roomId)
    ? `/dashboard/learning-rooms/${attempt?.roomId ?? roomId}`
    : role === "student" ? "/dashboard" : "/m3/general";

  useEffect(() => {
    let active = true;

    setAttempt(null);
    completing.current = "";
    setIndex(0);
    setError("");
    setMessage("");
    setSelected(null);
    drafts.current = {};
    setBusy(Boolean(attemptId));
    pending.current = null;
    submissionId.current = null;

    if (attemptId) {
      void getComprehension(attemptId)
        .then((saved) => {
          if (!active) return;

          setAttempt(saved);

          const next = saved.questions.findIndex(
            (question) => !question.resolved,
          );

          setIndex(
            next < 0
              ? Math.max(0, saved.questions.length - 1)
              : next,
          );
        })
        .catch((err: unknown) => {
          if (active) {
            setError(
              err instanceof Error
                ? err.message
                : "Unable to load activity.",
            );
          }
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }

    return () => {
      active = false;
    };
  }, [attemptId, moduleId, materialId, passageId, roomId, assignmentId, activityAssignmentId, oralReadingAttemptId]);

  async function start() {
    if (lock.current || !hasSource) return;

    const startedSource = sourceKey;
    lock.current = true;
    setBusy(true);
    setError("");

    try {
      if (!submissionId.current) {
        submissionId.current = crypto.randomUUID();
      }

      const saved = await startComprehension({
        ...(materialId ? { materialId, activityAssignmentId } : { moduleId, passageId }),
        ...(oralReadingAttemptId ? { oralReadingAttemptId } : {}),
        submissionId: submissionId.current,
        ...(roomId ? { roomId } : {}),
        ...(assignmentId ? { assignmentId } : {}),
      });

      if (!mounted.current || currentSource.current !== startedSource) return;
      navigate(`${resultBase}/${saved.id}`, {
        replace: true, state: activityLanguageState(saved.language),
      });
    } catch (err: unknown) {
      if (!mounted.current || currentSource.current !== startedSource) return;
      setError(
        err instanceof Error
          ? err.message
          : "Unable to start activity.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const key = `${materialId}:${roomId}:${activityAssignmentId}:${oralReadingAttemptId}`;
    if (role !== "student" || !materialId || attemptId || !hasSource || autoStarted.current === key || lock.current) return;
    autoStarted.current = key;
    void start();
  }, [role, materialId, attemptId, roomId, activityAssignmentId, oralReadingAttemptId, hasSource, busy]);

  async function perform(action: ComprehensionAction) {
    if (!attempt || lock.current) return;

    const startedSource = sourceKey;
    lock.current = true;
    pending.current = action;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await sendComprehensionAction(
        attempt.id,
        action,
      );

      if (!mounted.current || currentSource.current !== startedSource) return;
      setAttempt(result.attempt);
      pending.current = null;

      if (action.action === "answer") {
        setSelected(null);

        setMessage(
          result.outcome.correct
            ? "Correct! Continue when you are ready."
            : result.outcome.resolved
              ? "Your second answer was incorrect. Review the correct answer and its clues below."
              : "Not quite. Try to remember the story you just read, or use a hint, then try once more.",
        );
      }
    } catch (err: unknown) {
      // Retry the same action and request ID after an uncertain save.
      if (!mounted.current || currentSource.current !== startedSource) return;
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save. Please retry.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!attempt?.materialId) return;
    if (attempt.status === "completed") {
      if (!results) navigate(`${resultBase}/${attempt.id}/results`, { replace: true, state: activityLanguageState(attempt.language) });
      return;
    }
    if (attempt.summary.allResolved && !busy && !lock.current && !pending.current && completing.current !== attempt.id) {
      completing.current = attempt.id;
      void perform({ action: "complete" });
    }
  }, [attempt, busy, results, resultBase, navigate]);

  function answer() {
    const currentQuestion = attempt?.questions[index];

    if (
      !currentQuestion ||
      currentQuestion.resolved ||
      selected === null ||
      pending.current ||
      lock.current
    ) {
      return;
    }

    void perform({
      action: "answer",
      questionId: currentQuestion.id,
      optionIndex: selected,
      requestId: crypto.randomUUID(),
    });
  }

  const readingMaterialId = attempt?.materialId ?? materialId;
  const readingRoomId = attempt?.roomId ?? roomId;
  const readingAssignmentId = attempt?.activityAssignmentId ?? activityAssignmentId;
  const readingTarget = readingMaterialId && readingRoomId && readingAssignmentId
    ? `/dashboard/reading-materials/${encodeURIComponent(readingMaterialId)}/read-aloud?${new URLSearchParams({
      roomId: readingRoomId, activityAssignmentId: readingAssignmentId, viewReading: "1",
    })}` : home;
  const reviewingQuestions = Boolean(readingMaterialId && attempt?.status !== "completed");
  const question = attempt?.questions[index];
  const hasPending = pending.current !== null;

  const areasToPractice = attempt
    ? questionTypes.filter((type) => {
        const group = attempt.summary.byType[type];

        return (
          group.total > 0 &&
          group.firstCorrect < group.total
        );
      })
    : [];

  return (
    <main lang={language} className={`m6-page${readingMaterialId ? " m6-page--assigned" : ""}${attempt?.status !== "completed" ? " m6-page--questions" : ""}`} aria-busy={busy}>
      <button
        className="m6-back-button"
        type="button"
        disabled={busy || hasPending}
        onClick={() => navigate(reviewingQuestions ? readingTarget : home, { state: activityState })}
      >
        {reviewingQuestions ? t("Back to reading activity") : readingMaterialId ? t("Back to Learning Room") : t("Back to dashboard")}
      </button>

      <h1>{attempt?.materialId && attempt.status === "completed" ? t("Your Assessment Results") : t("Comprehension Activity")}</h1>
      {materialId && roomId && activityAssignmentId && error && !attempt &&
        <p><Link state={activityState} to={`/dashboard/reading-materials/${materialId}/read-aloud?${new URLSearchParams({ roomId, activityAssignmentId, recordAgain: "1" })}`}>{t("Read the story again")}</Link></p>}

      {error && (
        <div className="m6-card m6-error" role="alert">
          <p>{ui.message(error, attempt ? "Unable to save. Please retry." : attemptId ? "Unable to load activity." : "Unable to start activity.")}</p>

          {attempt && pending.current && (
            <button
              className="m6-button"
              type="button"
              disabled={busy}
              onClick={() => {
                const action = pending.current;
                if (action) void perform(action);
              }}
            >{t("Retry saving")}</button>
          )}

          {attemptId && !attempt && (
            <button
              className="m6-button"
              type="button"
              disabled={busy}
              onClick={() => window.location.reload()}
            >{t("Reload activity")}</button>
          )}
        </div>
      )}

      {busy && (
        <p className="m6-loading" role="status">{t("Please wait…")}</p>
      )}

      {!attempt && !attemptId && (!materialId || Boolean(error) || !hasSource) && (
        <section className="m6-card">
          <h2>{t("Ready to answer?")}</h2>

          <p>{t("Answer questions about the passage you have read. You may use a hint and try again once. Your first answer is recorded separately.")}</p>

          {!hasSource ? (
            <p>{t("Complete and save a Read-Aloud activity, then select Continue to Comprehension on its result page.")}</p>
          ) : (
            <div className="m6-actions">
              <button
                className="m6-button"
                type="button"
                disabled={busy}
                onClick={() => void start()}
              >
                {materialId ? t("Retry comprehension") : t("Start or reopen comprehension")}
              </button>
            </div>
          )}
        </section>
      )}

      {attempt?.status === "completed" && attempt.materialId && attempt.oralReadingAttemptId &&
        <OralReadingSummary language={language} attemptId={attempt.oralReadingAttemptId} />}

      {attempt?.status === "completed" ? (
        <section className="m6-card">
          <h2>{t("Your comprehension results")}</h2>

          <div className="m6-score">
            <span>{t("First-answer score")}</span>
            <strong>
              {attempt.summary.firstAttemptPercentage}%
            </strong>
            <span>
              {attempt.summary.firstCorrect}{t(" of ")}
              {attempt.summary.totalQuestions}{t(" correct")}
            </span>
          </div>

          <p>{t("Questions where you used a hint:")}{" "}
            <strong>{attempt.summary.hintsUsed}</strong>
          </p>

          <p>{t("This score uses your first answer to each question, including answers given after using a hint. Second answers do not change this score.")}</p>

          <ul className="m6-results-list">
            {questionTypes.map((type) => {
              const group = attempt.summary.byType[type];

              return (
                <li key={type}>
                  <strong>{t(typeLabels[type])}:</strong>{" "}
                  {group.total > 0 ? t("{correct}/{total} correct on the first answer ({percentage}%)", { correct: group.firstCorrect, total: group.total, percentage: group.firstAttemptPercentage }) : t("No questions in this category.")}
                </li>
              );
            })}
          </ul>

          {areasToPractice.length > 0 ? (
            <>
              <h3>{t("What to practice next")}</h3>

              <ul>
                {areasToPractice.map((type) => (
                  <li key={type}>
                    <strong>{t(typeLabels[type])}: </strong>
                    {t(practiceTips[type])}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t("You answered every question correctly on your first answer. Great work! Review the explanations to see how the passage supports each answer.")}</p>
          )}

          <h2 className="m6-review-heading">{t("Your answer review")}</h2>

          <details><summary>{t("Question explanations and supporting evidence")}</summary>
          <div className="m6-review-list">
            {attempt.questions.map((item, itemIndex) => (
              <article className="m6-review-item" key={item.id}>
                <h3>
                  {itemIndex + 1}. {item.questionText}
                </h3>

                <p>{t("First answer:")}{" "}
                  {item.firstOptionIndex === null
                    ? t("No answer recorded")
                    : item.options[item.firstOptionIndex]}
                </p>

                <p>
                  {item.firstAnswerCorrect === null
                    ? t("No first-answer result recorded.")
                    : item.firstAnswerCorrect
                      ? t("Correct on your first answer.")
                      : t("Incorrect on your first answer.")}
                </p>

                {item.answerHistory.length > 1 && (
                  <p>{t("Second answer:")}{" "}
                    {
                      item.options[
                        item.answerHistory[1].optionIndex
                      ]
                    }{" "}
                    (
                    {item.answerHistory[1].correct
                      ? t("Correct")
                      : t("Incorrect")}
                    )
                  </p>
                )}

                {item.hint && (
                  <aside>
                    <strong>{t("Hint used: ")}</strong>
                    {item.hint}
                  </aside>
                )}

                <AnswerFeedback t={t} question={item} />
              </article>
            ))}
          </div>
          </details>
        </section>
      ) : attempt && question ? (
        <section className="m6-card m6-question-card" aria-label={t("Current question")}>
          <p className="m6-question-progress">{t("Question ")}{index + 1}{t(" of ")}{attempt.questions.length}
            {" · "}
            {t(typeLabels[question.type])}
          </p>

          <h2>{question.questionText}</h2>

          <fieldset
            disabled={busy || question.resolved || hasPending}
          >
            <legend>{t("Choose one answer")}</legend>

            {question.options.map((option, optionIndex) => (
              <label
                className="m6-option"
                key={`${question.id}-${optionIndex}`}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={optionIndex}
                  checked={(question.resolved ? question.answerHistory.at(-1)?.optionIndex ?? question.firstOptionIndex : selected) === optionIndex}
                  onChange={() => { drafts.current[index] = optionIndex; setSelected(optionIndex); }}
                />

                <span>
                  <strong>
                    {String.fromCharCode(65 + optionIndex)}.
                  </strong>{" "}
                  {option}
                </span>
              </label>
            ))}
          </fieldset>

          {question.hint && (
            <aside>
              <strong>{t("Hint: ")}</strong>
              {question.hint}
            </aside>
          )}

          {message && (
            <p className="m6-feedback" role="status">
              {ui.message(message, "Unable to save. Please retry.")}
            </p>
          )}

          {question.firstOptionIndex !== null && (
            <details className="m6-answer-details" key={question.id}>
              <summary>{t("Review answer feedback")}</summary>
            <p>{t("Your first answer:")}{" "}
              <strong>
                {question.options[question.firstOptionIndex]}
              </strong>
              {" — "}
              {question.firstAnswerCorrect
                ? t("Correct")
                : t("Incorrect")}
            </p>
            <AnswerFeedback t={t} question={question} />
            </details>
          )}

          <div className="m6-actions">
            <button className="m6-button m6-button--previous" type="button"
              disabled={busy || hasPending || index === 0}
              onClick={() => { setIndex(index - 1); setSelected(drafts.current[index - 1] ?? null); setMessage(""); }}>{t("Previous Question")}</button>
            {!question.resolved && (
              <>
                <button
                  className="m6-button"
                  type="button"
                  disabled={
                    busy || selected === null || hasPending
                  }
                  onClick={answer}
                >
                  {question.answerHistory.length > 0
                    ? t("Check second answer")
                    : index === attempt.questions.length - 1 ? t("Submit") : t("Check answer")}
                </button>

                <button
                  className="m6-button m6-button--hint"
                  type="button"
                  disabled={
                    busy || question.hintUsed || hasPending
                  }
                  onClick={() =>
                    void perform({
                      action: "hint",
                      questionId: question.id,
                    })
                  }
                >{t("Help me")}</button>
              </>
            )}

            {index < attempt.questions.length - 1 && (
              <button className="m6-button" type="button"
                disabled={busy || hasPending || !question.resolved}
                onClick={() => {
                  setIndex(index + 1);
                  setSelected(drafts.current[index + 1] ?? null);
                  setMessage("");
                }}>{t("Next Question")}</button>
            )}

            {attempt.summary.allResolved && !attempt.materialId && (
              <button
                className="m6-button"
                type="button"
                disabled={busy || hasPending}
                onClick={() =>
                  void perform({ action: "complete" })
                }
              >{t("Finish Assessment")}</button>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
