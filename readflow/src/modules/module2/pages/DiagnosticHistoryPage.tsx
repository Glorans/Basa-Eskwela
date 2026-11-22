import { useCallback, useEffect, useState } from "react";
import DiagnosticHistoryTables from "../components/DiagnosticHistoryTables";
import M7Tabs from "../../module7/components/M7Tabs";
import {
  getDiagnosticHistoryError,
  getMyDiagnosticHistory,
  type DiagnosticHistoryEntry,
} from "../services/diagnosticHistory";
import { getMyReadingProgress, type LanguageProgress, type ProgressPoint, type ReadingProgress } from "../services/readingProgress";
import { formatCompletedDate, formatScore, versionLabel } from "../utils/diagnosticHistory";
import {
  ASSESSMENT_LANGUAGES,
  LEVEL_DETAILS,
  READING_ASSESSMENT_TABS,
  differingLatestReassessment,
  languageLabel,
  officialSource,
  progressTimeline,
  readViewMemory,
  saveViewMemory,
  sourceLabel,
  type AssessmentLanguage,
} from "../utils/readingAssessmentView";
import "../../module7/m7.css";
import "../../module7/m7Redesign.css";
import "./DiagnosticHistoryPage.css";

function LevelBadge({ level }: { level: string }) {
  return <span className="ra-level" data-level={level}>{level}</span>;
}

function sourceText(point: ProgressPoint) {
  return [sourceLabel(point), point.title, point.version ? versionLabel(point.version) : null].filter(Boolean).join(" · ");
}

/** F4: the official reading level for one language, and (separately) a newer reassessment with a different level. */
function ReadingLevelPanel({ progress }: { progress: LanguageProgress }) {
  const label = languageLabel(progress.language);
  const current = progress.current;
  if (!current) {
    return <p className="m7r-empty" role="status">You have no official {label} reading level yet. It appears here after you finish the {label} diagnostic.</p>;
  }
  const source = officialSource(progress);
  const details = LEVEL_DETAILS[current.readingLevel];
  const latest = differingLatestReassessment(progress);
  return (
    <>
      <section className="m7r-section ra-official" aria-labelledby="ra-official-heading">
        <h2 id="ra-official-heading">Official Reading Level</h2>
        <div className="ra-official-body">
          <div className="ra-official-level" data-level={current.readingLevel}>
            <LevelBadge level={current.readingLevel} />
            {details && <strong>{details.title}</strong>}
          </div>
          <div className="ra-official-text">
            {details && <p className="ra-meaning">{details.summary}</p>}
            <dl className="ra-facts">
              <div><dt>Language</dt><dd>{label}</dd></div>
              <div><dt>Based on</dt><dd>{source ? sourceText(source) : sourceLabel({ assessmentType: current.source })}</dd></div>
              <div><dt>Completed</dt><dd>{formatCompletedDate(current.completedAt)}</dd></div>
            </dl>
          </div>
        </div>
      </section>
      {latest && (
        <section className="m7r-section ra-latest" aria-labelledby="ra-latest-heading">
          <h2 id="ra-latest-heading">Latest Reassessment Result</h2>
          <p className="ra-latest-line">
            <LevelBadge level={latest.readingLevel} />
            <span>{[latest.title, formatCompletedDate(latest.completedAt)].filter(Boolean).join(" · ")}</span>
          </p>
          <p className="m7r-note">
            This result is saved in your history. Your official reading level is still {current.readingLevel}, from
            your {current.source === "initial" ? "initial diagnostic" : "official assessment"}.
          </p>
        </section>
      )}
    </>
  );
}

