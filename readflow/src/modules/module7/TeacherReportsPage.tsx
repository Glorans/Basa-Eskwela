import WeeklyReportSection from "./WeeklyReportSection";
import "./m7.css";
import "./m7Dashboard.css";

export default function TeacherReportsPage() {
  return (
    <main className="m7-page m7-dashboard" aria-label="Reports">
      <div className="m7-dashboard-content">
      <WeeklyReportSection />
      </div>
    </main>
  );
}
