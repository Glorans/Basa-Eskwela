import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { resolveUserDestination } from "../src/modules/module1/utils/authOnboarding.ts";

const destination = (
  role: unknown,
  nickname: unknown,
  fullName: unknown,
  hasCompletedDiagnostic = false,
  teacherStatus: unknown = null,
) => resolveUserDestination({
  role,
  nickname,
  fullName,
  hasCompletedDiagnostic,
  teacherStatus,
});

test("1. New Student follows role selection, nickname setup, then learner onboarding", () => {
  assert.equal(destination(null, null, ""), "/select-role");
  assert.equal(destination("student", null, ""), "/setup-profile");
  assert.equal(destination("student", "Sam", ""), "/diagnostic");
});

test("2. New Teacher follows invite verification, full-name setup, then approval waiting", () => {
  assert.equal(destination(null, null, ""), "/select-role");
  assert.equal(destination("teacher", null, ""), "/setup-profile");
  assert.equal(destination("teacher", null, "Maria Santos", false, "pending"), "/teacher-verification");
});

test("3. New Independent Learner follows role selection, nickname setup, then learner onboarding", () => {
  assert.equal(destination(null, null, ""), "/select-role");
  assert.equal(destination("general_user", null, ""), "/setup-profile");
  assert.equal(destination("general_user", "Kai", ""), "/diagnostic");
});

test("4. Returning authenticated user without a role returns to Role Selection", () => {
  assert.equal(destination(null, null, ""), "/select-role");
});

test("5. Returning user with an incomplete role-specific profile returns to Profile Setup", () => {
  assert.equal(destination("student", null, ""), "/setup-profile");
  assert.equal(destination("general_user", null, ""), "/setup-profile");
  assert.equal(destination("teacher", null, ""), "/setup-profile");
});

test("6. Existing completed Teacher goes directly to the existing teacher destination", () => {
  assert.equal(destination("teacher", null, "Teacher Name", false, "approved"), "/m3/teacher/dashboard");
});

test("7. Existing completed learners retain the diagnostic/dashboard decision", () => {
  assert.equal(destination("student", "Student", "", false), "/diagnostic");
  assert.equal(destination("student", "Student", "", true), "/dashboard");
  assert.equal(destination("general_user", "Reader", "", false), "/diagnostic");
  assert.equal(destination("general_user", "Reader", "", true), "/m3/general/dashboard");
});

test("8. Existing role holders are redirected away from Role Selection", async () => {
  const page = await readFile(
    new URL("../src/modules/module1/pages/RoleSelectionPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /getPostAuthenticationPath\(profile\)/);
  assert.match(page, /destination !== "\/select-role"/);
  assert.match(page, /navigate\(destination, \{ replace: true \}\)/);
});

test("9. Admin assignment is rejected by the protected database function", async () => {
  const sql = await readFile(
    new URL("../../supabase/m1_teacher_verification.sql", import.meta.url),
    "utf8",
  );
  const rpc = sql.match(
    /create or replace function public\.assign_own_role[\s\S]*?\$\$;/i,
  )?.[0];

  assert.ok(rpc);
  assert.match(rpc, /selected_role not in \('student','general_user'\)/i);
  assert.doesNotMatch(rpc, /'admin'/i);
  assert.match(rpc, /and role is null/i);
});

test("Profile Setup stores learner nicknames separately from teacher full names", async () => {
  const [page, service, sql] = await Promise.all([
    readFile(new URL("../src/modules/module1/pages/ProfileSetupPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/module1/services/authProfile.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../supabase/m1_onboarding_security_migration.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /label=\{isTeacher \? "Full Name" : "What should we call you\?"\}/);
  assert.match(page, /completeProfileSetup\(profile\.id, normalizedValue, asksAge \? Number\(ageValue\) : undefined\)/);
  assert.match(service, /isLearner \? \{ nickname: normalizedName \} : \{ full_name: normalizedName \}/);
  assert.match(service, /\.update\(asksAge \? \{ \.\.\.nameField, age \} : nameField\)/);
  assert.match(service, /updateNickname[\s\S]*?\.update\(\{ nickname \}\)/);
  assert.match(service, /updateFullName[\s\S]*?\.update\(\{ full_name: fullName \}\)/);
  assert.match(sql, /add column if not exists nickname text/i);
});


test("Profile Setup trims learner input and refreshes the saved profile", async () => {
  const page = await readFile(new URL("../src/modules/module1/pages/ProfileSetupPage.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("const normalizedValue = profileValue.trim()"));
  assert.match(page, /await completeProfileSetup\(profile\.id, normalizedValue, asksAge \? Number\(ageValue\) : undefined\)/);
  assert.ok(page.includes("const completedProfile = await refreshProfile()"));
});

test("Module 1 source has no mojibake and uses consistent saving labels", async () => {
  const root = new URL("../src/modules/module1/", import.meta.url);
  for (const file of await readdir(root, { recursive: true })) {
    if (!/\.(tsx?|css)$/.test(file)) continue;
    const text = await readFile(new URL(file.split(String.fromCharCode(92)).join("/"), root), "utf8");
    assert.doesNotMatch(text, /\u00c3|\u00e2\u20ac|\u00e2\u2020|\ufffd/, file);
  }
  for (const file of ["ProfileSetupPage", "RoleSelectionPage", "Settings"]) {
    const text = await readFile(new URL(`pages/${file}.tsx`, root), "utf8");
    assert.ok(text.includes('saving ? "Saving..."'), file);
  }
});
