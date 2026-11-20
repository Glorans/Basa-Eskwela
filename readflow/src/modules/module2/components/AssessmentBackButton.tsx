import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import "./AssessmentNavigation.css";

/**
 * Top-left Back on the School Admin and Teacher Assessment pages (Packages, Assignments). Returns to the previous page
 * in this app when there is one (browser history stays intact); a page opened directly goes to the dashboard instead.
 */
export default function AssessmentBackButton({ fallback }: { fallback: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="m3-back-link m2-back-button" onClick={() => {
      const index = (window.history.state as { idx?: unknown } | null)?.idx;
      if (typeof index === "number" && index > 0) navigate(-1); else navigate(fallback);
    }}>
      <ArrowLeft size={17} aria-hidden="true" /> Back
    </button>
  );
}
