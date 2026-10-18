import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("shared M1 components own their CSS", async () => {
  const [layout, field, button, error, guard] = await Promise.all([
    source("modules/module1/components/AuthLayout.tsx"),
    source("modules/module1/components/TextField.tsx"),
    source("modules/module1/components/AuthSubmitButton.tsx"),
    source("modules/module1/components/AuthFormError.tsx"),
    source("components/auth/RequireAuth.tsx"),
  ]);

  assert.match(layout, /import "\.\/AuthLayout\.css"/);
  assert.match(field, /import "\.\/TextField\.css"/);
  assert.match(button, /import "\.\/AuthSubmitButton\.css"/);
  assert.match(error, /import "\.\/AuthFormError\.css"/);
  assert.match(guard, /import "\.\/RequireAuth\.css"/);
});

test("AuthLayout CSS retains layout and short-height behavior only", async () => {
  const css = await source("modules/module1/components/AuthLayout.css");

  for (const selector of [
    ".auth-page",
    ".auth-card",
    ".auth-brand-panel",
    ".auth-mascot",
    ".auth-form-panel",
    ".auth-header",
    ".auth-recovery-form",
  ]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }

  assert.match(css, /@media \(min-width: 801px\) and \(max-height: 760px\)/);
  assert.match(css, /height: clamp\(250px, 38dvh, 285px\)/);
  assert.match(css, /width: clamp\(420px, 64dvh, 470px\)/);
  assert.doesNotMatch(css, /auth-input|auth-password-toggle|auth-submit|auth-error|auth-route-status/);
});

test("legacy and obsolete selectors were removed", async () => {
  const styles = await Promise.all([
    source("modules/module1/components/AuthLayout.css"),
    source("modules/module1/pages/Settings.css"),
  ]);
  const css = styles.join("\n");

  assert.doesNotMatch(
    css,
    /auth-select|auth-role-fieldset|auth-role-card|auth-helper-text|auth-otp|auth-inline-button|basa-settings-avatar-edit/,
  );
  assert.doesNotMatch(css, /!important/);
});

test("page-specific styles remain with their pages", async () => {
  const [role, profile, settings, global] = await Promise.all([
    source("modules/module1/pages/RoleSelectionPage.css"),
    source("modules/module1/pages/ProfileSetupPage.css"),
    source("modules/module1/pages/Settings.css"),
    source("index.css"),
  ]);

  assert.match(role, /\.role-selection-page/);
  assert.match(role, /\.role-option/);
  assert.match(profile, /\.profile-setup-card/);
  assert.match(settings, /\.basa-settings-card/);
  assert.doesNotMatch(global, /auth-page|auth-route-status|role-selection-page/);
});
