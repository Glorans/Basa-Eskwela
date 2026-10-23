import WeeklyReportSection from "./WeeklyReportSection";
import "./m7.css";
import "./m7Dashboard.css";

export default function TeacherReportsPage() {
  return (
    <main className="m7-page m7-dashboard">
      <header className="m7-dashboard-header m7-header-card"><div><h1>Reports</h1><p>Generate weekly performance reports and revisit saved results.</p></div></header>
      <div className="m7-dashboard-content">
      <WeeklyReportSection />
      </div>
    </main>
  );
}
