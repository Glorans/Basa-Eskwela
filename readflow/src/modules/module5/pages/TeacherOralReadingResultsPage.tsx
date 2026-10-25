import { Eye, Mic2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { classifyComprehensionLevel } from "../../module2/services/diagnosticScoring";
import M3PageHeader from "../../module3/components/M3PageHeader";
import {
  getTeacherOralReadingAttempts,
} from "../services/oralReadingService";
import {
  TEACHER_COMPREHENSION_BADGE_CLASS,
  TEACHER_COMPREHENSION_STATUS_LABELS,
} from "../services/teacherComprehension";
import {
  filterTeacherOralReadingAttempts,
} from "../services/teacherOralReadingFilters";
import type {
  TeacherComprehensionStatus,
  TeacherComprehensionSummary,
  TeacherOralReadingAttemptSummary,
} from "../types/oralReading";
import "./TeacherOralReading.css";

const STATUS_FILTERS: TeacherComprehensionStatus[] = ["completed", "in_progress", "not_started", "not_applicable"];

function ComprehensionCell({ comprehension }: { comprehension: TeacherComprehensionSummary }) {
  const badge = (
    <span className={`m3-status-badge ${TEACHER_COMPREHENSION_BADGE_CLASS[comprehension.status]}`}>
      {TEACHER_COMPREHENSION_STATUS_LABELS[comprehension.status]}
    </span>
  );
  if (comprehension.status !== "completed" && comprehension.status !== "in_progress") {
    return <div className="m5-review-comprehension">{badge}</div>;
  }
  const { firstCorrect, totalQuestions, firstAttemptPercentage, hintsUsed } = comprehension;
  return (
    <div className="m5-review-comprehension">
      {badge}
      <span>{firstCorrect} of {totalQuestions} correct on first try ({firstAttemptPercentage}%)</span>
      <small>
        {hintsUsed} {hintsUsed === 1 ? "hint" : "hints"}
        {comprehension.status === "completed" && totalQuestions > 0
          && ` · Phil-IRI comprehension: ${classifyComprehensionLevel((firstCorrect / totalQuestions) * 100)}`}
      </small>
    </div>
  );
}

function formatCompletedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export default function TeacherOralReadingResultsPage() {
  const [attempts, setAttempts] = useState<TeacherOralReadingAttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [learnerId, setLearnerId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [comprehensionStatus, setComprehensionStatus] = useState<TeacherComprehensionStatus | "">("");
  const filteredAttempts = useMemo(
    () => filterTeacherOralReadingAttempts(attempts, { searchQuery, learnerId, moduleId, comprehensionStatus }),
    [attempts, searchQuery, learnerId, moduleId, comprehensionStatus],
  );
  const learners = useMemo(
    () => [...new Map(attempts.map((attempt) => [attempt.learnerId, attempt.learnerName])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1])),
    [attempts],
  );
  const modules = useMemo(
    () => [...new Map(attempts.flatMap((attempt) => attempt.moduleId ? [[attempt.moduleId, attempt.moduleTitle] as const] : [])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1])),
    [attempts],
  );
  const hasFilters = Boolean(searchQuery.trim() || learnerId || moduleId || comprehensionStatus);

  async function loadAttempts() {
    setLoading(true);
    setError("");
    try {
      setAttempts(await getTeacherOralReadingAttempts());
    } catch (loadError) {
      setAttempts([]);
      setError(loadError instanceof Error ? loadError.message : "Unable to load student reading results.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAttempts();
  }, []);

  function clearFilters() {
    setSearchQuery("");
    setLearnerId("");
    setModuleId("");
    setComprehensionStatus("");
  }

  return (
    <div className="m3-page-stack m5-teacher-page m5-teacher-results">
      <M3PageHeader
        title="Reading Results"
        description="Review read-aloud and comprehension results from students enrolled in your classrooms."
        actions={(
          <button className="m3-button m3-button--secondary" type="button" disabled={loading} onClick={() => void loadAttempts()}>
            <RefreshCw size={16} className={loading ? "m3-spinner" : ""} /> Refresh
          </button>
        )}
      />

      {error && <p className="m3-error-message" role="alert">{error}</p>}

      {loading ? (
        <div className="m3-empty-state" role="status">
          <Mic2 size={36} />
          <h2>Loading reading results...</h2>
        </div>
      ) : (
        <section className="m5-review-list-card">
          <div className="m5-review-filters">
            <label className="m5-review-search">
              <span>Search learner or module</span>
              <span className="m5-review-search-input">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search learner or module"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </span>
            </label>

            <label>
              <span>Student</span>
              <select value={learnerId} onChange={(event) => setLearnerId(event.target.value)}>
                <option value="">All Students</option>
                {learners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>

            <label>
              <span>Module</span>
              <select value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
                <option value="">All Modules</option>
                {modules.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
              </select>
            </label>

            <label>
              <span>Comprehension</span>
              <select
                value={comprehensionStatus}
                onChange={(event) => setComprehensionStatus(event.target.value as TeacherComprehensionStatus | "")}
              >
                <option value="">All</option>
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>{TEACHER_COMPREHENSION_STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>

            {hasFilters && (
              <button className="m5-review-clear" type="button" onClick={clearFilters}>Clear Filters</button>
            )}
          </div>

          <p className="m5-review-count" aria-live="polite">
            Showing {filteredAttempts.length} of {attempts.length} results
          </p>

          <div className="m5-review-table-scroll">
            <table className="m5-review-table">
              <colgroup>
                <col style={{ width: "12%" }} /><col style={{ width: "14%" }} />
                <col style={{ width: "12%" }} /><col style={{ width: "14%" }} />
                <col style={{ width: "13%" }} /><col style={{ width: "15%" }} />
                <col style={{ width: "12%" }} /><col style={{ width: "8%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Module</th>
                  <th>Transcript-based Accuracy</th>
                  <th>Recognized / Legacy Passage WPM</th>
                  <th>Recognized-word Differences</th>
                  <th>Comprehension</th>
                  <th>Date Completed</th>
                  <th><span className="m3-visually-hidden">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredAttempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{attempt.learnerName}</td>
                    <td>{attempt.moduleTitle}{attempt.passageTitle && <small> - {attempt.passageTitle}</small>}</td>
                    <td>{Math.round(attempt.pronunciationAccuracy)}%</td>
                    <td>{Math.round(attempt.readingSpeedWpm)}</td>
                    <td>{attempt.detectedErrorCount}</td>
                    <td><ComprehensionCell comprehension={attempt.comprehension} /></td>
                    <td>{formatCompletedAt(attempt.completedAt)}</td>
                    <td>
                      <Link className="m5-review-view" to={`/m3/teacher/oral-reading/${attempt.id}`}>
                        <Eye size={16} /> View
                      </Link>
                    </td>
                  </tr>
                ))}
                {filteredAttempts.length === 0 && (
                  <tr>
                    <td className="m5-review-empty" colSpan={8}>
                      {attempts.length === 0
                        ? "No student reading results yet."
                        : "No reading results match your filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
