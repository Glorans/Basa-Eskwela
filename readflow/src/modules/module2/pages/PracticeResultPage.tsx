import { Link, useLocation } from "react-router-dom";
import DiagnosticLayout from "../components/DiagnosticLayout";
import PracticeModeBanner from "../components/PracticeModeBanner";
import { PRACTICE_BASE_PATH } from "../utils/practiceMode";
import type { DiagnosticPracticeResult } from "../services/diagnosticPractice";
import type { DiagnosticLanguage, DiagnosticPracticeOptions } from "../types/diagnostic";
import "./PracticeDiagnostic.css";

const percent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "—";

function isPracticeResult(value: unknown, language: DiagnosticLanguage): value is DiagnosticPracticeResult {
  const result = value as Partial<DiagnosticPracticeResult> | undefined;
  return Boolean(result && result.practice === true && result.saved === false && result.language === language
    && typeof result.wordRecognitionScore === "number" && typeof result.comprehensionScore === "number");
}

/**
 * M2 F7: the practice result exists only in this page's navigation state. It was never stored, so refreshing the page
 * or opening it directly shows no result: start a new practice instead.
 */
export default function PracticeResultPage({ language, practice }: { language: DiagnosticLanguage; practice: DiagnosticPracticeOptions }) {
  const location = useLocation();
  const state = location.state as { practiceResult?: unknown } | null;
  const result = isPracticeResult(state?.practiceResult, language) ? state!.practiceResult as DiagnosticPracticeResult : null;
  const languageLabel = language === "fil" ? "Filipino" : "English";

  return (
    <DiagnosticLayout className="practice-diagnostic-panel" labelledBy="practice-result-title">
      <PracticeModeBanner exitTo={practice.exitTo} exitLabel={practice.exitLabel} />
      <header className="practice-diagnostic-header">
        <h1 id="practice-result-title">Practice Result · {languageLabel}</h1>
        <p>This practice score was calculated with the official scoring rules. It was not saved and is not an official reading level.</p>
      </header>

      {!result ? (
        <p role="status">Practice results are not saved, so there is nothing to show here. Start a new practice to see a result.</p>
      ) : (
        <>
          <dl className="practice-result-grid">
            <div><dt>Word Recognition</dt><dd>{percent(result.wordRecognitionScore)}<small>{result.wordRecognitionLevel}</small></dd></div>
            <div><dt>Comprehension</dt><dd>{percent(result.comprehensionScore)}<small>{result.comprehension.correct} of {result.comprehension.total} correct · {result.comprehensionLevel}</small></dd></div>
            <div><dt>Practice reading level</dt><dd>{result.readingLevel}<small>Not official · not saved</small></dd></div>
          </dl>

          <section className="practice-result-details" aria-labelledby="practice-reading-details">
            <h2 id="practice-reading-details">Reading details</h2>
            <ul>
              <li>{result.reading.correctWords} of {result.reading.totalExpectedWords} words read as written</li>
              <li>{result.reading.substitutions} substituted · {result.reading.omissions} skipped · {result.reading.insertions} extra</li>
              {result.reading.titleWordsExcluded > 0 && <li>The story title was read aloud and not counted</li>}
              {typeof result.readingSpeedWpm === "number" && <li>About {Math.round(result.readingSpeedWpm)} words per minute</li>}
            </ul>
          </section>

          <section className="practice-result-details" aria-labelledby="practice-question-details">
            <h2 id="practice-question-details">Questions</h2>
            <ol className="practice-result-questions">
              {result.comprehension.questions.map((question, index) => (
                <li key={question.id} data-correct={question.correct}>Question {index + 1}: {question.correct ? "Correct" : "Not correct"}</li>
              ))}
            </ol>
          </section>
          <p className="practice-diagnostic-note">{languageLabel} · Version {result.assessmentVersion}{result.passageTitle ? ` · ${result.passageTitle}` : ""}</p>
        </>
      )}

      <div className="practice-result-actions">
        <Link className="diagnostic-primary-button" to={`${practice.basePath}/${language}/reading`} state={{ practiceExitTo: practice.exitTo }}>Practise again</Link>
        {/* A version practice is for one language and version only; the built-in practice offers both languages. */}
        {practice.basePath === PRACTICE_BASE_PATH
          ? <Link className="diagnostic-recording-secondary-button" to={PRACTICE_BASE_PATH} state={{ practiceExitTo: practice.exitTo }}>Choose a language</Link>
          : <Link className="diagnostic-recording-secondary-button" to={practice.exitTo}>{practice.exitLabel ?? "Back to Initial Diagnostic"}</Link>}
      </div>
    </DiagnosticLayout>
  );
}
