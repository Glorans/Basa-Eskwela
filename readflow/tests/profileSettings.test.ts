import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getEditableProfileField,
  getEditableProfileValue,
} from "../src/modules/module1/utils/profileFields.ts";
import {
  FULL_NAME_MAX_LENGTH,
  getFullNameValidationError,
  getNicknameValidationError,
  getProfileNameValidationError,
} from "../src/modules/module1/utils/authOnboarding.ts";

const source = (path: string) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("Student, Independent Learner, Teacher, and Admin can view Settings", async () => {
  const app = await source("App.tsx");

  for (const role of ["student", "general_user", "teacher", "admin"]) {
    assert.match(app, new RegExp(`allowedRoles=\\{\\["${role}"\\]\\}`));
  }

  assert.equal(
    app.match(/<Route\s+path="settings"\s+element=\{<Settings\s*\/>\}\s*\/>/g)?.length,
    4,
  );
});

test("each role receives only its supported editable profile field", async () => {
  const settings = await source("modules/module1/pages/Settings.tsx");

  assert.equal(getEditableProfileField("student"), "nickname");
  assert.equal(getEditableProfileField("general_user"), "nickname");
  assert.equal(getEditableProfileField("teacher"), "full_name");
  assert.equal(getEditableProfileField("admin"), "full_name");
  assert.equal(getEditableProfileField("unsupported"), null);
  assert.equal(
    getEditableProfileValue({
      role: "student",
      nickname: "Reader",
      full_name: "Student Legal Name",
    }),
    "Reader",
  );
  assert.equal(
    getEditableProfileValue({
      role: "teacher",
      nickname: "Teacher Nickname",
      full_name: "Teacher Name",
    }),
    "Teacher Name",
  );

  assert.match(settings, /getEditableProfileField\(account\.profile\.role\)/);
  assert.match(settings, /getEditableProfileValue\(currentProfile\)/);
  assert.match(settings, /editsNickname \? "Nickname" : "Full Name"/);
  assert.match(
    settings,
    /if \(editsNickname\) \{[\s\S]*?updateNickname\(account\.userId, normalizedName\)[\s\S]*?else \{[\s\S]*?updateFullName\(account\.userId, normalizedName\)/,
  );
  // Settings picks the validator from the role's editable field via the shared helper.
  assert.match(settings, /const editsNickname = editableProfileField === "nickname"/);
  assert.match(settings, /getProfileNameValidationError\(normalizedName, editsNickname\)/);
  const tooLong = "A".repeat(FULL_NAME_MAX_LENGTH + 1);
  assert.equal(getProfileNameValidationError(tooLong, true), getNicknameValidationError(tooLong));
  assert.equal(getProfileNameValidationError(tooLong, false), getFullNameValidationError(tooLong));
  assert.notEqual(getNicknameValidationError(tooLong), getFullNameValidationError(tooLong));
});

test("role and status are visible protected text, not editable form fields", async () => {
  const settings = await source("modules/module1/pages/Settings.tsx");

  assert.match(settings, /<span id="accountRoleLabel">Role<\/span>/);
  assert.match(settings, /<p aria-labelledby="accountRoleLabel">\{roleLabel\}<\/p>/);
  assert.match(settings, /<span id="accountStatusLabel">Status<\/span>/);
  const formControls = settings.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];
  for (const control of formControls) {
    assert.doesNotMatch(control, /(?:id|name)="(?:account)?(?:role|status)"/i);
  }
  assert.doesNotMatch(settings, /setRole|setStatus|setAccountType|setAuthorization/i);
});

test("profile service exposes only explicit editable-field updates", async () => {
  const service = await source("modules/module1/services/authProfile.ts");
  const nicknameUpdate = service.match(
    /export async function updateNickname[\s\S]*?\r?\n}\r?\n/,
  )?.[0];
  const fullNameUpdate = service.match(
    /export async function updateFullName[\s\S]*?\r?\n}\r?\n/,
  )?.[0];

  assert.ok(nicknameUpdate);
  assert.ok(fullNameUpdate);
  assert.match(nicknameUpdate, /\.update\(\{ nickname \}\)/);
  assert.match(fullNameUpdate, /\.update\(\{ full_name: fullName \}\)/);
  assert.match(nicknameUpdate, /assertProfileFieldEditable\(userId, "nickname"\)/);
  assert.match(fullNameUpdate, /assertProfileFieldEditable\(userId, "full_name"\)/);

  for (const update of [nicknameUpdate, fullNameUpdate]) {
    assert.doesNotMatch(
      update,
      /role|status|account_type|authoriz|owner|admin|created_at/i,
    );
  }

  assert.doesNotMatch(service, /export async function updateProfile/);
  assert.doesNotMatch(service, /updateOwnProfileName/);
  assert.match(
    service,
    /const profile = await getAuthProfile\(userId\)[\s\S]*?getEditableProfileField\(profile\.role\) !== expectedField/,
  );
});

test("successful Settings saves refresh central profile state", async () => {
  const settings = await source("modules/module1/pages/Settings.tsx");

  assert.match(settings, /const currentProfile = refresh \? await refreshProfile\(\) : profile/);
  assert.match(
    settings,
    /await update(?:Nickname|FullName)\(account\.userId, normalizedName\)[\s\S]*?await loadAccount\(true\)/,
  );
});

test("existing email and password settings remain delegated to authService", async () => {
  const settings = await source("modules/module1/pages/Settings.tsx");

  assert.match(settings, /await updateEmail\(normalizedEmail\)/);
  assert.match(settings, /await updatePassword\(password\)/);
  assert.match(settings, /Password \(leave blank if unchanged\)/);
  assert.match(settings, /Confirm Password/);
  assert.doesNotMatch(settings, /supabase\.auth\.updateUser/);
});
