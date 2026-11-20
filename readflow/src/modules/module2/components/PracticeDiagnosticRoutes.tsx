import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useParams } from "react-router-dom";
import { getDiagnosticAssessment, isDiagnosticLanguage } from "../data/diagnosticData";
import DiagnosticReadingPage from "../pages/DiagnosticReadingPage";
import DiagnosticQuestionsPage from "../pages/DiagnosticQuestionsPage";
import PracticeResultPage from "../pages/PracticeResultPage";
import { PRACTICE_BASE_PATH, practiceVersionBasePath, usePracticeOptions } from "../utils/practiceMode";
import { getPracticeVersion, type PracticeVersion } from "../services/practiceVersions";
import { DiagnosticSessionProvider } from "./DiagnosticSessionProvider";
import DiagnosticLayout from "./DiagnosticLayout";
import PracticeModeBanner from "./PracticeModeBanner";
import "../pages/PracticeDiagnostic.css";

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

/** The package page of each package kind (Exit Practice returns there after a reload). */
const PACKAGE_ROOTS: Record<PracticeVersion["packageCategory"], string> = {
  initial: "/system-admin/assessment-packages", independent: "/system-admin/assessment-packages",
  school: "/admin/assessment-packages", teacher: "/m3/teacher/assessment-packages",
};

type VersionLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; version: PracticeVersion };

/**
 * M2 F7/F10 Try Assessment for ONE package version (an authored Initial Diagnostic version, or the published version of
 * a reassessment package its manager owns): the same reading and question screens, with this version's own passage and
 * questions from the server. The server re-checks access and version status on every load,
 * recording and score, and binds receipts to this version. It never falls back to the built-in 3.0.
 */
export function PracticeVersionRoute({ step }: { step: "reading" | "questions" | "result" }) {
  const { versionId = "", language } = useParams();
  const [load, setLoad] = useState<VersionLoad>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setLoad({ status: "loading" });
    getPracticeVersion(versionId)
      .then((version) => { if (live) setLoad({ status: "ready", version }); })
      .catch((error: unknown) => {
        // Show the server's own reason (e.g. drafts are preview-only); any error object's message, never a substitute version.
        const reason = typeof (error as { message?: unknown })?.message === "string" ? (error as { message: string }).message : "";
        if (live) setLoad({ status: "error", message: reason || "This version could not be loaded for practice." });
      });
    return () => { live = false; };
  }, [versionId]);
  const basePath = practiceVersionBasePath(versionId);
  const ready = load.status === "ready" ? load.version : null;
  const practice = usePracticeOptions({
    basePath,
    fallbackExitTo: ready ? `${PACKAGE_ROOTS[ready.packageCategory]}/${ready.packageId}` : undefined,
    exitLabel: ready ? (ready.packageCategory === "initial" ? "Back to Initial Diagnostic" : "Back to Package") : undefined,
  });
  if (!isDiagnosticLanguage(language)) return <Navigate to={PRACTICE_BASE_PATH} replace />;
  if (step === "result") return <PracticeResultPage key={`version:${versionId}`} language={language} practice={practice} />;
  if (load.status !== "ready") {
    return (
      <DiagnosticLayout className="practice-diagnostic-panel" labelledBy="practice-version-title">
        <PracticeModeBanner exitTo={practice.exitTo} exitLabel={practice.exitLabel} />
        <h1 id="practice-version-title" className="diagnostic-visually-hidden">Try Assessment</h1>
        {load.status === "loading"
          ? <p role="status">Loading this version…</p>
          : <div role="alert"><p>{load.message}</p><Link className="diagnostic-recording-secondary-button" to={practice.exitTo}>Back</Link></div>}
      </DiagnosticLayout>
    );
  }
  const assessment = load.version.assessment;
  if (assessment.language !== language) {
    return <Navigate to={`${basePath}/${assessment.language}/${step}`} replace state={{ practiceExitTo: practice.exitTo }} />;
  }
  const key = `practice:${assessment.id}:${assessment.version}`;
  return step === "reading"
    ? <DiagnosticReadingPage key={key} assessment={assessment} practice={practice} />
    : <DiagnosticQuestionsPage key={key} assessment={assessment} practice={practice} />;
}
