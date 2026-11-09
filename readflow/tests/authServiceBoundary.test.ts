import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("registration is role-neutral and delegated to authService", async () => {
  const [page, service] = await Promise.all([
    source("modules/module1/pages/SignupPage.tsx"),
    source("services/authService.ts"),
  ]);

  assert.match(page, /register\(email, password\)/);
  assert.doesNotMatch(page, /supabase\.auth|signUp\(/);

  const registerFunction = service.match(
    /export async function register[\s\S]*?\r?\n}\r?\n/,
  )?.[0];
  assert.ok(registerFunction);
  assert.match(registerFunction, /supabase\.auth\.signUp\(\{[\s\S]*?email:[\s\S]*?password/);
  assert.doesNotMatch(registerFunction, /options|metadata|role|admin|account_type/);
});

test("Refactor #7 login flow uses authService without duplicating routing", async () => {
  const [loginService, authService] = await Promise.all([
    source("modules/module1/services/authLogin.ts"),
    source("services/authService.ts"),
  ]);

  assert.match(loginService, /import \{ login \} from "\.\.\/\.\.\/\.\.\/services\/authService\.ts"/);
  assert.match(loginService, /login,/);
  assert.match(loginService, /getAuthProfile/);
  assert.match(loginService, /getPostAuthenticationPath/);
  assert.doesNotMatch(loginService, /supabase\.auth/);
  assert.match(authService, /supabase\.auth\.signInWithPassword/);
});

test("logout, forgot-password, and reset-password mutations use authService", async () => {
  const [sidebar, forgotPassword, resetPassword] = await Promise.all([
    source("components/basa/BasaSidebar.tsx"),
    source("modules/module1/pages/ForgotPasswordPage.tsx"),
    source("modules/module1/pages/ResetPasswordPage.tsx"),
  ]);

  assert.match(sidebar, /import \{ logout \} from "\.\.\/\.\.\/services\/authService"/);
  assert.match(sidebar, /await logout\(\)/);
  assert.doesNotMatch(sidebar, /supabase\.auth\.signOut/);

  assert.match(forgotPassword, /requestPasswordReset\(/);
  assert.doesNotMatch(forgotPassword, /supabase\.auth\.resetPasswordForEmail/);

  assert.match(resetPassword, /await updatePassword\(password\)/);
  assert.match(resetPassword, /await logout\(\)/);
  assert.doesNotMatch(resetPassword, /supabase\.auth\.(updateUser|signOut)/);
  assert.match(resetPassword, /useAuth\(\)/);
  assert.doesNotMatch(resetPassword, /supabase\.auth\.(onAuthStateChange|getSession)/);
});

test("account password mutations use authService; Settings never changes the email", async () => {
  const settings = await source("modules/module1/pages/Settings.tsx");

  assert.doesNotMatch(settings, /updateEmail/);
  assert.match(settings, /await updatePassword\(password\)/);
  assert.doesNotMatch(settings, /supabase\.auth\.updateUser/);
  assert.match(settings, /useAuth\(\)/);
  assert.doesNotMatch(settings, /supabase\.auth\.getUser/);
});

test("all in-scope Supabase auth mutations are centralized", async () => {
  const files = [
    "modules/module1/pages/SignupPage.tsx",
    "modules/module1/services/authLogin.ts",
    "components/basa/BasaSidebar.tsx",
    "modules/module1/pages/ForgotPasswordPage.tsx",
    "modules/module1/pages/ResetPasswordPage.tsx",
    "modules/module1/pages/Settings.tsx",
  ];
  const contents = await Promise.all(files.map(source));

  for (const content of contents) {
    assert.doesNotMatch(
      content,
      /supabase\.auth\.(signUp|signInWithPassword|signOut|resetPasswordForEmail|updateUser)/,
    );
  }

  const service = await source("services/authService.ts");
  for (const operation of [
    "signUp",
    "signInWithPassword",
    "signOut",
    "resetPasswordForEmail",
    "updateUser",
  ]) {
    assert.match(service, new RegExp(`supabase\\.auth\\.${operation}`));
  }
});
