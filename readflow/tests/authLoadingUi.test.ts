import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("M1 authentication transitions render no dedicated loading message", async () => {
  const paths = [
    "components/auth/RequireAuth.tsx",
    "modules/module1/pages/RoleSelectionPage.tsx",
    "modules/module1/pages/ProfileSetupPage.tsx",
    "modules/module1/pages/ResetPasswordPage.tsx",
    "modules/module1/pages/Settings.tsx",
  ];
  const contents = await Promise.all(paths.map(source));

  for (const content of contents) {
    assert.doesNotMatch(
      content,
      /Checking your account|Checking your profile|Checking your password reset link|Loading your profile/i,
    );
  }

  assert.match(contents[0], /if \(loading\) \{\s*return null;/);
  assert.match(contents[1], /if \(checking\) return null;/);
  assert.match(contents[2], /if \(loading\) return null;/);
  assert.match(contents[3], /if \(checkingSession\) \{\s*return null;/);
  assert.match(contents[4], /if \(loading && !account\) \{\s*return null;/);
});

test("silent transitions retain authentication, error, and routing checks", async () => {
  const [provider, guard, roleSelection, profileSetup] = await Promise.all([
    source("auth/AuthProvider.tsx"),
    source("components/auth/RequireAuth.tsx"),
    source("modules/module1/pages/RoleSelectionPage.tsx"),
    source("modules/module1/pages/ProfileSetupPage.tsx"),
  ]);

  assert.match(provider, /supabase\.auth\.getUser\(\)/);
  assert.match(provider, /getAuthProfile\(user\.id\)/);
  assert.match(guard, /if \(!user\)[\s\S]*?<Navigate to="\/login"/);
  assert.match(guard, /profileError \|\| !profile/);
  assert.match(guard, /getOnboardingPath\(/);
  assert.match(roleSelection, /assignOwnRoleOnce\(selectedRole, inviteCode\)/);
  assert.match(roleSelection, /getPostAuthenticationPath\(assignedProfile\)/);
  assert.doesNotMatch(roleSelection, /navigate\("\/setup-profile"/);
  assert.match(profileSetup, /getPostAuthenticationPath\(profile\)/);
  assert.match(profileSetup, /getPostAuthenticationPath\(completedProfile\)/);
});
