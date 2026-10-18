import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("AuthProvider initializes the authenticated user and ReadFlow profile", async () => {
  const [provider, main] = await Promise.all([
    source("auth/AuthProvider.tsx"),
    source("main.tsx"),
  ]);

  assert.match(provider, /supabase\.auth\.getUser\(\)/);
  assert.match(provider, /getAuthProfile\(user\.id\)/);
  assert.match(provider, /setState\(\{ user, profile, loading: false/);
  assert.match(main, /<AuthProvider>[\s\S]*?<App \/>/);
});

test("AuthProvider represents unauthenticated and NULL-role states", async () => {
  const provider = await source("auth/AuthProvider.tsx");

  assert.match(
    provider,
    /user: null,[\s\S]*?profile: null,[\s\S]*?loading: false,[\s\S]*?profileError: false/,
  );
  assert.match(provider, /role: state\.profile\?\.role \?\? null/);
});

test("sign-out and auth changes clear or replace centralized state", async () => {
  const provider = await source("auth/AuthProvider.tsx");

  assert.match(provider, /supabase\.auth\.onAuthStateChange\(\(event, session\)/);
  assert.match(provider, /event === "SIGNED_OUT"/);
  assert.match(provider, /clearAuthState\(event\)/);
  assert.match(provider, /userRef\.current = null/);
  assert.match(provider, /loadAuthenticatedUser\(session\.user, event\)/);
});

test("RequireAuth consumes centralized state and preserves onboarding helpers", async () => {
  const guard = await source("components/auth/RequireAuth.tsx");

  assert.match(guard, /useAuth\(\)/);
  assert.match(guard, /getOnboardingPath\(/);
  assert.match(guard, /getRoleHomePath\(/);
  assert.doesNotMatch(guard, /supabase|getAuthProfile|onAuthStateChange|getUser/);
});

test("useAuthenticatedProfile is a thin compatibility wrapper", async () => {
  const hook = await source("hooks/useAuthenticatedProfile.ts");

  assert.match(hook, /useAuth\(\)/);
  assert.match(hook, /return \{ profile, loading, failed: profileError \}/);
  assert.doesNotMatch(hook, /supabase|getAuthProfile|onAuthStateChange|getUser|useEffect/);
});

test("M1 pages no longer create independent auth-state loaders", async () => {
  const paths = [
    "components/auth/RequireAuth.tsx",
    "hooks/useAuthenticatedProfile.ts",
    "modules/module1/pages/RoleSelectionPage.tsx",
    "modules/module1/pages/ProfileSetupPage.tsx",
    "modules/module1/pages/Settings.tsx",
    "modules/module1/pages/admin/UserManagementPage.tsx",
    "modules/module1/pages/ResetPasswordPage.tsx",
  ];
  const contents = await Promise.all(paths.map(source));

  for (const content of contents) {
    assert.doesNotMatch(
      content,
      /supabase\.auth\.(getUser|getSession|onAuthStateChange)/,
    );
  }

  const provider = await source("auth/AuthProvider.tsx");
  assert.equal((provider.match(/supabase\.auth\.onAuthStateChange/g) ?? []).length, 1);
});

test("profile-changing onboarding pages refresh centralized profile state", async () => {
  const [roleSelection, profileSetup] = await Promise.all([
    source("modules/module1/pages/RoleSelectionPage.tsx"),
    source("modules/module1/pages/ProfileSetupPage.tsx"),
  ]);

  assert.match(roleSelection, /await assignOwnRoleOnce\(selectedRole, inviteCode\)[\s\S]*?await refreshProfile\(\)/);
  assert.match(profileSetup, /completeProfileSetup/);
  assert.match(profileSetup, /const completedProfile = await refreshProfile\(\)/);
});
