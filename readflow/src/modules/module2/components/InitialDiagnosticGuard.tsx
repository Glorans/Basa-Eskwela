import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { getAuthProfile } from "../../module1/services/authProfile";
import {
  getPostLoginPathForRole,
  isAppRole,
  isDiagnosticLearnerRole,
} from "../../module1/utils/authOnboarding";
import { getCompletedDiagnosticLanguages } from "../services/diagnosticDatabase";
import DiagnosticLayout from "./DiagnosticLayout";
import "./InitialDiagnosticGuard.css";

import { getNextDiagnosticLanguage } from "../data/diagnosticData";
import type { DiagnosticLanguage } from "../types/diagnostic";

type GuardStatus = "checking" | "allowed" | "completed" | "error";

export default function InitialDiagnosticGuard() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [completedLanguages, setCompletedLanguages] = useState<DiagnosticLanguage[]>([]);
  const [status, setStatus] = useState<GuardStatus>("checking");
  const [completedDestination, setCompletedDestination] = useState("/dashboard");
  const [retryRequest, setRetryRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");

    async function checkDiagnosticAccess() {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (sessionError) {
        setStatus("error");
        return;
      }

      if (!session) {
        setStatus("allowed");
        return;
      }

      try {
        const profile = await getAuthProfile(session.user.id);
        if (cancelled) return;

        if (!isAppRole(profile.role) || !isDiagnosticLearnerRole(profile.role)) {
          setStatus("allowed");
          return;
        }

        const learnerHomeDestination = getPostLoginPathForRole(
          profile.role,
          true,
        );
        setCompletedDestination(learnerHomeDestination);

        const completed = await getCompletedDiagnosticLanguages();
        const hasCompletedDiagnostic = !getNextDiagnosticLanguage(completed);

        if (!cancelled) {
          setCompletedLanguages(completed);
          setStatus(hasCompletedDiagnostic ? "completed" : "allowed");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void checkDiagnosticAccess();

    return () => {
      cancelled = true;
    };
  }, [retryRequest, pathname]);

  if (status === "completed") {
    return <Navigate to={completedDestination} replace />;
  }

  if (status === "allowed") {
    return <Outlet context={completedLanguages} />;
  }

  return (
    <DiagnosticLayout
      className="diagnostic-guard-panel"
      labelledBy="diagnostic-guard-title"
    >
      <div className="diagnostic-guard-message" role="status">
        <h1 id="diagnostic-guard-title">
          {status === "checking"
            ? "Checking Your Diagnostic"
            : "We Couldn’t Check Your Diagnostic"}
        </h1>
        <p>
          {status === "checking"
            ? "Please wait while we check your saved result."
            : "Please check your connection and try again."}
        </p>

        {status === "error" && (
          <div className="diagnostic-guard-actions">
            <button
              className="diagnostic-primary-button"
              type="button"
              onClick={() => setRetryRequest((request) => request + 1)}
            >
              Try Again
            </button>
            <button
              className="diagnostic-guard-secondary"
              type="button"
              onClick={() => navigate(completedDestination)}
            >
              Return to Dashboard
            </button>
          </div>
        )}
      </div>
    </DiagnosticLayout>
  );
}
