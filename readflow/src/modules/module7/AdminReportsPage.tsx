import WeeklyReportSection from "./WeeklyReportSection";
import "./m7.css";
import "./m7Dashboard.css";

/** Admin: Generate and Access Weekly Performance Reports (Appendix N M7 functions 6 and 7). */
export default function AdminReportsPage() {
  return (
    <main className="m7-page m7-dashboard">
      <header className="m7-dashboard-header m7-header-card"><div><h1>Reports</h1><p>Generate school-wide weekly performance reports and revisit the reports you saved.</p></div></header>
      <div className="m7-dashboard-content">
        <WeeklyReportSection scope="admin" />
      </div>
    </main>
  );
}
