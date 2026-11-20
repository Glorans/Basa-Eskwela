import { Link } from "react-router-dom";
import "./PracticeModeBanner.css";

/** M2 F7: shown on every Practice Mode screen. Practice results are never saved and never affect any learner. */
export default function PracticeModeBanner({ exitTo }: { exitTo: string }) {
  return (
    <div className="practice-mode-banner" role="note" aria-label="Practice Mode">
      <strong className="practice-mode-banner__badge">Practice Mode</strong>
      <span className="practice-mode-banner__text">
        Results are not saved, are not official and do not affect any learner.
      </span>
      <Link className="practice-mode-banner__exit" to={exitTo}>{exitTo.startsWith("/system-admin/assessment-packages/") ? "Back to Initial Diagnostic"
        : exitTo.includes("/assessment-packages/") ? "Back to Assessment" : "Exit practice"}</Link>
    </div>
  );
}
