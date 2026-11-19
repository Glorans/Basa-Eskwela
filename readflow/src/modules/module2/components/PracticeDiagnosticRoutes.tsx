import { Navigate, Outlet, useParams } from "react-router-dom";
import { getDiagnosticAssessment, isDiagnosticLanguage } from "../data/diagnosticData";
import DiagnosticReadingPage from "../pages/DiagnosticReadingPage";
import DiagnosticQuestionsPage from "../pages/DiagnosticQuestionsPage";
import PracticeResultPage from "../pages/PracticeResultPage";
import { PRACTICE_BASE_PATH, usePracticeOptions } from "../utils/practiceMode";
import { DiagnosticSessionProvider } from "./DiagnosticSessionProvider";

/** Separate session namespace: a practice draft can never be mistaken for an official diagnostic draft. */
export function PracticeDiagnosticFlow() {
  return <DiagnosticSessionProvider namespace="m2-practice"><Outlet /></DiagnosticSessionProvider>;
}

/**
 * Reuses the official reading and question screens with the CURRENT active assessment for the language (no content
 * is copied). Later versioned assessment packages can be selected here without changing the screens.
 */
export function PracticeDiagnosticLanguageRoute({ step }: { step: "reading" | "questions" | "result" }) {
  const { language } = useParams();
  const practice = usePracticeOptions();
  if (!isDiagnosticLanguage(language)) return <Navigate to={PRACTICE_BASE_PATH} replace />;
  if (step === "result") return <PracticeResultPage key={language} language={language} practice={practice} />;
  const assessment = getDiagnosticAssessment(language);
  if (!assessment) return <Navigate to={PRACTICE_BASE_PATH} replace />;
  const key = `practice:${assessment.id}:${assessment.version}`;
  return step === "reading"
    ? <DiagnosticReadingPage key={key} assessment={assessment} practice={practice} />
    : <DiagnosticQuestionsPage key={key} assessment={assessment} practice={practice} />;
}
