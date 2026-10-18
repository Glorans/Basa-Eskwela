import { isLegacyProfileName } from "./profileFields.ts";

export const APP_ROLES = ["admin", "teacher", "student", "general_user"] as const;
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
  admin: "Admin",
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
export const AGE_MIN = 1;
export const AGE_MAX = 120;

export function getAgeValidationError(value: string) {
  const age = value.trim();
  if (!age) return "Enter your age.";
  if (!/^\d+$/.test(age) || Number(age) < AGE_MIN || Number(age) > AGE_MAX) {
    return `Enter a whole-number age from ${AGE_MIN} to ${AGE_MAX}.`;
  }
  return "";
}

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

export function getRoleHomePath(role: AppRole) {
  switch (role) {
    case "admin":
      return "/m3/admin";
    case "teacher":
      return "/m3/teacher";
    case "general_user":
      return "/m3/general";
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
