import { useCallback, useEffect, useState } from "react";
import DiagnosticHistoryTables from "../components/DiagnosticHistoryTables";
import ReadingProgressPanel from "../components/ReadingProgressPanel";
import {
  getDiagnosticHistoryError,
  getMyDiagnosticHistory,
  type DiagnosticHistoryEntry,
} from "../services/diagnosticHistory";
import { getMyReadingProgress, type ReadingProgress } from "../services/readingProgress";
import "../../module7/m7.css";

/**
 * M2 F3 + F5 for Students and Independent Learners: the signed-in learner's official reading progress (F5) and their
 * own diagnostic results (F3), English and Filipino separately. Read-only; the server returns only this learner's
 * records. No rooms, comparisons or Teacher information are shown.
 */
export default function DiagnosticHistoryPage() {
  const [results, setResults] = useState<DiagnosticHistoryEntry[] | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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

  return (
    <main className="m7-page diagnostic-history-page">
      <h1>Assessment History</h1>
      <p className="diagnostic-history-intro">
        Your reading level from official assessments, and every diagnostic result, newest first. English and Filipino
        are shown separately. <a href="#assessment-history">Go to Assessment History</a>
      </p>
      {loading && <p role="status">Loading your assessment history...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}
      {!loading && !error && progress && (
        <section className="reading-progress-section" aria-labelledby="my-reading-progress">
          <h2 id="my-reading-progress">Reading Progress</h2>
          <ReadingProgressPanel progress={progress} idPrefix="my" owner="self" />
        </section>
      )}
      {!loading && !error && results && (
        <section id="assessment-history" aria-labelledby="my-all-results">
          <h2 id="my-all-results">All Results</h2>
          <DiagnosticHistoryTables results={results} owner="self" idPrefix="my-history" />
        </section>
      )}
    </main>
  );
}
