import { useCallback, useEffect, useMemo, useState } from "react";
import ReadingProgressPanel from "./ReadingProgressPanel";
import { getDiagnosticHistoryError } from "../services/diagnosticHistory";
import { getSchoolReadingProgress, type LanguageProgress, type ProgressStudent } from "../services/readingProgress";
import "./DiagnosticHistoryTables.css";

const currentLabel = (p: LanguageProgress) => p.current?.readingLevel ?? "No official result";

/**
 * M2 F5 for School Admins (single-school pilot): official reading progress of every Student. Independent Learners are
 * excluded by the server. Each Student opens to show English and Filipino separately.
 */
export default function SchoolReadingProgressSection() {
  const [students, setStudents] = useState<ProgressStudent[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStudents(await getSchoolReadingProgress());
    } catch (loadError) {
      setError(getDiagnosticHistoryError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (students ?? []).filter((student) => !query || student.name.toLowerCase().includes(query));
  }, [students, search]);

  return (
    <section className="reading-progress-section school-reading-progress" aria-labelledby="school-reading-progress">
      <h2 id="school-reading-progress">Reading Progress</h2>
      <p className="diagnostic-history-intro">
        Each Student&apos;s reading level from official assessments only (initial diagnostic and official reassessments).
        Practice, unverified results and XP are never included.
      </p>
      {loading && <p role="status">Loading reading progress...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}
      {!loading && !error && students && (students.length === 0 ? (
        <p>No Student accounts yet.</p>
      ) : (
        <>
          <label className="diagnostic-history-search">
            <span>Search Students</span>
            <input type="search" value={search} placeholder="Search by name" aria-label="Search reading progress"
              onChange={(event) => setSearch(event.target.value)} />
          </label>
          <p aria-live="polite">Showing {visible.length} of {students.length} Students</p>
          {visible.map((student) => (
            <details key={student.id} className="diagnostic-history-language">
              <summary>
                <strong>{student.name}</strong>
                <span className="diagnostic-history-note">
                  {" "}· English: {currentLabel(student.progress.en)} · Filipino: {currentLabel(student.progress.fil)}
                </span>
              </summary>
              <ReadingProgressPanel progress={student.progress} idPrefix={`school-${student.id}`} owner="student" />
            </details>
          ))}
        </>
      ))}
    </section>
  );
}
