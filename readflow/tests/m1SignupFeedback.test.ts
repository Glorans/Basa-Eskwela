import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function loadAuthService(signUpResult: unknown) {
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(read("../src/services/authService.ts"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, {
    module, exports: module.exports,
    require: (id: string) => id.includes("supabaseClient")
      ? { supabase: { auth: { signUp: async () => signUpResult } } }
      : { normalizeAuthEmail: (value: string) => value.trim().toLowerCase() },
  });
  return module.exports;
}

const failure = (error: object) => ({ data: { user: null, session: null }, error: { message: "", ...error } });

test("an already-registered email gets Log In and Reset Password guidance, never the raw Supabase text", async () => {
  const service = loadAuthService(failure({ code: "user_already_exists", status: 422, message: "User already registered" }));
  await assert.rejects(service.register("Teacher@Example.com", "Pass-word1"), (error: any) => {
    assert.equal(error.name, "AuthServiceError");
    assert.equal(error.kind, "account_help");
    assert.match(error.message, /log in or reset your password/);
    assert.doesNotMatch(error.message, /User already registered|exists in our system|is registered/);
    return true;
  });
});

test("rate limits and unknown internal errors stay clear without exposing internals", async () => {
  const limited = loadAuthService(failure({ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" }));
  await assert.rejects(limited.register("a@example.com", "Pass-word1"), (error: any) =>
    error.kind === "account_help" && /wait a few minutes/.test(error.message) && !/rate limit exceeded/.test(error.message));
  const internal = loadAuthService(failure({ status: 500, message: "Database error saving new user" }));
  await assert.rejects(internal.register("a@example.com", "Pass-word1"), (error: any) =>
    error.kind === undefined && error.message === "We couldn't create your account right now. Please try again.");
});

test("sign-up success reports only whether a session exists", async () => {
  // A hidden-existence response (no identities, no session) is treated like any unconfirmed sign-up.
  assert.equal((await loadAuthService({ data: { user: { identities: [] }, session: null }, error: null }).register("a@example.com", "Pass-word1")).hasSession, false);
  assert.equal((await loadAuthService({ data: { user: {}, session: { access_token: "x" } }, error: null }).register("a@example.com", "Pass-word1")).hasSession, true);
});

test("pending confirmation never claims the account was created, and sign-up links the next steps", () => {
  const login = read("../src/modules/module1/pages/LoginPage.tsx");
  const notice = read("../src/modules/module1/components/EmailConfirmationNotice.tsx");
  assert.doesNotMatch(login + notice, /Account created/);
  assert.match(login, /state\.confirmationSent \? "sent" : "maybe-sent"/);
  assert.match(notice, /If your email address needs verification, you'll receive a confirmation link\. Please check your inbox and Spam folder\./);
  const signup = read("../src/modules/module1/pages/SignupPage.tsx");
  assert.match(signup, /signupError\.kind === "account_help"/);
  assert.match(signup, /to="\/login"[^>]*>Log In<\/Link>[\s\S]*to="\/forgot-password"[^>]*>Reset Password<\/Link>/);
});
