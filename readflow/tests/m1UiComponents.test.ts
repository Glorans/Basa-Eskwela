import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("shared auth button preserves submit and loading behavior", async () => {
  const button = await source("modules/module1/components/AuthSubmitButton.tsx");

  assert.match(button, /className="auth-submit"/);
  assert.match(button, /type="submit"/);
  assert.match(button, /disabled=\{disabled \|\| submitting\}/);
  assert.match(button, /submitting \? submittingLabel : label/);
});

test("shared auth error preserves accessible alert markup", async () => {
  const error = await source("modules/module1/components/AuthFormError.tsx");

  assert.match(error, /if \(!message\) return null/);
  assert.match(error, /className="auth-error" role="alert"/);
});

test("auth pages reuse shared layout, fields, errors, and submit buttons", async () => {
  const paths = [
    "modules/module1/pages/LoginPage.tsx",
    "modules/module1/pages/SignupPage.tsx",
    "modules/module1/pages/ForgotPasswordPage.tsx",
    "modules/module1/pages/ResetPasswordPage.tsx",
  ];
  const pages = await Promise.all(paths.map(source));

  for (const page of pages) {
    assert.match(page, /<AuthLayout/);
    assert.match(page, /<TextField/);
    assert.match(page, /<AuthFormError/);
    assert.match(page, /<AuthSubmitButton/);
    assert.doesNotMatch(page, /className="auth-submit"/);
  }
});

test("password visibility remains centralized in TextField", async () => {
  const [field, login, signup, reset] = await Promise.all([
    source("modules/module1/components/TextField.tsx"),
    source("modules/module1/pages/LoginPage.tsx"),
    source("modules/module1/pages/SignupPage.tsx"),
    source("modules/module1/pages/ResetPasswordPage.tsx"),
  ]);

  assert.match(field, /useState\(false\)/);
  assert.match(field, /isPasswordVisible \? "Hide password" : "Show password"/);
  assert.match(field, /aria-pressed=\{isPasswordVisible\}/);
  assert.equal((login.match(/showPasswordToggle/g) ?? []).length, 1);
  assert.equal((signup.match(/showPasswordToggle/g) ?? []).length, 2);
  assert.equal((reset.match(/showPasswordToggle/g) ?? []).length, 2);
});

test("Role Selection and Profile Setup retain their specialized components", async () => {
  const [roleSelection, profileSetup] = await Promise.all([
    source("modules/module1/pages/RoleSelectionPage.tsx"),
    source("modules/module1/pages/ProfileSetupPage.tsx"),
  ]);

  assert.match(roleSelection, /roles\.map\(\(role\) =>/);
  assert.match(roleSelection, /<RoleOption/);
  assert.match(roleSelection, /disabled=\{checking \|\| saving \|\| !selectedRole\}/);
  for (const role of ["student", "teacher", "general_user"]) {
    assert.match(roleSelection, new RegExp(`value: "${role}"`));
  }

  assert.match(profileSetup, /isTeacher \? "What is your full name\?" : "What should we call you\?"/);
  assert.match(profileSetup, /isTeacher \? "Enter your full name" : "Enter your nickname"/);
  assert.doesNotMatch(profileSetup, /<AuthLayout/);
});
