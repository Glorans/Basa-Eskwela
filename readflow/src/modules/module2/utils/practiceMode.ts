import { useAuth } from "../../../auth/useAuth";
import { getRoleHomePath, isAppRole } from "../../module1/utils/authOnboarding";
import type { DiagnosticPracticeOptions } from "../types/diagnostic";

/** M2 F7 Preview / Try Assessment (staff Practice Mode) lives under this path, apart from the official /diagnostic. */
export const PRACTICE_BASE_PATH = "/practice/diagnostic";

/** Staff roles that may use Practice Mode (the server re-checks; Teachers must be approved). */
export const PRACTICE_STAFF_ROLES = ["system_admin", "admin", "teacher"] as const;

/** Where the practice screens live and where "Exit practice" returns (the signed-in staff member's workspace). */
export function usePracticeOptions(): DiagnosticPracticeOptions {
  const { profile } = useAuth();
  const exitTo = profile && isAppRole(profile.role) ? getRoleHomePath(profile.role) : "/";
  return { basePath: PRACTICE_BASE_PATH, exitTo };
}
