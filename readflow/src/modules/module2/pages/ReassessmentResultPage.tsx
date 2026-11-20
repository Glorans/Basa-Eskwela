import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import DiagnosticLayout from "../components/DiagnosticLayout";
import { formatManilaDay, getMyReassessments, type ReassessmentResult, type StudentReassessment } from "../services/studentReassessments";
import type { DiagnosticLanguage } from "../types/diagnostic";
import "./PracticeDiagnostic.css";

const percent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "—";

function isResult(value: unknown, assignmentId: string): value is ReassessmentResult {
  const result = value as Partial<ReassessmentResult> | undefined;
  return Boolean(result && result.assessmentType === "reassessment" && result.assignmentId === assignmentId);
}

/**
 * M2 F8: the saved, server-verified reassessment result. Right after finishing it comes from the save response;
 * opened later it is read again from the server (the Student's own assignments only). Read-only.
 */
export default function ReassessmentResultPage({ assignmentId, language, exitTo, historyPath = "/dashboard/assessment-history" }: {
  assignmentId: string; language: DiagnosticLanguage; exitTo: string; historyPath?: string;
}) {
  const location = useLocation();
  const state = location.state as { reassessmentResult?: unknown } | null;
  const fresh = isResult(state?.reassessmentResult, assignmentId) ? state!.reassessmentResult as ReassessmentResult : null;
  const [saved, setSaved] = useState<StudentReassessment | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!fresh);
  const languageLabel = language === "fil" ? "Filipino" : "English";

  useEffect(() => {
    if (fresh) return undefined;
    let active = true;
    getMyReassessments()
      .then(({ reassessments }) => { if (active) setSaved(reassessments.find((r) => r.id === assignmentId && r.status === "completed") ?? null); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "We couldn't load your result."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assignmentId, fresh]);

  const summary = fresh
    ? { title: fresh.title, wordRecognitionScore: fresh.wordRecognitionScore, comprehensionScore: fresh.comprehensionScore, readingLevel: fresh.readingLevel, completedAt: fresh.completedAt }
    : saved?.result ? { title: saved.title, ...saved.result } : null;

  return (
    <DiagnosticLayout className="practice-diagnostic-panel" labelledBy="reassessment-result-title">
      <header className="practice-diagnostic-header">
        <h1 id="reassessment-result-title">Your Reassessment Result · {languageLabel}</h1>
        <p>Great work finishing your reading! Here is how you did.{historyPath.startsWith("/dashboard") ? " Your teacher can see this result too." : ""}</p>
      </header>

      {loading && <p role="status">Loading your result...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !summary && <p role="status">This reassessment has no saved result yet.</p>}
      {summary && (
        <>
          <p className="practice-diagnostic-note">{summary.title}{summary.completedAt ? ` · Finished ${formatManilaDay(summary.completedAt)}` : ""}</p>
          <dl className="practice-result-grid">
            <div><dt>Reading accuracy</dt><dd>{percent(summary.wordRecognitionScore)}{fresh && <small>{fresh.wordRecognitionLevel}</small>}</dd></div>
            <div>
              <dt>Understanding the story</dt>
              <dd>{percent(summary.comprehensionScore)}{fresh?.comprehension && <small>{fresh.comprehension.correct} of {fresh.comprehension.total} questions</small>}</dd>
            </div>
            <div><dt>Reading level</dt><dd>{summary.readingLevel}<small>Checked by Basa Eskwela</small></dd></div>
          </dl>
          {fresh && typeof fresh.reading.correctWords === "number" && typeof fresh.reading.totalExpectedWords === "number" && (
            <section className="practice-result-details" aria-labelledby="reassessment-reading-details">
              <h2 id="reassessment-reading-details">Your reading</h2>
              <ul><li>You read {fresh.reading.correctWords} of {fresh.reading.totalExpectedWords} words as written.</li></ul>
            </section>
          )}
        </>
      )}

      <div className="practice-result-actions">
        <Link className="diagnostic-primary-button" to={exitTo}>Back to My Reassessments</Link>
        <Link className="diagnostic-recording-secondary-button" to={historyPath}>View Assessment History</Link>
      </div>
    </DiagnosticLayout>
  );
}
