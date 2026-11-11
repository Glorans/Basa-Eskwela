import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ASSIGNABLE_USER_ROLES,
  DIAGNOSTIC_LEARNER_ROLES,
  getFullNameValidationError,
  getOnboardingPath,
  getPasswordValidationError,
  getRoleHomePath,
  getPostLoginPathForRole,
  getNicknameValidationError,
  isAssignableUserRole,
  isDiagnosticLearnerRole,
  isValidSignupEmail,
  NICKNAME_MAX_LENGTH,
  normalizeAuthEmail,
  PASSWORD_REQUIREMENTS,
  resolveUserDestination,
  requiresProfileSetup,
  ROLE_LABELS,
} from "../src/modules/module1/utils/authOnboarding.ts";

function resolveDestination(
  role: unknown,
  nickname: unknown,
  fullName: unknown,
  hasCompletedDiagnostic = false,
) {
  return resolveUserDestination({
    role,
    nickname,
    fullName,
    hasCompletedDiagnostic,
    teacherStatus: role === "teacher" ? "approved" : null,
  });
}

test("canonical routing sends a user without a role to Role Selection", () => {
  assert.equal(resolveDestination(null, null, ""), "/select-role");
});

test("canonical routing sends an incomplete Teacher to Profile Setup", () => {
  assert.equal(resolveDestination("teacher", null, ""), "/setup-profile");
});

test("canonical routing sends a complete Teacher to the Teacher area", () => {
  assert.equal(
    resolveDestination("teacher", null, "Maria Santos"),
    "/m3/teacher/dashboard",
  );
});

test("canonical routing sends an incomplete Student to Profile Setup", () => {
  assert.equal(resolveDestination("student", null, ""), "/setup-profile");
});

test("canonical routing sends a Student with no diagnostic to the diagnostic", () => {
  assert.equal(resolveDestination("student", "Sam", "", false), "/diagnostic");
});

test("canonical routing sends a diagnosed Student to the dashboard", () => {
  assert.equal(resolveDestination("student", "Sam", "", true), "/dashboard");
});

test("canonical routing sends an incomplete Independent Learner to Profile Setup", () => {
  assert.equal(resolveDestination("general_user", null, ""), "/setup-profile");
});

test("canonical routing sends an Independent Learner with no diagnostic to the diagnostic", () => {
  assert.equal(
    resolveDestination("general_user", "Kai", "", false),
    "/diagnostic",
  );
});

test("canonical routing sends a diagnosed Independent Learner to the general area", () => {
  assert.equal(
    resolveDestination("general_user", "Kai", "", true),
    "/m3/general/dashboard",
  );
});

test("canonical routing sends an Admin directly to the existing Admin area", () => {
  assert.equal(resolveDestination("admin", null, "", false), "/m3/admin/dashboard");
});

