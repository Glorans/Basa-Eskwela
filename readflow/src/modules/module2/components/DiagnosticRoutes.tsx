import { Navigate, Outlet, useOutletContext, useParams } from "react-router-dom";
import { getDiagnosticAssessment, isDiagnosticLanguage } from "../data/diagnosticData";
import type { DiagnosticLanguage } from "../types/diagnostic";
import DiagnosticReadingPage from "../pages/DiagnosticReadingPage";
import DiagnosticQuestionsPage from "../pages/DiagnosticQuestionsPage";
import DiagnosticResultPage from "../pages/DiagnosticResultPage";
import { DiagnosticSessionProvider } from "./DiagnosticSessionProvider";

export function DiagnosticFlow() {
  return <DiagnosticSessionProvider><Outlet /></DiagnosticSessionProvider>;
}

export function DiagnosticLanguageRoute({ step }: { step: "reading" | "questions" | "result" }) {
  const { language } = useParams();
  const completed = useOutletContext<DiagnosticLanguage[] | undefined>();
  if (!isDiagnosticLanguage(language)) return <Navigate to="/diagnostic" replace />;
  if (step === "result") return <DiagnosticResultPage key={language} language={language} />;
  const assessment = getDiagnosticAssessment(language);
  if (!assessment) return <Navigate to="/diagnostic" replace />;
  if (completed?.includes(language)) return <Navigate to={`/diagnostic/${language}/result`} replace />;
  return step === "reading"
    ? <DiagnosticReadingPage key={`${assessment.id}:${assessment.version}`} assessment={assessment} />
    : <DiagnosticQuestionsPage key={`${assessment.id}:${assessment.version}`} assessment={assessment} />;
}
