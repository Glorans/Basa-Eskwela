import { useLocation } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { getRoleHomePath, isAppRole } from "../../module1/utils/authOnboarding";
import type { DiagnosticPracticeOptions } from "../types/diagnostic";

/** M2 F7 Preview / Try Assessment (staff Practice Mode) lives under this path, apart from the official /diagnostic. */
export const PRACTICE_BASE_PATH = "/practice/diagnostic";

/** Staff roles that may use Practice Mode (the server re-checks; Teachers must be approved). */
export const PRACTICE_STAFF_ROLES = ["system_admin", "admin", "teacher"] as const;

/** M2 F7/F10: practising one package version (Initial Diagnostic or reassessment) lives under this path (the server checks access). */
export const practiceVersionBasePath = (versionId: string) => `${PRACTICE_BASE_PATH}/version/${encodeURIComponent(versionId)}`;

/**
 * Where the practice screens live and where "Exit practice" returns (the signed-in staff member's workspace, or the
 * package page that opened the practice). `fallbackExitTo` is used when the page was reloaded and lost that state.
 */
export function usePracticeOptions({ basePath = PRACTICE_BASE_PATH, fallbackExitTo, exitLabel }: { basePath?: string; fallbackExitTo?: string; exitLabel?: string } = {}): DiagnosticPracticeOptions {
  const { profile } = useAuth();
  const { state } = useLocation();
  const packageRoot = profile?.role === "system_admin" ? "/system-admin" : profile?.role === "admin" ? "/admin" : "/m3/teacher";
  // Exit returns only to the role's own package pages, or the School Admin's Diagnostic Results (its F7 entry point).
  const resultsPath = profile?.role === "admin" ? "/admin/diagnostic-results" : null;
  const safe = (path: unknown): path is string => typeof path === "string"
    && (new RegExp(`^${packageRoot}/assessment-packages/[a-zA-Z0-9-]+$`).test(path) || (resultsPath !== null && path === resultsPath));
  const returnPath = state?.practiceExitTo;
  const exitTo = safe(returnPath) ? returnPath : safe(fallbackExitTo) ? fallbackExitTo
    : profile && isAppRole(profile.role) ? getRoleHomePath(profile.role) : "/";
  return { basePath, exitTo, ...(exitLabel && exitTo.includes("/assessment-packages/") ? { exitLabel } : {}) };
}