/** F5: the initial diagnostic, then reassessments (oldest first), with the server's own change message and note. */
function ReadingProgressTimeline({ progress }: { progress: LanguageProgress }) {
  const label = languageLabel(progress.language);
  const timeline = progressTimeline(progress);
  if (!progress.current || timeline.length === 0) {
    return <p className="m7r-empty" role="status">You have no official {label} results yet, so there is no progress to show.</p>;
  }
  return (
    <section className="m7r-section" aria-labelledby="ra-progress-heading">
      <h2 id="ra-progress-heading">{label} Reading Progress</h2>
      <p className="ra-change" data-status={progress.change.status}>{progress.change.message}</p>
      <ol className="ra-timeline">
        {timeline.map(({ point, label: stepLabel }) => (
          <li key={point.id} className="ra-step" data-type={point.assessmentType}>
            <div className="ra-step-head">
              <span className="ra-step-label">{stepLabel}</span>
              <time dateTime={point.completedAt}>{formatCompletedDate(point.completedAt)}</time>
            </div>
            <div className="ra-step-body">
              <LevelBadge level={point.readingLevel} />
              {point.title && <span className="ra-step-title">{point.title}</span>}
            </div>
            <p className="ra-step-scores">
              Word recognition {formatScore(point.wordRecognitionScore)} · Comprehension {formatScore(point.comprehensionScore)}
            </p>
          </li>
        ))}
      </ol>
      {progress.placementNote && <p className="m7r-note">{progress.placementNote}</p>}
    </section>
  );
}

/**
 * M2 F3 + F4 + F5 for Students and Independent Learners ("My Reading Assessment"): one language at a time, in three
 * tabs. Read-only; the server returns only this learner's records and decides every level, message and note.
 */
export default function DiagnosticHistoryPage() {
  const [results, setResults] = useState<DiagnosticHistoryEntry[] | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(readViewMemory);

  const update = (next: Partial<typeof view>) => {
    setView((previous) => {
      const merged = { ...previous, ...next };
      saveViewMemory(merged);
      return merged;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [history, myProgress] = await Promise.all([getMyDiagnosticHistory(), getMyReadingProgress()]);
      setResults(history);
      setProgress(myProgress);
    } catch (loadError) {
      setError(getDiagnosticHistoryError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const language: AssessmentLanguage = view.language;
  const languageProgress = progress?.[language];
  const ready = !loading && !error && progress && results;

  return (
    <main className="m7-page m7r ra-page diagnostic-history-page" aria-label="My Reading Assessment">
      <header className="m7r-header">
        <div>
          <h1>My Reading Assessment</h1>
          <p>See your reading level, track your progress, and review completed assessments.</p>
        </div>
      </header>

      <fieldset className="ra-language">
        <legend>Language</legend>
        <div className="ra-language-options">
          {ASSESSMENT_LANGUAGES.map(({ code, label }) => (
            <label key={code} className="ra-language-option">
              <input type="radio" name="ra-language" value={code} checked={language === code}
                onChange={() => update({ language: code })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <M7Tabs idPrefix="ra" label="Reading assessment sections" tabs={[...READING_ASSESSMENT_TABS]} value={view.tab}
        onChange={(tab) => update({ tab })} />

      {loading && <p role="status" className="m7r-empty">Loading your reading assessment...</p>}
      {error && (
        <div role="alert" className="ra-error">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}

      {READING_ASSESSMENT_TABS.map((tab, index) => (
        <div key={tab} role="tabpanel" id={`ra-panel-${index}`} aria-labelledby={`ra-tab-${index}`} hidden={view.tab !== index}
          tabIndex={0} className="m7r-panel">
          {ready && languageProgress && index === 0 && <ReadingLevelPanel progress={languageProgress} />}
          {ready && languageProgress && index === 1 && <ReadingProgressTimeline progress={languageProgress} />}
          {ready && index === 2 && (
            <section className="m7r-section" aria-labelledby="ra-history-heading">
              <h2 id="ra-history-heading">{languageLabel(language)} Assessment History</h2>
              <DiagnosticHistoryTables results={results} owner="self" idPrefix="my-history" language={language} />
            </section>
          )}
        </div>
      ))}
    </main>
  );
}
