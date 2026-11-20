import ClassReadingResults from "../../modules/module2/components/ClassReadingResults";
import { getSchoolReadingProgress } from "../../modules/module2/services/readingProgress";
import TryInitialDiagnosticLink from "../../modules/module2/components/TryInitialDiagnosticLink";
import "./UserManagementPage.css";
import "./AdminDiagnosticResultsPage.css";

/**
 * M2 F3 + F5 for the School Admin: every Student's official reading progress and results in one class view, with a
 * Learning Room filter (active rooms). Single-school pilot: no school membership exists, so all Students are shown;
 * Independent Learners are excluded by the server. Official results only (initial diagnostic and reassessments).
 */
export default function AdminDiagnosticResultsPage() {
  return (
    <section className="admin-users-page">
      <header className="admin-users-header">
        <div>
          <h1>Diagnostic Results</h1>
          <p>View Student reading diagnostic results and history, newest first. Filter by Learning Room, then open a Student&apos;s history.</p>
          <p className="admin-diagnostic-scope-note">
            Single-school setup: School Admins currently see all Students. Independent Learners are not shown.
          </p>
          <TryInitialDiagnosticLink />
        </div>
      </header>
      <ClassReadingResults load={getSchoolReadingProgress} idPrefix="school-results" showNoRoom />
    </section>
  );
}
