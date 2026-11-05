import { activityLanguageFromState, activityLanguageState, getActivityText } from "../../../pages/reading-activity/activityLanguage";
import { ArrowLeft } from "lucide-react";
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
  getComprehensionForReading,
  startComprehension,
  sendComprehensionAction,
  type LinkedComprehension,
  type ComprehensionAttempt,
  type ComprehensionAction,
  type ComprehensionQuestion,
} from "../services/comprehensionService";
import "./ComprehensionPage.css";
import StoryDrawer from "../components/StoryDrawer";
import ReadingMascot from "../../../components/reading-feedback/ReadingMascot";
import { comprehensionResultTarget, learningAreaTarget, readingResultTarget } from "../../module5/services/comprehensionNavigation";

type Props = {
  /** "admin": Admin self-practice on the Admin's own published modules (enforced by the server). */
  role: "student" | "general_user" | "admin";
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

/** F3 Receive Contextualized Feedback: correct or incorrect, then why, from the saved passage. */
function SubmittedAnswerFeedback({
  question, ui,
}: {
  question: ComprehensionQuestion;
  ui: ReturnType<typeof getActivityText>;
}) {
  const { t } = ui;
  if (!question.resolved || question.firstOptionIndex === null) return null;
  const correct = question.firstAnswerCorrect === true;
  return (
    <section className={`m6-submitted-feedback m6-submitted-feedback--${correct ? "correct" : "incorrect"}`}
      aria-labelledby={`m6-verdict-${question.id}`} role="status">
      <h3 id={`m6-verdict-${question.id}`}>{correct ? t("Correct!") : t("Incorrect")}</h3>
      <p>{t("Your answer:")} <strong>{question.options[question.firstOptionIndex]}</strong></p>
      <AnswerFeedback ui={ui} question={question} />
    </section>
  );
}

function AnswerFeedback({
  question, ui,
}: {
  question: ComprehensionQuestion;
  ui: ReturnType<typeof getActivityText>;
}) {
  const { t } = ui;
  if (!question.resolved) return null;

  const correctIndex = question.correctOptionIndex;
  const correctAnswer =
    typeof correctIndex === "number"
      ? question.options[correctIndex]
      : undefined;
  // The explanation concerns the revealed correct answer, even after an incorrect response.
  // Without a revealed answer, use a neutral Filipino label; retain approved English copy.
  const explanationLabel = ui.language === "fil" && !correctAnswer
    ? t("Answer explanation: ") : t("Why this answer fits: ");
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
          <strong>{explanationLabel}</strong>
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
  // The introduction's button follows the server's saved state for this reading's learning activity
  // (one assessment per activity): none yet, unfinished, or completed. undefined while checking.
  const [linked, setLinked] = useState<{ key: string; state: LinkedComprehension | null | "error" }>();
  const [lookupRun, setLookupRun] = useState(0);
  const lookupKey = `${oralReadingAttemptId}:${lookupRun}`;
  const introduction = !attemptId && !materialId && hasSource && Boolean(oralReadingAttemptId);

  const resultBase =
    role === "student"
      ? "/dashboard/comprehension"
      : role === "admin" ? "/admin/comprehension" : "/m3/general/comprehension";

  const home = (attempt?.materialId ?? materialId) && (attempt?.roomId ?? roomId)
    ? `/dashboard/learning-rooms/${attempt?.roomId ?? roomId}`
    : role === "student" ? "/dashboard" : role === "admin" ? "/admin/oral-reading" : "/m3/general";

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

          // An unfinished extra attempt saved for this learning activity before the one-assessment
          // rule cannot be answered or finished: open the activity's assessment instead. A completed
          // one stays viewable as it was saved (read-only), so no saved result is ever hidden.
          if (saved.activityAttemptId && saved.activityAttemptId !== saved.id && saved.status !== "completed") {
            navigate(`${resultBase}/${saved.activityAttemptId}`, { replace: true, state: activityLanguageState(saved.language) });
            return;
          }

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

  useEffect(() => {
    if (!introduction || !oralReadingAttemptId) return;
    let active = true;
    void getComprehensionForReading(oralReadingAttemptId)
      .then((state) => { if (active) setLinked({ key: lookupKey, state }); })
      .catch(() => { if (active) setLinked({ key: lookupKey, state: "error" }); });
    return () => { active = false; };
  }, [introduction, oralReadingAttemptId, lookupKey]);
  const saved = linked?.key === lookupKey ? linked.state : undefined;
  const savedAttempt: LinkedComprehension | null = saved && saved !== "error" ? saved : null;

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

        // Every submitted answer is final: there is no second attempt.
        setMessage(
          result.outcome.correct
            ? "Great job! Keep going when you are ready."
            : "Keep going! Every question helps you learn.",
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
  // F2 Receive Scaffolding Prompt: after an incorrect final answer the mascot shows this question's
  // own clue (also after a refresh). Without a valid clue it keeps the general encouragement.
  const clue = question?.resolved && question.firstAnswerCorrect === false && question.scaffoldingPrompt?.trim()
    ? question.scaffoldingPrompt.trim() : null;
  const hasPending = pending.current !== null;
  // Completed results: the linked saved M5 reading (never a new one) and where the reading came from.
  const linkedReading = attempt ? readingResultTarget(role, attempt.oralReadingAttemptId) : null;
  const learningArea = attempt ? learningAreaTarget(role, attempt) : null;

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
    <main lang={language} className={`m6-page${readingMaterialId ? " m6-page--assigned" : ""}${attempt?.status !== "completed" ? " m6-page--questions" : " m6-page--results"}`} aria-busy={busy}>
      {/* Completed results end with their own two ways back, so the top link is only for the question flow. */}
      {attempt?.status !== "completed" && <div className="m6-activity-toolbar">
      <button
        className="m6-back-button"
        type="button"
        disabled={busy || hasPending}
        onClick={() => navigate(reviewingQuestions ? readingTarget : home, { state: activityState })}
      >
        <ArrowLeft size={18} aria-hidden="true" />
        {reviewingQuestions ? t("Back to reading activity") : readingMaterialId ? t("Back to Learning Room") : role === "admin" ? t("Back to Oral Reading") : t("Back to dashboard")}
      </button>
      {attempt && <StoryDrawer key={sourceKey} attempt={attempt} />}
      </div>}

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

      {/* Saving keeps the question on screen with its buttons disabled; only screen readers hear
          that it is working. The live region always exists so the announcement is reliable. */}
      <p className="m6-visually-hidden" role="status">{busy ? t("Please wait…") : ""}</p>

      {!attempt && !attemptId && (!materialId || Boolean(error) || !hasSource) && (
        <section className="m6-card">
          <h2>{t("Ready to answer?")}</h2>

          <p>{t("Answer questions about the passage you have read. You can answer each question once, and your submitted answer is final.")}</p>

          {!hasSource ? (
            <p>{t("Complete and save a Read-Aloud activity, then select Continue to Comprehension on its result page.")}</p>
          ) : introduction && saved === undefined ? (
            <p className="m6-final-note" role="status">{t("Checking your questions…")}</p>
          ) : introduction && saved === "error" ? (
            <div className="m6-actions">
              <p className="m6-final-note" role="alert">{t("Unable to check your comprehension activity.")}</p>
              <button className="m6-button" type="button" onClick={() => setLookupRun((run) => run + 1)}>{t("Check again")}</button>
            </div>
          ) : introduction && savedAttempt?.status === "completed" ? (
            // Completed: its saved, read-only results. Nothing suggests the assessment can be retaken.
            <>
              <p>{t("You already completed the comprehension assessment for this reading activity. You can view your results.")}</p>
              <div className="m6-actions">
                <button className="m6-button" type="button"
                  onClick={() => navigate(comprehensionResultTarget(role, savedAttempt.id), { state: activityState })}
                >{t("View Comprehension Results")}</button>
              </div>
            </>
          ) : introduction && savedAttempt ? (
            // Unfinished: the same attempt, with every submitted answer kept.
            <>
              <p>{t("You have an unfinished comprehension assessment for this reading activity. Your submitted answers are saved.")}</p>
              <div className="m6-actions">
                <button className="m6-button" type="button"
                  onClick={() => navigate(`${resultBase}/${savedAttempt.id}`, { state: activityState })}
                >{t("Continue Comprehension")}</button>
              </div>
            </>
          ) : (
            <div className="m6-actions">
              <button
                className="m6-button"
                type="button"
                disabled={busy}
                onClick={() => void start()}
              >
                {/* An old link without its reading cannot be checked first; the server still reopens an existing assessment. */}
                {materialId ? t("Retry comprehension") : introduction ? t("Start Comprehension") : t("Open Comprehension")}
              </button>
            </div>
          )}
        </section>
      )}

      {attempt && (attempt.status === "completed" || question) && (
        <div className="m6-stage">
          {/* The mascot has its own area: during questions, beside the card (wide screens) or above
              it (narrow screens); on results, a floating helper at the lower left (ComprehensionPage.css).
              It never covers questions, feedback, scores or buttons, and closing it removes it entirely. */}
          <div className="m6-mascot-area">
            <ReadingMascot placement="inline" key={sourceKey} language={language} live={Boolean(message || clue)}
              eventId={attempt.status === "completed" ? `${attempt.id}:completed`
                : `${attempt.id}:${question?.id}:${question?.resolved}:${clue ? "clue" : message ? "answer" : "question"}`}
              mood={attempt.status === "completed" ? "celebrate" : clue ? "tryAgain" : message
                ? message === "Great job! Keep going when you are ready." ? "correct" : "tryAgain" : "hint"}
              message={attempt.status === "completed" ? t("Great work finishing the questions! Here are your results.")
                : busy ? "" : clue ? `${t("Think about it")}: ${clue}`
                : message ? ui.message(message, "Unable to save. Please retry.") : ""} />
          </div>
      {attempt.status === "completed" ? (
        <section className="m6-card">
          <h2>{t("Your comprehension results")}</h2>


          <div className="m6-score">
            <span>{t("Comprehension score")}</span>
            <strong>
              {attempt.summary.firstAttemptPercentage}%
            </strong>
            <span>
              {attempt.summary.firstCorrect}{t(" of ")}
              {attempt.summary.totalQuestions}{t(" correct")}
            </span>
          </div>

          <p>{t("Each question has one final answer. Each correct answer earns one point.")}</p>

          {/* Only activities saved before the single-attempt rule can have hints. */}
          {attempt.summary.hintsUsed > 0 && (
            <p>{t("Questions where you used a hint:")}{" "}
              <strong>{attempt.summary.hintsUsed}</strong>
            </p>
          )}

          <ul className="m6-results-list">
            {questionTypes.map((type) => {
              const group = attempt.summary.byType[type];

              return (
                <li key={type}>
                  <strong>{t(typeLabels[type])}:</strong>{" "}
                  {group.total > 0 ? t("{correct}/{total} correct ({percentage}%)", { correct: group.firstCorrect, total: group.total, percentage: group.firstAttemptPercentage }) : t("No questions in this category.")}
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
            <p>{t("You answered every question correctly. Great work! Review the explanations to see how the passage supports each answer.")}</p>
          )}

          <h2 className="m6-review-heading">{t("Your answer review")}</h2>

          <details><summary>{t("Question explanations and supporting evidence")}</summary>
          <div className="m6-review-list">
            {attempt.questions.map((item, itemIndex) => (
              <article className="m6-review-item" key={item.id}>
                <h3>
                  {itemIndex + 1}. {item.questionText}
                </h3>

                {/* The saved final answer only: earlier two-try activities never show a second answer here. */}
                <p>{t("Your answer:")}{" "}
                  {item.firstOptionIndex === null
                    ? t("No answer recorded")
                    : item.options[item.firstOptionIndex]}
                  {item.firstAnswerCorrect !== null && <>{" — "}<strong>{item.firstAnswerCorrect ? t("Correct") : t("Incorrect")}</strong></>}
                </p>

                {item.hint && (
                  <aside>
                    <strong>{t("Hint used: ")}</strong>
                    {item.hint}
                  </aside>
                )}

                <AnswerFeedback ui={ui} question={item} />
              </article>
            ))}
          </div>
          </details>

          <nav className="m6-actions m6-result-actions" aria-label={t("Assessment navigation")}>
            {linkedReading ? (
              <Link className="m6-button" to={linkedReading} state={activityState}>{t("Back to Reading Result")}</Link>
            ) : (
              <p className="m6-final-note" role="note">{t("The reading result for these answers is not available.")}</p>
            )}
            {learningArea && (
              <Link className="m6-button" to={learningArea.to} state={activityState}>
                {learningArea.kind === "room" ? t("Back to Learning Room") : role === "admin" ? t("Back to Oral Reading") : t("Back to Reading Module")}
              </Link>
            )}
          </nav>
        </section>
      ) : question ? (
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
                  checked={(question.resolved ? question.firstOptionIndex : selected) === optionIndex}
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



          {!question.resolved && (
            <p className="m6-final-note">{t("You can answer each question once. Your submitted answer is final.")}</p>
          )}

          <SubmittedAnswerFeedback ui={ui} question={question} key={`feedback-${question.id}`} />

          <div className="m6-actions">
            {!question.resolved && (
              <button
                className="m6-button"
                type="button"
                disabled={
                  busy || selected === null || hasPending
                }
                aria-busy={busy || undefined}
                onClick={answer}
              >{t("Submit answer")}</button>
            )}

            {question.resolved && index < attempt.questions.length - 1 && (
              <button className="m6-button" type="button"
                disabled={busy || hasPending}
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
        </div>
      )}
    </main>
  );
}
