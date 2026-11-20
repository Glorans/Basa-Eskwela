import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useParams } from "react-router-dom";
import DiagnosticReadingPage from "../pages/DiagnosticReadingPage";
import DiagnosticQuestionsPage from "../pages/DiagnosticQuestionsPage";
import ReassessmentResultPage from "../pages/ReassessmentResultPage";
import DiagnosticLayout from "./DiagnosticLayout";
import { DiagnosticSessionProvider } from "./DiagnosticSessionProvider";
import { getReassessmentContent } from "../services/studentReassessments";
import { isDiagnosticLanguage } from "../data/diagnosticData";
import type { DiagnosticAssessment, DiagnosticReassessmentOptions } from "../types/diagnostic";
import { useAuth } from "../../../auth/useAuth";
import {
  REASSESSMENT_FLOW_PATH, assessmentHistoryPath, reassessmentDraftNamespace, reassessmentListPath, type ReassessmentAudience,
} from "../utils/reassessmentPaths";

function useAudience(): ReassessmentAudience {
  const { profile } = useAuth();
  return profile?.role === "general_user" ? "independent" : "student";
}

/** Separate session namespaces: reassessment drafts never mix with each other, the initial diagnostic or Practice Mode. */
export function ReassessmentFlow() {
  const audience = useAudience();
  return <DiagnosticSessionProvider namespace={reassessmentDraftNamespace(audience)}><Outlet /></DiagnosticSessionProvider>;
}

/**
 * M2 F8: loads the Student's assigned passage and questions from the server (which checks that the assignment is
 * theirs and still open) and reuses the official reading and question screens. The result step shows the saved result.
 */
export function ReassessmentStepRoute({ step }: { step: "reading" | "questions" | "result" }) {
  const { assignmentId = "", language } = useParams();
  const audience = useAudience();
  const listPath = reassessmentListPath(audience);
  const [assessment, setAssessment] = useState<DiagnosticAssessment | null>(null);
  const [error, setError] = useState("");
  const options: DiagnosticReassessmentOptions = {
    assignmentId,
    basePath: `${REASSESSMENT_FLOW_PATH}/${encodeURIComponent(assignmentId)}`,
    exitTo: listPath,
  };

  useEffect(() => {
    if (step === "result") return undefined;
    let active = true;
    setAssessment(null);
    setError("");
    getReassessmentContent(assignmentId)
      .then((content) => { if (active) setAssessment(content.assessment); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "We couldn't open this reassessment."); });
    return () => { active = false; };
  }, [assignmentId, step]);

  if (!isDiagnosticLanguage(language)) return <Navigate to={listPath} replace />;
  if (step === "result") {
    return <ReassessmentResultPage assignmentId={assignmentId} language={language} exitTo={listPath} historyPath={assessmentHistoryPath(audience)} />;
  }
  if (error) {
    return (
      <DiagnosticLayout labelledBy="reassessment-unavailable">
        <h1 id="reassessment-unavailable">Reassessment</h1>
        <p role="alert">{error}</p>
        <Link className="diagnostic-primary-button" to={listPath}>Back to My Reassessments</Link>
      </DiagnosticLayout>
    );
  }
  if (!assessment) {
    return <DiagnosticLayout labelledBy="reassessment-loading"><p id="reassessment-loading" role="status">Opening your reassessment...</p></DiagnosticLayout>;
  }
  // The language in the address must match the assigned passage.
  if (assessment.language !== language) return <Navigate to={`${options.basePath}/${assessment.language}/${step}`} replace />;
  const key = `reassessment:${assessment.id}:${assessment.version}`;
  return step === "reading"
    ? <DiagnosticReadingPage key={key} assessment={assessment} reassessment={options} />
    : <DiagnosticQuestionsPage key={key} assessment={assessment} reassessment={options} />;
}
