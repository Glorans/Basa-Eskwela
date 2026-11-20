import ClassReadingResults from "../components/ClassReadingResults";
import { getTeacherReadingProgress } from "../services/readingProgress";
import "../../module7/m7.css";

/**
 * M2 F3 + F5 for approved Teachers: the official reading progress and results of Students currently enrolled in the
 * Teacher's own ACTIVE Learning Rooms, in one class view (room filter, search, level and language filters, history).
 * The server decides who is shown: archived rooms grant no access and Independent Learners never appear.
 */
export default function TeacherDiagnosticResultsPage() {
  return (
    <main className="m7-page diagnostic-history-page">
      <h1>Diagnostic Results</h1>
      <p className="diagnostic-history-intro">
        Reading progress and official assessment results of Students currently enrolled in your active Learning Rooms.
      </p>
      <ClassReadingResults load={getTeacherReadingProgress} idPrefix="teacher-results"
        emptyMessage="No Students are currently enrolled in your active Learning Rooms." />
    </main>
  );
}
