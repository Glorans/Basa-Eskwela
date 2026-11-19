import { useCallback, useEffect, useMemo, useState } from "react";
import DiagnosticHistoryTables from "../components/DiagnosticHistoryTables";
import {
  getDiagnosticHistoryError,
  getTeacherDiagnosticResults,
  type TeacherDiagnosticStudent,
} from "../services/diagnosticHistory";
import "../../module7/m7.css";

/**
 * M2 F3 for approved Teachers: diagnostic results of Students enrolled in the Teacher's own Learning Rooms
 * (archived rooms included, labelled). The server decides who is shown; Independent Learners never appear.
 */
export default function TeacherDiagnosticResultsPage() {
  const [students, setStudents] = useState<TeacherDiagnosticStudent[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStudents(await getTeacherDiagnosticResults());
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
        Reading diagnostic results of Students enrolled in your Learning Rooms, newest first.
      </p>
      {loading && <p role="status">Loading diagnostic results...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}
      {!loading && !error && students && (students.length === 0 ? (
        <p>No Students are enrolled in your Learning Rooms yet.</p>
      ) : (
        <>
          <label className="diagnostic-history-search">
            <span>Search Students</span>
            <input type="search" value={search} placeholder="Search by name" aria-label="Search Students"
              onChange={(event) => setSearch(event.target.value)} />
          </label>
          <p aria-live="polite">Showing {visible.length} of {students.length} Students</p>
          {visible.map((student) => (
            <section key={student.id} aria-labelledby={`student-${student.id}`}>
              <h2 id={`student-${student.id}`}>{student.name}</h2>
              <p className="diagnostic-history-intro">
                {student.rooms.map((room) => `${room.name}${room.archived ? " (archived)" : ""}`).join(", ")}
              </p>
              <DiagnosticHistoryTables results={student.results} owner="student" idPrefix={`student-${student.id}`} />
            </section>
          ))}
        </>
      ))}
    </main>
  );
}
