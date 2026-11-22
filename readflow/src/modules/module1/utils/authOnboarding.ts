import { isLegacyProfileName } from "./profileFields.ts";

// "admin" is the School Admin (the original Admin role). "system_admin" is platform level and is provisioned only
// by the database owner; it is never offered at registration (see docs/M1_SYSTEM_ADMIN_PROVISIONING.md).
export const APP_ROLES = ["system_admin", "admin", "teacher", "student", "general_user"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const DIAGNOSTIC_LEARNER_ROLES = ["student", "general_user"] as const;
export type DiagnosticLearnerRole = (typeof DIAGNOSTIC_LEARNER_ROLES)[number];

export const ASSIGNABLE_USER_ROLES = ["teacher", "student", "general_user"] as const;
export type AssignableUserRole = (typeof ASSIGNABLE_USER_ROLES)[number];

export interface UserDestinationInput {
  role: unknown;
  nickname: unknown;
  fullName: unknown;
  hasCompletedDiagnostic: boolean;
  teacherStatus?: unknown;
}

export function isUnapprovedTeacher(role: unknown, teacherStatus: unknown) {
  return role === "teacher" && teacherStatus !== "approved";
}

export const ROLE_LABELS: Record<AppRole, string> = {
  system_admin: "System Admin",
  admin: "School Admin",
  teacher: "Teacher",
  student: "Student",
  general_user: "Independent Learner",
};

export const PASSWORD_REQUIREMENTS = [
  { label: "8+ characters", test: (value: string) => value.length >= 8 },
  { label: "Lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "Uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
] as const;

export const NICKNAME_MAX_LENGTH = 30;
export const FULL_NAME_MAX_LENGTH = 100;
export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.includes(value as AppRole);
}

export function isDiagnosticLearnerRole(
  value: unknown,
): value is DiagnosticLearnerRole {
  return (
    typeof value === "string"
    && DIAGNOSTIC_LEARNER_ROLES.includes(
      value.trim().toLowerCase() as DiagnosticLearnerRole,
    )
  );
}

export function isAssignableUserRole(value: unknown): value is AssignableUserRole {
  return (
    typeof value === "string"
    && ASSIGNABLE_USER_ROLES.includes(value as AssignableUserRole)
  );
}

export const SYSTEM_ADMIN_HOME_PATH = "/system-admin/dashboard";

// Each role lands on its dashboard. The workspace roots (/m3/admin, /m3/teacher, /m3/general)
// keep their existing pages and stay usable as deep links.
export function getRoleHomePath(role: AppRole) {
  switch (role) {
    case "system_admin":
      return SYSTEM_ADMIN_HOME_PATH;
    case "admin":
      return "/m3/admin/dashboard";
    case "teacher":
      return "/m3/teacher/dashboard";
    case "general_user":
      return "/m3/general/dashboard";
    case "student":
      return "/dashboard";
  }
}

export function getPostLoginPathForRole(
  role: AppRole,
  hasCompletedDiagnostic: boolean,
) {
  if (isDiagnosticLearnerRole(role) && !hasCompletedDiagnostic) {
    return "/diagnostic";
  }

  return getRoleHomePath(role);
}

export function normalizeAuthEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidSignupEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeAuthEmail(value));
}

export function getPasswordValidationError(value: string) {
  if (!value) {
    return "Enter a password.";
  }

  if (!PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(value))) {
    return "Password must contain at least 8 characters, including at least one lowercase letter and one uppercase letter.";
  }

  return "";
}

export function requiresProfileSetup(
  role: unknown,
  nickname: unknown,
  fullName: unknown,
) {
  if (isDiagnosticLearnerRole(role)) {
    return typeof nickname !== "string" || nickname.trim().length === 0 || isLegacyProfileName(nickname);
  }

  if (role === "teacher") {
    return typeof fullName !== "string" || fullName.trim().length === 0 || isLegacyProfileName(fullName);
  }

  return false;
}

export function getOnboardingPath(
  role: unknown,
  nickname: unknown,
  fullName: unknown,
) {
  if (role === null || role === undefined || role === "") {
    return "/select-role";
  }

  if (!isAppRole(role)) {
    return null;
  }

  return requiresProfileSetup(role, nickname, fullName)
    ? "/setup-profile"
    : null;
}

export function resolveUserDestination({
  role,
  nickname,
  fullName,
  hasCompletedDiagnostic,
  teacherStatus,
}: UserDestinationInput) {
  const onboardingPath = getOnboardingPath(role, nickname, fullName);

  if (onboardingPath) {
    return onboardingPath;
  }

  if (isUnapprovedTeacher(role, teacherStatus)) return "/teacher-verification";

  const normalizedRole = typeof role === "string"
    ? role.trim().toLowerCase()
    : role;

  if (!isAppRole(normalizedRole)) {
    throw new Error("This account has an unsupported role.");
  }

  return getPostLoginPathForRole(normalizedRole, hasCompletedDiagnostic);
}

export function getNicknameValidationError(value: string) {
  const nickname = value.trim();

  if (!nickname || isLegacyProfileName(nickname)) {
    return "Enter the nickname or name you would like us to use.";
  }

  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return `Nickname must be ${NICKNAME_MAX_LENGTH} characters or fewer.`;
  }

  return "";
}

export function getFullNameValidationError(value: string) {
  const fullName = value.trim();

  if (!fullName || isLegacyProfileName(fullName)) {
    return "Enter your full name.";
  }

  if (fullName.length > FULL_NAME_MAX_LENGTH) {
    return `Full name must be ${FULL_NAME_MAX_LENGTH} characters or fewer.`;
  }

  return "";
}

// Callers decide which name a role uses; this only applies the matching rule.
export function getProfileNameValidationError(value: string, usesNickname: boolean) {
  return usesNickname
    ? getNicknameValidationError(value)
    : getFullNameValidationError(value);
}