test("signup collects credentials without profile names or a role", async () => {
  const signupSource = await readFile(
    new URL("../src/modules/module1/pages/SignupPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(signupSource, /label="Email Address"/);
  assert.match(signupSource, /label="Password"/);
  assert.match(signupSource, /label="Confirm Password"/);
  assert.doesNotMatch(signupSource, /label="Full Name"/);
  assert.doesNotMatch(signupSource, /Nickname|learnerType|account_type/);
  assert.doesNotMatch(signupSource, /options:\s*\{/);
  assert.match(signupSource, /navigate\("\/select-role", \{ replace: true \}\)/);
});

test("requires the role-specific profile field", () => {
  assert.equal(requiresProfileSetup("student", "", "Student Name"), true);
  assert.equal(requiresProfileSetup("general_user", "   ", "Learner Name"), true);
  assert.equal(requiresProfileSetup("student", "Loise", ""), false);
  assert.equal(requiresProfileSetup("general_user", "Jamie", ""), false);
  assert.equal(requiresProfileSetup("teacher", "Nickname", ""), true);
  assert.equal(requiresProfileSetup("teacher", "", "Teacher Name"), false);
  assert.equal(requiresProfileSetup("admin", "", ""), false);
});

test("routes unfinished authentication states through role and profile setup", () => {
  assert.equal(getOnboardingPath(null, null, ""), "/select-role");
  assert.equal(getOnboardingPath("student", null, ""), "/setup-profile");
  assert.equal(getOnboardingPath("general_user", "", ""), "/setup-profile");
  assert.equal(getOnboardingPath("teacher", null, ""), "/setup-profile");
  assert.equal(getOnboardingPath("student", "Ana", ""), null);
  assert.equal(getOnboardingPath("general_user", "Kai", ""), null);
  assert.equal(getOnboardingPath("teacher", null, "Ms. Santos"), null);
});

test("validates signup email and nickname boundaries", () => {
  assert.equal(isValidSignupEmail("learner@example.com"), true);
  assert.equal(isValidSignupEmail("not-an-email"), false);
  assert.notEqual(getNicknameValidationError("   "), "");
  assert.equal(getNicknameValidationError("A".repeat(NICKNAME_MAX_LENGTH)), "");
  assert.notEqual(getNicknameValidationError("A".repeat(NICKNAME_MAX_LENGTH + 1)), "");
  assert.notEqual(getFullNameValidationError("   "), "");
  assert.equal(getFullNameValidationError("Maria Santos"), "");
});

test("normalizes email and requires eight characters with lowercase and uppercase letters", () => {
  assert.equal(normalizeAuthEmail("  Learner@Example.COM "), "learner@example.com");
  assert.notEqual(getPasswordValidationError("short"), "");
  assert.notEqual(getPasswordValidationError("alllowercase1!"), "");
  assert.notEqual(getPasswordValidationError("ALLUPPERCASE1!"), "");
  assert.equal(getPasswordValidationError(""), "Enter a password.");
  assert.notEqual(getPasswordValidationError("Readflo"), "");
  assert.notEqual(getPasswordValidationError("readflow"), "");
  assert.notEqual(getPasswordValidationError("READFLOW"), "");
  for (const password of ["Readflow", "HelloWorld", "StudentPass", "NoNumber!", "NoSpecial1", "StrongPass1!"]) {
    assert.equal(getPasswordValidationError(password), "", password);
  }
  assert.deepEqual(PASSWORD_REQUIREMENTS.map(({ label }) => label), [
    "8+ characters", "Lowercase letter", "Uppercase letter",
  ]);
  assert.equal(getPasswordValidationError("readflow"),
    "Password must contain at least 8 characters, including at least one lowercase letter and one uppercase letter.");
});

test("maps each authoritative profile role to its own application area", () => {
  assert.equal(getRoleHomePath("admin"), "/m3/admin/dashboard");
  assert.equal(getRoleHomePath("teacher"), "/m3/teacher/dashboard");
  assert.equal(getRoleHomePath("student"), "/dashboard");
  assert.equal(getRoleHomePath("general_user"), "/m3/general/dashboard");
});

test("routes both learner roles through the initial diagnostic only when needed", () => {
  assert.deepEqual(DIAGNOSTIC_LEARNER_ROLES, ["student", "general_user"]);
  assert.equal(isDiagnosticLearnerRole("student"), true);
  assert.equal(isDiagnosticLearnerRole("general_user"), true);
  assert.equal(isDiagnosticLearnerRole("teacher"), false);
  assert.equal(isDiagnosticLearnerRole("admin"), false);

  assert.equal(getPostLoginPathForRole("student", false), "/diagnostic");
  assert.equal(getPostLoginPathForRole("student", true), "/dashboard");
  assert.equal(getPostLoginPathForRole("general_user", false), "/diagnostic");
  assert.equal(getPostLoginPathForRole("general_user", true), "/m3/general/dashboard");
  assert.equal(getPostLoginPathForRole("teacher", false), "/m3/teacher/dashboard");
  assert.equal(getPostLoginPathForRole("admin", false), "/m3/admin/dashboard");
});

test("normal role assignment excludes Admin while preserving learner labels", () => {
  assert.deepEqual(ASSIGNABLE_USER_ROLES, ["teacher", "student", "general_user"]);
  assert.equal(isAssignableUserRole("teacher"), true);
  assert.equal(isAssignableUserRole("student"), true);
  assert.equal(isAssignableUserRole("general_user"), true);
  assert.equal(isAssignableUserRole("admin"), false);
  assert.equal(ROLE_LABELS.general_user, "Independent Learner");
});
