import { useEffect, useMemo, useState } from "react";
import {
  getAdminDiagnosticResults,
  getAdminDiagnosticResultsError,
  type AdminDiagnosticResult,
} from "../../services/adminDiagnosticResults";
import { ROLE_LABELS } from "../../modules/module1/utils/authOnboarding";
import {
  filterAdminDiagnosticResults,
  type DifficultyFilter,
  type ReadingLevelFilter,
} from "./diagnosticResultFilters";
import "./UserManagementPage.css";
import "./AdminDiagnosticResultsPage.css";

const READING_LEVELS: ReadingLevelFilter[] = [
  "",
  "Independent",
  "Instructional",
  "Frustration",
];
const DIFFICULTIES: DifficultyFilter[] = ["", "Easy", "Medium", "Hard"];

function formatMetric(value: number | null, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`
    : "—";
}

function formatCompletedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export default function AdminDiagnosticResultsPage() {
  const [results, setResults] = useState<AdminDiagnosticResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [readingLevel, setReadingLevel] = useState<ReadingLevelFilter>("");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("");
  const filteredResults = useMemo(
    () => filterAdminDiagnosticResults(results, {
      searchQuery,
      readingLevel,
      difficulty,
    }),
    [results, searchQuery, readingLevel, difficulty],
  );
  const hasActiveFilters = Boolean(searchQuery.trim() || readingLevel || difficulty);

  async function loadResults() {
    setLoading(true);
    setError("");

    try {
      setResults(await getAdminDiagnosticResults());
    } catch (loadError) {
      setError(getAdminDiagnosticResultsError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadResults();
  }, []);

  function clearFilters() {
    setSearchQuery("");
    setReadingLevel("");
    setDifficulty("");
  }

  return (
    <section className="admin-users-page">
      <header className="admin-users-header">
        <div>
          <h1>Diagnostic Results</h1>
          <p>View completed Student reading diagnostics.</p>
        </div>
        <button type="button" onClick={() => void loadResults()} disabled={loading}>
          Refresh
        </button>
      </header>

      {error && (
        <p className="admin-users-message admin-users-message--error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="admin-users-loading" role="status">Loading diagnostic results...</p>
      ) : (
        <div className="admin-users-table-wrap">
          <div className="admin-users-controls">
            <label className="admin-users-control admin-users-search">
              <span>Search learners</span>
              <input
                type="search"
                aria-label="Search diagnostic results"
                placeholder="Search name or email"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>

            <label className="admin-users-control">
              <span>Reading Level</span>
              <select
                aria-label="Reading level filter"
                value={readingLevel}
                onChange={(event) => setReadingLevel(
                  event.target.value as ReadingLevelFilter,
                )}
              >
                {READING_LEVELS.map((level) => (
                  <option key={level || "all"} value={level}>
                    {level || "All Reading Levels"}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-users-control">
              <span>Difficulty</span>
              <select
                aria-label="Difficulty filter"
                value={difficulty}
                onChange={(event) => setDifficulty(
                  event.target.value as DifficultyFilter,
                )}
              >
                {DIFFICULTIES.map((tier) => (
                  <option key={tier || "all"} value={tier}>
                    {tier || "All Difficulties"}
                  </option>
                ))}
              </select>
            </label>

            {hasActiveFilters && (
              <button
                className="admin-users-clear"
                type="button"
                aria-label="Clear diagnostic result filters"
                onClick={clearFilters}
              >
                Clear Filters
              </button>
            )}
          </div>

          <p className="admin-users-result-count" aria-live="polite">
            Showing {filteredResults.length} of {results.length} results
          </p>

          <div className="admin-users-table-scroll">
            <table className="admin-users-table admin-diagnostic-results-table">
              <thead>
                <tr>
                  <th>Learner Name</th>
                  <th>Email</th>
                  <th>Account Type</th>
                  <th>Language</th>
                  <th>ORV Score</th>
                  <th>Comprehension</th>
                  <th>WPM</th>
                  <th>Reading Level</th>
                  <th>Difficulty</th>
                  <th>Date Completed</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((result) => (
                  <tr key={result.id}>
                    <td>{result.learnerName || "\u2014"}</td>
                    <td>{result.email || "\u2014"}</td>
                    <td>{ROLE_LABELS[result.role]}</td>
                    <td>{result.language === "fil" ? "Filipino" : result.language === "en" ? "English" : "Unavailable"}</td>
                    <td>{formatMetric(result.orvScore, "%")}</td>
                    <td>{formatMetric(result.comprehensionScore, "%")}</td>
                    <td>{formatMetric(result.readingSpeedWpm)}</td>
                    <td>
                      {result.readingLevel}
                      {result.verificationStatus !== "server_verified" && <> (unverified)</>}
                    </td>
                    <td>{result.difficultyTier}</td>
                    <td>{formatCompletedAt(result.completedAt)}</td>
                  </tr>
                ))}
                {filteredResults.length === 0 && (
                  <tr>
                    <td className="admin-users-empty" colSpan={10}>
                      {results.length === 0
                        ? "No diagnostic results found."
                        : "No diagnostic results match your filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
