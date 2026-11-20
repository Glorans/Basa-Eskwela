import { Link, useLocation } from "react-router-dom";
import { BookOpenCheck } from "lucide-react";
import "./AssessmentNavigation.css";

/**
 * M2 F7 entry point for School Admins and Teachers: try the Initial Diagnostic in Practice Mode (never saved). It lives
 * on Diagnostic Results, outside the F10 reassessment packages, since the sidebar no longer has a Try Assessment item.
 * Exit Practice returns to this page.
 */
export default function TryInitialDiagnosticLink() {
  const { pathname } = useLocation();
  return (
    <p className="m2-try-initial">
      <Link to="/practice/diagnostic" state={{ practiceExitTo: pathname }}>
        <BookOpenCheck size={17} aria-hidden="true" /> Try the Initial Diagnostic (Practice Mode)
      </Link>
      <span> Nothing is saved.</span>
    </p>
  );
}
