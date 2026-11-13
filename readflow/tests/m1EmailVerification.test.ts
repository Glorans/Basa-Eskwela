import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { parseAuthRedirect } from "../src/auth/authRedirect.ts";
import { isEmailNotConfirmedError, LoginFlowError, runLoginFlow } from "../src/modules/module1/services/authLoginFlow.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const SITE = "https://basa-eskwela-frontend.onrender.com";

test("expired, replaced and invalid confirmation links are captured and removed from the address", () => {
  const expired = parseAuthRedirect(`${SITE}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=`);
  assert.deepEqual(expired, { result: { kind: "link-error", expired: true }, cleanUrl: "/login" });
  const other = parseAuthRedirect(`${SITE}/login?error=server_error&error_code=unexpected_failure&error_description=x`);
  assert.deepEqual(other, { result: { kind: "link-error", expired: false }, cleanUrl: "/login" });
});

test("a successful sign-up callback keeps its fragment for Supabase and stores no token", () => {
  const { result, cleanUrl } = parseAuthRedirect(`${SITE}/#access_token=SECRET-ACCESS&refresh_token=SECRET-REFRESH&expires_in=3600&token_type=bearer&type=signup`);
  assert.deepEqual(result, { kind: "signup-link" });
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  assert.equal(cleanUrl, "/login#access_token=SECRET-ACCESS&refresh_token=SECRET-REFRESH&expires_in=3600&token_type=bearer&type=signup");
});

test("password-reset links, other callbacks and ordinary pages are left untouched", () => {
  for (const href of [
    `${SITE}/reset-password#error=access_denied&error_code=otp_expired&error_description=x`,
    `${SITE}/reset-password#access_token=x&type=recovery`,
    `${SITE}/admin/teacher-invitations?tab=pending`,
    `${SITE}/login`,
  ]) assert.deepEqual(parseAuthRedirect(href), { result: null, cleanUrl: null }, href);
});

test("a password-reset link that lands on another page is moved to /reset-password", () => {
  // Previously left untouched, which signed the user in on the home page with no reset form.
  assert.deepEqual(parseAuthRedirect(`${SITE}/#access_token=x&type=recovery`),
    { result: null, cleanUrl: "/reset-password#access_token=x&type=recovery" });
});

test("the capture module stays the first import so it runs before the Supabase client and router", () => {
  const main = read("../src/main.tsx");
  assert.match(main.split("\n")[0], /^import "\.\/auth\/captureAuthRedirect\.ts";/);
  // No Supabase import (it must not create the client early) and no logging of the address.
  assert.doesNotMatch(read("../src/auth/authRedirect.ts"), /^import .*supabase|console\./im);
});

function loadAuthService(auth: Record<string, unknown>) {
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(read("../src/services/authService.ts"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, {
    module, exports: module.exports,
    require: (id: string) => id.includes("supabaseClient")
      ? { supabase: { auth } }
      : { normalizeAuthEmail: (value: string) => value.trim().toLowerCase() },
  });
  return module.exports;
}

test("resend asks Supabase for a sign-up email and maps failures without revealing accounts", async () => {
  const calls: unknown[] = [];
  const service = (result: unknown) => loadAuthService({ resend: async (args: unknown) => { calls.push(args); return result; } });
  await service({ data: {}, error: null }).resendSignupConfirmation(" Teacher@Example.com ");
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ type: "signup", email: "teacher@example.com" }));
  const kindOf = async (error: object) => {
    try { await service({ data: {}, error: { message: "x", ...error } }).resendSignupConfirmation("a@example.com"); return "resolved"; }
    catch (failure: any) { return failure.kind; }
  };
  assert.equal(await kindOf({ code: "over_email_send_rate_limit", status: 429 }), "rate_limited");
  assert.equal(await kindOf({ status: 0, name: "AuthRetryableFetchError" }), "network");
  assert.equal(await kindOf({ status: 500 }), "unavailable");
  assert.equal(await kindOf({ status: 422, code: "email_address_not_authorized" }), "resolved");
});

test("sign-up reports a sent confirmation only when Supabase reliably confirms it", async () => {
  const signUp = (data: unknown) => loadAuthService({ signUp: async () => ({ data, error: null }) }).register("a@example.com", "Pass-word1");
  assert.equal((await signUp({ user: { identities: [{}], confirmation_sent_at: "2026-11-01T00:00:00Z" }, session: null })).confirmationSent, true);
  assert.equal((await signUp({ user: { identities: [], confirmation_sent_at: "2026-11-01T00:00:00Z" }, session: null })).confirmationSent, false);
  assert.equal((await signUp({ user: { identities: [{}] }, session: null })).confirmationSent, false);
});

test("verification success needs a Supabase session whose email is confirmed", async () => {
  const check = (data: unknown, error: unknown = null) => loadAuthService({ getSession: async () => ({ data, error }) }).hasConfirmedEmailSession();
  assert.equal(await check({ session: { user: { email_confirmed_at: "2026-11-01T00:00:00Z" } } }), true);
  assert.equal(await check({ session: { user: { email_confirmed_at: null } } }), false);
  assert.equal(await check({ session: null }), false);
  assert.equal(await check({ session: null }, { message: "x" }), false);
});

test("only Supabase's email_not_confirmed login result shows the verification notice", async () => {
  const attempt = (error: { message: string; code?: string }) => runLoginFlow("a@example.com", "Pass-word1", {
    login: async () => ({ data: { user: null }, error }),
    getProfile: async () => { throw new Error("not reached"); },
    resolveDestination: async () => "/",
  }).catch((failure) => failure);
  assert.equal(isEmailNotConfirmedError(await attempt({ message: "Email not confirmed", code: "email_not_confirmed" })), true);
  const invalid = await attempt({ message: "Invalid login credentials", code: "invalid_credentials" });
  assert.equal(isEmailNotConfirmedError(invalid), false);
  assert.ok(invalid instanceof LoginFlowError);
  assert.equal(isEmailNotConfirmedError(new Error("Email not confirmed")), false);
});

test("the notice offers resend with a cooldown and never claims delivery after a resend", () => {
  const notice = read("../src/modules/module1/components/EmailConfirmationNotice.tsx");
  assert.match(notice, /RESEND_COOLDOWN_SECONDS = 60/);
  assert.match(notice, /disabled=\{resend === "sending" \|\| secondsLeft > 0\}/);
  assert.match(notice, /If your email address needs verification, please check your inbox for a new confirmation link\./);
  for (const heading of ["Check Your Email! 📩", "Confirmation Link Expired", "Email Not Yet Verified", "Email Verified Successfully!"]) {
    assert.ok(notice.includes(heading), heading);
  }
});
