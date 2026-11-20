import { useEffect, useState } from "react";
import { Navigate, Outlet, useOutletContext, useParams } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { isDiagnosticLanguage } from "../data/diagnosticData";
import type { DiagnosticLanguage } from "../types/diagnostic";
import type { InitialDiagnosticLoad } from "../utils/initialDelivery";
import DiagnosticReadingPage from "../pages/DiagnosticReadingPage";
import DiagnosticQuestionsPage from "../pages/DiagnosticQuestionsPage";
import DiagnosticResultPage from "../pages/DiagnosticResultPage";
import { loadInitialDiagnostic } from "../services/initialDiagnosticDelivery";
import { DiagnosticSessionProvider } from "./DiagnosticSessionProvider";

export function DiagnosticFlow() {
  return <DiagnosticSessionProvider><Outlet /></DiagnosticSessionProvider>;
}

/**
 * M2 F6: the server chooses the initial diagnostic version (built-in 3.0 unless a System Admin activated another).
 * If it cannot be asked, the learner sees an error with Try Again, never a possibly different bundled version.
 */
function useInitialDiagnostic(language: DiagnosticLanguage | null, userId: string, enabled: boolean) {
  const [state, setState] = useState<{ key: string; load: InitialDiagnosticLoad } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${userId}:${language ?? ""}:${attempt}`;
  useEffect(() => {
    if (!language || !enabled) return undefined;
    let cancelled = false;
    void loadInitialDiagnostic(language, userId).then((load) => {
      if (!cancelled) setState({ key, load });
    });
    return () => { cancelled = true; };
  }, [language, userId, enabled, key]);
  return { load: state?.key === key ? state.load : null, retry: () => setAttempt((n) => n + 1) };
}

export function DiagnosticLanguageRoute({ step }: { step: "reading" | "questions" | "result" }) {
  const { language } = useParams();
  const { user } = useAuth();
  const completed = useOutletContext<DiagnosticLanguage[] | undefined>();
  const valid = isDiagnosticLanguage(language);
  const needsContent = valid && step !== "result" && !completed?.includes(language);
  const { load, retry } = useInitialDiagnostic(valid ? language : null, user?.id ?? "", needsContent);
  if (!valid) return <Navigate to="/diagnostic" replace />;
  if (step === "result") return <DiagnosticResultPage key={language} language={language} />;
  if (completed?.includes(language)) return <Navigate to={`/diagnostic/${language}/result`} replace />;
  if (!load) return <p role="status" className="diagnostic-loading">Loading the diagnostic...</p>;
  if (load.status === "error") {
    return (
      <div role="alert" className="diagnostic-loading">
        <p>{load.message}</p>
        <button type="button" onClick={retry}>Try Again</button>
      </div>
    );
  }
  const { assessment } = load;
  return step === "reading"
    ? <DiagnosticReadingPage key={`${assessment.id}:${assessment.version}`} assessment={assessment} />
    : <DiagnosticQuestionsPage key={`${assessment.id}:${assessment.version}`} assessment={assessment} />;
}
