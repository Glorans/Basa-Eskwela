import { useCallback, useEffect, useState } from "react";
import DiagnosticHistoryTables from "../components/DiagnosticHistoryTables";
import {
  getDiagnosticHistoryError,
  getMyDiagnosticHistory,
  type DiagnosticHistoryEntry,
} from "../services/diagnosticHistory";
import "../../module7/m7.css";

/**
 * M2 F3 for Students and Independent Learners: the signed-in learner's own diagnostic results, English and
 * Filipino separately, newest first. Read-only; the server returns only this learner's records.
 */
export default function DiagnosticHistoryPage() {
  const [results, setResults] = useState<DiagnosticHistoryEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setResults(await getMyDiagnosticHistory());
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
        Your reading diagnostic results, newest first. English and Filipino are shown separately.
      </p>
      {loading && <p role="status">Loading your assessment history...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}
      {!loading && !error && results && (
        <section aria-label="Your diagnostic results">
          <DiagnosticHistoryTables results={results} owner="self" idPrefix="my-history" />
        </section>
      )}
    </main>
  );
}
