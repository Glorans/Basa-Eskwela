import { ArrowLeft, BookOpen, CheckCircle2, Gauge, ListChecks, Mic2, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import M3PageHeader from "../../module3/components/M3PageHeader";
import RecordingPlayback from "../components/RecordingPlayback";
import { getWordsToPractice } from "../services/oralReadingProcessing";
import { getTeacherOralReadingAttempt } from "../services/oralReadingService";
import {
  TEACHER_COMPREHENSION_BADGE_CLASS,
  TEACHER_COMPREHENSION_STATUS_LABELS,
} from "../services/teacherComprehension";
import type {
  ComprehensionQuestionType,
  TeacherComprehensionDetail,
  TeacherComprehensionQuestionReview,
  TeacherOralReadingAttemptDetail,
} from "../types/oralReading";
import "./TeacherOralReading.css";

const QUESTION_TYPE_LABELS: Record<ComprehensionQuestionType, string> = {
  literal: "Literal",
  inferential: "Inferential",
  critical: "Critical",
};

const EMPTY_COMPREHENSION_MESSAGES = {
  not_started: "The student has not started the questions yet.",
  not_applicable: "This activity was read-aloud only, so there are no comprehension questions.",
} as const;

function formatOption(question: TeacherComprehensionQuestionReview, index: number | null | undefined) {
  if (index === null || index === undefined) return "Not answered";
  return `${String.fromCharCode(65 + index)}. ${question.options[index] ?? ""}`;
}

function QuestionResult({ question }: { question: TeacherComprehensionQuestionReview }) {
  if (question.firstAnswerCorrect === null) return <span className="m5-question-result">Not answered</span>;
  return question.firstAnswerCorrect ? (
    <span className="m5-question-result m5-question-result--correct">
      <CheckCircle2 size={16} aria-hidden="true" /> Correct
    </span>
  ) : (
    <span className="m5-question-result m5-question-result--incorrect">
      <XCircle size={16} aria-hidden="true" /> Not correct
    </span>
  );
}

function ComprehensionReview({
  comprehension,
  retrying,
  onRetry,
}: {
  comprehension: TeacherComprehensionDetail;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (!("questions" in comprehension)) {
    if (comprehension.status !== "unavailable") {
      return <p className="m5-review-muted">{EMPTY_COMPREHENSION_MESSAGES[comprehension.status]}</p>;
    }
    return (
      <div className="m5-comprehension-empty" role="alert">
        <p>Comprehension results could not be loaded right now. The oral-reading result above is unaffected.</p>
        <button className="m3-button m3-button--secondary" type="button" disabled={retrying} onClick={onRetry}>
          <RefreshCw size={16} className={retrying ? "m3-spinner" : ""} /> Retry
        </button>
      </div>
    );
  }

  const { firstCorrect, totalQuestions, firstAttemptPercentage, hintsUsed, byType, questions } = comprehension;
  return (
    <>
      <div className="m5-review-metrics m5-review-metrics--three">
        <div>
          <span>Correct on First Try</span>
          <strong>{firstCorrect} of {totalQuestions} ({firstAttemptPercentage}%)</strong>
        </div>
        <div><span>Hints Used</span><strong>{hintsUsed}</strong></div>
        <div>
          <span>Status</span>
          <strong>
            <span className={`m3-status-badge ${TEACHER_COMPREHENSION_BADGE_CLASS[comprehension.status]}`}>
              {TEACHER_COMPREHENSION_STATUS_LABELS[comprehension.status]}
            </span>
          </strong>
        </div>
      </div>

      <h3 className="m5-comprehension-subtitle">By Question Type</h3>
      <ul className="m5-comprehension-types">
        {(Object.keys(QUESTION_TYPE_LABELS) as ComprehensionQuestionType[]).map((type) => (
          <li key={type}>
            <span>{QUESTION_TYPE_LABELS[type]}</span>
            <strong>{byType[type].firstCorrect} of {byType[type].total}</strong>
          </li>
        ))}
      </ul>

      <h3 className="m5-comprehension-subtitle">Question Review</h3>
      <div className="m5-review-table-scroll">
        <table className="m5-review-table m5-comprehension-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Question</th>
              <th>Student's First Answer</th>
              <th>Correct Answer</th>
              <th>First Try</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => {
              const secondTryCorrect = question.firstAnswerCorrect === false
                && question.secondAnswerIndex === question.correctIndex;
              return (
                <tr key={question.order}>
                  <td data-label="#">{question.order}</td>
                  <td data-label="Question">
                    <small className="m5-question-type">{QUESTION_TYPE_LABELS[question.type]}</small>
                    {question.prompt}
                  </td>
                  <td data-label="Student's First Answer">{formatOption(question, question.studentFirstAnswerIndex)}</td>
                  <td data-label="Correct Answer">{formatOption(question, question.correctIndex)}</td>
                  <td data-label="First Try"><QuestionResult question={question} /></td>
                  <td data-label="Notes">
                    <span className="m5-question-tags">
                      {question.hintUsed && <span className="m5-question-tag">Hint used</span>}
                      {secondTryCorrect && question.resolved && (
                        <span className="m5-question-tag">Resolved on second try</span>
                      )}
                      {question.secondAnswerIndex !== undefined && !secondTryCorrect && (
                        <span className="m5-question-tag">
                          Second try: {formatOption(question, question.secondAnswerIndex)}
                        </span>
                      )}
                      {!question.hintUsed && question.secondAnswerIndex === undefined && "None"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function formatCompletedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : new Intl.DateTimeFormat("en-PH", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(date);
}

export default function TeacherOralReadingAttemptPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const [attempt, setAttempt] = useState<TeacherOralReadingAttemptDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryingComprehension, setRetryingComprehension] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setAttempt(undefined);
    if (!attemptId) {
      setLoading(false);
      setError("Reading result not found.");
      return () => { active = false; };
    }
    void getTeacherOralReadingAttempt(attemptId)
      .then((loadedAttempt) => {
        if (active) setAttempt(loadedAttempt);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load the result.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [attemptId]);

  const wordsToPractice = useMemo(
    () => attempt ? getWordsToPractice(attempt.wordMetrics) : [],
    [attempt],
  );
  async function retryComprehension() {
    if (!attemptId) return;
    setRetryingComprehension(true);
    try {
      const { comprehension } = await getTeacherOralReadingAttempt(attemptId);
      setAttempt((current) => current && { ...current, comprehension });
    } catch {
      // Keep the oral-reading result and the retry message on screen.
    } finally {
      setRetryingComprehension(false);
    }
  }

  const insertions = useMemo(
    () => attempt
      ? [...new Set(attempt.wordMetrics
          .filter((word) => word.type === "insertion")
          .map((word) => word.actual)
          .filter((word): word is string => Boolean(word)))]
      : [],
    [attempt],
  );

  if (loading) {
    return (
      <div className="m3-empty-state m3-empty-state--page" role="status">
        <Mic2 className="m3-spinner" size={36} />
        <h1>Loading reading result...</h1>
      </div>
    );
  }

  if (error || !attempt) {
    return (
      <div className="m3-empty-state m3-empty-state--page" role="alert">
        <Mic2 size={36} />
        <h1>Unable to open this reading result</h1>
        <p>{error || "Reading result not found."}</p>
        <Link className="m3-button m3-button--primary" to="/m3/teacher/oral-reading">Back to Reading Results</Link>
      </div>
    );
  }

  return (
    <div className="m3-page-stack m3-page-stack--narrow m5-teacher-page">
      <Link className="m3-back-link" to="/m3/teacher/oral-reading">
        <ArrowLeft size={17} /> Back to Reading Results
      </Link>

      <M3PageHeader
        eyebrow="Reading Results"
        title={attempt.learnerName}
        description={`${attempt.moduleTitle} · ${attempt.difficulty} · Completed ${formatCompletedAt(attempt.completedAt)}`}
      />

      {/* One card per M5 function: F6 result, F5 transcript, F4 words, F2/F3 pronunciation check. */}
      <section className="m5-review-detail-card" aria-labelledby="m5-result-panel-title">
        <h2 className="m5-review-panel-title" id="m5-result-panel-title">Oral Reading Result</h2>
        <div className="m5-review-metrics">
          {/* The saved field is transcript-based reading accuracy, not a pronunciation score. */}
          <div><span>Reading Accuracy (Transcript-based)</span><strong>{Math.round(attempt.pronunciationAccuracy)}%</strong></div>
          <div><span>{attempt.scoringVersion === 2 ? "Recognized Words per Minute" : "Reading Speed (Legacy Passage WPM)"}</span><strong>{Math.round(attempt.readingSpeedWpm)} WPM</strong></div>
          <div><span>Expected Words</span><strong>{attempt.expectedWordCount}</strong></div>
          <div><span>Recognized-word Differences</span><strong>{attempt.detectedErrorCount}</strong></div>
        </div>
      </section>

      <section className="m5-review-detail-card" aria-labelledby="m5-transcript-panel-title">
        <h2 className="m5-review-panel-title" id="m5-transcript-panel-title">Read-Aloud Transcript</h2>

        <section className="m5-review-detail-section" aria-labelledby="m5-passage-title">
          <h2 id="m5-passage-title"><BookOpen size={21} /> Reference Passage{attempt.passageTitle ? `: ${attempt.passageTitle}` : ""}</h2>
          {attempt.language && <p>Language: {attempt.language === "fil" ? "Filipino" : "English"}</p>}
          <p className="m5-review-reading-text">{attempt.passageSnapshot}</p>
        </section>

        <section className="m5-review-detail-section" aria-labelledby="m5-transcript-title">
          <h2 id="m5-transcript-title"><Gauge size={21} /> Recognized Speech</h2>
          {attempt.transcript?.trim()
            ? <p className="m5-review-reading-text">{attempt.transcript}</p>
            : <p className="m5-review-muted">No transcript was saved for this reading.</p>}
          <p className="m5-review-muted">Speech recognition can make mistakes.</p>
        </section>
        <RecordingPlayback attemptId={attempt.id} teacher language={attempt.language ?? "en"} />
      </section>

      <section className="m5-review-detail-card" aria-labelledby="m5-feedback-panel-title">
        <h2 className="m5-review-panel-title" id="m5-feedback-panel-title">Words to Practice</h2>

        <section className="m5-review-detail-section" aria-labelledby="m5-practice-title">
          <h2 id="m5-practice-title"><Mic2 size={21} /> Words Heard Differently</h2>
          <p>These words may have been skipped or recognized differently during the read-aloud. A recognized difference is not always a pronunciation mistake.</p>
          {wordsToPractice.length > 0 ? (
            <ul className="m5-review-word-list">
              {wordsToPractice.map((word) => <li key={word}>{word}</li>)}
            </ul>
          ) : (
            <p className="m5-review-muted">No expected words were identified for practice.</p>
          )}
          {insertions.length > 0 && (
            <div className="m5-review-insertions">
              <strong>Words recognized in addition to the passage</strong>
              <span>{insertions.join(", ")}</span>
            </div>
          )}
        </section>
      </section>

      <section className="m5-review-detail-card" aria-labelledby="m5-pronunciation-panel-title">
        <h2 className="m5-review-panel-title" id="m5-pronunciation-panel-title">Pronunciation Feedback and Accuracy</h2>
        <section className="m5-review-detail-section" aria-labelledby="m5-pronunciation-title">
          <h2 id="m5-pronunciation-title"><Mic2 size={21} /> Pronunciation Check</h2>
          <p>
            {attempt.language === "fil"
              ? "Pronunciation scoring is not available for Filipino readings. Use the words to practice and the recording to review this reading."
              : "English pronunciation checks are shown to the student but are not saved yet, so their feedback, scores and words cannot be reviewed here. Use the recording to listen for pronunciation."}
          </p>
        </section>
      </section>

      <section className="m5-review-detail-card">
        <section className="m5-review-detail-section" aria-labelledby="m5-comprehension-title">
          <h2 id="m5-comprehension-title"><ListChecks size={21} /> Comprehension</h2>
          <ComprehensionReview
            comprehension={attempt.comprehension}
            retrying={retryingComprehension}
            onRetry={() => void retryComprehension()}
          />
        </section>
      </section>
    </div>
  );
}
