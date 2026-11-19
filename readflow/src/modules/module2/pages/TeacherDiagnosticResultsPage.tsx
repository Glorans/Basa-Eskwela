import { useCallback, useEffect, useMemo, useState } from "react";
import DiagnosticHistoryTables from "../components/DiagnosticHistoryTables";
import ReadingProgressPanel from "../components/ReadingProgressPanel";
import {
  getDiagnosticHistoryError,
  getTeacherDiagnosticResults,
  type TeacherDiagnosticStudent,
} from "../services/diagnosticHistory";
import { getTeacherReadingProgress, type ReadingProgress } from "../services/readingProgress";
import "../../module7/m7.css";

/**
 * M2 F3 + F5 for approved Teachers: official reading progress (F5) and diagnostic results (F3) of Students currently
 * enrolled in the Teacher's own active Learning Rooms. The server decides who is shown: archived rooms grant no access
 * and Independent Learners never appear.
 */
export default function TeacherDiagnosticResultsPage() {
  const [students, setStudents] = useState<TeacherDiagnosticStudent[] | null>(null);
  const [progress, setProgress] = useState<Map<string, ReadingProgress>>(new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [results, progressList] = await Promise.all([getTeacherDiagnosticResults(), getTeacherReadingProgress()]);
      setStudents(results);
      setProgress(new Map(progressList.map((student) => [student.id, student.progress])));
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
    <main className="m7-page diagnostic-history-page">
      <h1>Diagnostic Results</h1>
      <p className="diagnostic-history-intro">
        Reading progress and diagnostic results of Students currently enrolled in your active Learning Rooms.
        Reading progress uses official results only.
      </p>
      {loading && <p role="status">Loading diagnostic results...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}
      {!loading && !error && students && (students.length === 0 ? (
        <p>No Students are currently enrolled in your active Learning Rooms.</p>
      ) : (
        <>
          <label className="diagnostic-history-search">
            <span>Search Students</span>
            <input type="search" value={search} placeholder="Search by name" aria-label="Search Students"
              onChange={(event) => setSearch(event.target.value)} />
          </label>
          <p aria-live="polite">Showing {visible.length} of {students.length} Students</p>
          {visible.map((student) => {
            const studentProgress = progress.get(student.id);
            return (
              <section key={student.id} aria-labelledby={`student-${student.id}`}>
                <h2 id={`student-${student.id}`}>{student.name}</h2>
                <p className="diagnostic-history-intro">
                  {student.rooms.map((room) => room.name).join(", ")}
                </p>
                {studentProgress && (
                  <div className="reading-progress-section">
                    <h3>Reading Progress</h3>
                    <ReadingProgressPanel progress={studentProgress} idPrefix={`student-${student.id}`} owner="student" />
                  </div>
                )}
                <h3>All Results</h3>
                <DiagnosticHistoryTables results={student.results} owner="student" idPrefix={`student-${student.id}`} />
              </section>
            );
          })}
        </>
      ))}
    </main>
  );
}
