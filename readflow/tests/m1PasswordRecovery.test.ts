import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { captureAuthRedirect, getAuthRedirectResult, isRecoveryCallback, parseAuthRedirect } from "../src/auth/authRedirect.ts";
import * as recovery from "../src/auth/recoverySession.ts";
import * as dailyLogin from "../src/services/dailyLoginClaim.ts";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M1 password recovery (audit F3–F6). Every Supabase and API response here is a local mock;
// nothing reaches a real project. Token values are synthetic.

const require = createRequire(import.meta.url);
const SITE = "https://basa-eskwela-frontend.onrender.com";
const TOKEN = "SYNTHETIC-ACCESS-TOKEN";
const RECOVERY = `#access_token=${TOKEN}&expires_in=3600&refresh_token=SYNTHETIC-REFRESH&token_type=bearer&type=recovery`;
const EXPIRED = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
const real = (rel: string) => require(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)));

function fakeWindow(path: string) {
  const replaced: string[] = [];
  return {
    replaced,
    win: { location: { href: `${SITE}${path}` }, history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) } } as unknown as Window,
  };
}

test.beforeEach(() => recovery.clearPasswordRecovery());

// ---------- F3: recovery links ----------

test("F3: a valid recovery link on /reset-password is left for the page and marks a recovery session", () => {
  assert.deepEqual(parseAuthRedirect(`${SITE}/reset-password${RECOVERY}`), { result: null, cleanUrl: null });
  const { win, replaced } = fakeWindow(`/reset-password${RECOVERY}`);
  captureAuthRedirect(win);
  assert.deepEqual(replaced, [], "the address is not rewritten");
  assert.equal(recovery.getPasswordRecoveryState(), "pending", "a recovery visit until Supabase answers");
});

test("F3: a valid recovery link on another page is moved to /reset-password with its fragment", () => {
  for (const path of ["/", "/login", "/dashboard?tab=1"]) {
    recovery.clearPasswordRecovery();
    const { win, replaced } = fakeWindow(`${path}${RECOVERY}`);
    captureAuthRedirect(win);
    assert.deepEqual(replaced, [`/reset-password${RECOVERY}`], path);
    assert.equal(recovery.getPasswordRecoveryState(), "pending", path);
    assert.equal(getAuthRedirectResult(), null, "no login-page notice for a recovery link");
  }
});

test("F3: only the real reset route counts; look-alike paths are redirected to it", () => {
  for (const path of ["/reset-password-other", "/reset-passwords", "/reset-password-x/y", "/reset-password/extra"]) {
    recovery.clearPasswordRecovery();
    const { win, replaced } = fakeWindow(`${path}${RECOVERY}`);
    captureAuthRedirect(win);
    assert.deepEqual(replaced, [`/reset-password${RECOVERY}`], path);
    assert.equal(recovery.getPasswordRecoveryState(), "pending", path);
  }
  for (const path of ["/reset-password", "/reset-password/"]) {
    assert.deepEqual(parseAuthRedirect(`${SITE}${path}${RECOVERY}`), { result: null, cleanUrl: null }, path);
  }
  recovery.clearPasswordRecovery();
  assert.equal(recovery.isResetPasswordPath("/reset-password-other"), false);
  assert.equal(recovery.blocksDailyLogin("/reset-password-other"), false, "no reward guard on look-alike pages");
  // An error link on a look-alike path now gets the normal expired-link notice instead of being ignored.
  assert.deepEqual(parseAuthRedirect(`${SITE}/reset-password-other${EXPIRED}`), { result: { kind: "link-error", expired: true }, cleanUrl: "/login" });
});

test("F3: ordinary pages and sign-in are never sent to the reset page", () => {
  for (const path of ["/", "/login", "/dashboard", "/forgot-password", "/?type=recovery"]) {
    const { win, replaced } = fakeWindow(path);
    captureAuthRedirect(win);
    assert.deepEqual(replaced, [], path);
  }
  assert.equal(recovery.isPasswordRecoveryMarked(), false);
});

test("F3: email confirmation and other link types keep their current handling", () => {
  assert.deepEqual(parseAuthRedirect(`${SITE}/#access_token=x&type=signup`), { result: { kind: "signup-link" }, cleanUrl: "/login#access_token=x&type=signup" });
  for (const type of ["magiclink", "invite", "email_change"]) {
    assert.deepEqual(parseAuthRedirect(`${SITE}/#access_token=x&type=${type}`), { result: null, cleanUrl: null }, type);
  }
  captureAuthRedirect(fakeWindow("/#access_token=x&type=signup").win);
  assert.equal(recovery.isPasswordRecoveryMarked(), false, "a sign-up session is a genuine sign-in");
});

test("F3: an invalid recovery token is not judged here; Supabase validates it on the reset page", () => {
  // The fragment is passed through unchanged; whether it is valid is decided by the Supabase client.
  assert.deepEqual(parseAuthRedirect(`${SITE}/#access_token=not-a-real-token&type=recovery`),
    { result: null, cleanUrl: "/reset-password#access_token=not-a-real-token&type=recovery" });
  assert.equal(isRecoveryCallback(`${SITE}/#type=recovery`), false, "no token, no recovery callback");
});

test("F3: expired or failed recovery links keep the current error handling and mark nothing", () => {
  assert.deepEqual(parseAuthRedirect(`${SITE}/${EXPIRED}`), { result: { kind: "link-error", expired: true }, cleanUrl: "/login" });
  assert.deepEqual(parseAuthRedirect(`${SITE}/${EXPIRED}&type=recovery&access_token=x`), { result: { kind: "link-error", expired: true }, cleanUrl: "/login" });
  assert.deepEqual(parseAuthRedirect(`${SITE}/reset-password${EXPIRED}`), { result: null, cleanUrl: null });
  captureAuthRedirect(fakeWindow(`/reset-password${EXPIRED}`).win);
  captureAuthRedirect(fakeWindow(`/${EXPIRED}&type=recovery&access_token=x`).win);
  assert.equal(recovery.isPasswordRecoveryMarked(), false);
});

test("F3: the redirect cannot loop and only targets the fixed same-origin reset path", () => {
  const { cleanUrl } = parseAuthRedirect(`${SITE}/${RECOVERY}`);
  assert.equal(cleanUrl, `/reset-password${RECOVERY}`);
  assert.deepEqual(parseAuthRedirect(`${SITE}${cleanUrl}`), { result: null, cleanUrl: null }, "second pass is a no-op");
  const hostile = parseAuthRedirect(`${SITE}/?redirect_to=https://evil.example${RECOVERY}`);
  assert.ok(hostile.cleanUrl?.startsWith("/reset-password#"), "query parameters never choose the destination");
});

test("F3: no token is read into results, storage or logs", () => {
  const { win } = fakeWindow(`/${RECOVERY}`);
  captureAuthRedirect(win);
  assert.doesNotMatch(JSON.stringify(getAuthRedirectResult()), /SYNTHETIC/);
  for (const file of ["auth/authRedirect.ts", "auth/recoverySession.ts"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    // Presence checks (`has("access_token")`) are fine; reading a token value or logging is not.
    assert.doesNotMatch(source, /console\.|get\("(access|refresh)_token"\)|refresh_token/, file);
  }
});

// ---------- Mocked auth service (shared by F4, F5, F6) ----------

type Auth = Record<string, (...args: any[]) => Promise<any>>;
function loadAuthService(auth: Auth) {
  const source = readFileSync(new URL("../src/services/authService.ts", import.meta.url), "utf8");
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, Error,
    require: (id: string) => id.endsWith("/supabaseClient.ts") ? { supabase: { auth } }
      : id.endsWith("/authOnboarding.ts") ? { normalizeAuthEmail: (value: string) => value.trim().toLowerCase() }
      : id.endsWith("/recoverySession.ts") ? recovery
      : { clearAllModuleDrafts: () => {} },
  });
  return module.exports;
}

const providerError = (fields: Record<string, unknown>) => Object.assign(new Error(String(fields.message ?? "provider text")), fields);

// ---------- F4: forgot-password request ----------

function mountForgot(resetResult: () => Promise<{ error: unknown }>) {
  const calls: unknown[] = [];
  const service = loadAuthService({ resetPasswordForEmail: async (...args: unknown[]) => { calls.push(args); return resetResult(); } });
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module1/pages/ForgotPasswordPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/services/authService")) return service;
    if (id.endsWith("/utils/authOnboarding")) return real("modules/module1/utils/authOnboarding.ts");
    if (id.includes("/components/")) return { default: () => null };
    return require(id);
  }, { window: { location: { origin: "http://127.0.0.1:5174" } }, Error });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  return {
    calls, render,
    type: (value: string) => findAll(render(), (n) => n.props?.id === "recoveryEmail")[0].props.onChange({ target: { value } }),
    submit: async () => { findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); await settle(); },
    error: () => findAll(render(), (n) => n.props && "message" in n.props)[0]?.props.message ?? "",
    text: () => textOf(render()),
  };
}

const NEUTRAL = /If an account exists for this email, we.ve sent password reset instructions/;

test("F4: a successful request shows the neutral confirmation and sends the reset-page address", async () => {
  const page = mountForgot(async () => ({ error: null }));
  page.type("  Learner@Example.TEST ");
  await page.submit();
  assert.match(page.text(), NEUTRAL);
  assert.equal(JSON.stringify(page.calls[0]), JSON.stringify(["learner@example.test", { redirectTo: "http://127.0.0.1:5174/reset-password" }]));
});

test("F4: an unknown email address gets exactly the same confirmation (Supabase reports success)", async () => {
  const known = mountForgot(async () => ({ error: null }));
  known.type("known@example.test"); await known.submit();
  const unknown = mountForgot(async () => ({ error: null }));
  unknown.type("nobody@example.test"); await unknown.submit();
  assert.equal(unknown.text(), known.text());
});

const requestFailures: [string, Record<string, unknown>, RegExp][] = [
  ["rate limited", { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, /Too many password reset requests.*wait a while/],
  ["request rate limited", { name: "AuthApiError", status: 429, code: "over_request_rate_limit" }, /Too many password reset requests/],
  ["unauthorized recipient", { name: "AuthApiError", status: 400, code: "email_address_not_authorized", message: "Email address not authorized" }, /couldn't send the password reset email right now.*teacher or school administrator/],
  ["delivery failure", { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Error sending recovery email" }, /couldn't send the password reset email right now/],
  ["network failure", { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }, /couldn't reach the password recovery service.*internet connection/],
];

for (const [label, fields, expected] of requestFailures) {
  test(`F4: ${label} shows a specific message without provider details or account hints`, async () => {
    const page = mountForgot(async () => ({ error: providerError(fields) }));
    page.type("someone@example.test");
    await page.submit();
    const message = page.error();
    assert.match(message, expected);
    assert.doesNotMatch(message, /\d/, "no invented waiting period");
    assert.doesNotMatch(message, /not authorized|rate limit exceeded|Error sending|Failed to fetch/i, "no provider wording");
    assert.doesNotMatch(message, /someone@example|registered|no account|does not exist/i, "no account disclosure");
    assert.doesNotMatch(page.text(), NEUTRAL);
  });
}

test("F4: a request that throws before reaching the service keeps the connection message; validation is unchanged", async () => {
  const thrown = mountForgot(async () => { throw new TypeError("offline"); });
  thrown.type("someone@example.test"); await thrown.submit();
  assert.match(thrown.error(), /couldn't reach the password recovery service/);
  const invalid = mountForgot(async () => ({ error: null }));
  invalid.type("not-an-email"); await invalid.submit();
  assert.equal(invalid.error(), "Please enter a valid email address.");
  assert.equal(invalid.calls.length, 0);
});

// ---------- F5: saving the new password ----------

const STRONG = "Str0ng-Passw0rd!";

function mountReset(updateResult: () => Promise<{ error: unknown }>, signOutResult: { error: unknown } = { error: null }) {
  const calls: string[] = [];
  const navigations: unknown[] = [];
  const service = loadAuthService({
    updateUser: async (attrs: { password?: string }) => { calls.push(attrs.password ? "updateUser(password)" : "updateUser"); return updateResult(); },
    signOut: async () => { calls.push("signOut"); return signOutResult; },
  });
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module1/pages/ResetPasswordPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a", useNavigate: () => (...args: unknown[]) => navigations.push(args) };
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: "u1" }, loading: false, authEvent: "PASSWORD_RECOVERY" }) };
    if (id.endsWith("/services/authService")) return service;
    if (id.endsWith("/utils/authOnboarding")) return real("modules/module1/utils/authOnboarding.ts");
    if (id.endsWith("/utils/passwordRecoveryMessages")) return real("modules/module1/utils/passwordRecoveryMessages.ts");
    if (id.includes("/components/")) return { default: () => null };
    return require(id);
  }, { window: { location: { search: "", hash: "" } }, Error, URLSearchParams });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  const field = (id: string) => findAll(render(), (n) => n.props?.id === id)[0];
  return {
    calls, navigations, render,
    save: async (password = STRONG, confirm = password) => {
      field("newPassword").props.onChange({ target: { value: password } });
      field("confirmNewPassword").props.onChange({ target: { value: confirm } });
      findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
      await settle();
    },
    error: () => findAll(render(), (n) => n.props && "message" in n.props)[0]?.props.message ?? "",
    offersNewLink: () => findAll(render(), (n) => n.type === "a" && n.props?.to === "/forgot-password").length > 0,
  };
}

test("F5: a successful update signs out and shows the login-page success notice", async () => {
  const page = mountReset(async () => ({ error: null }));
  await page.save();
  assert.deepEqual(page.calls, ["updateUser(password)", "signOut"]);
  assert.equal(JSON.stringify(page.navigations), JSON.stringify([["/login", { replace: true, state: { passwordReset: true } }]]));
  assert.equal(page.error(), "");
  const login = readFileSync(new URL("../src/modules/module1/pages/LoginPage.tsx", import.meta.url), "utf8");
  assert.match(login, /state\?\.passwordReset/);
  assert.match(login, /Your password was changed successfully\. Log in with your new password\./);
});

const updateFailures: [string, Record<string, unknown>, RegExp, boolean][] = [
  ["weak password", { name: "AuthWeakPasswordError", status: 422, code: "weak_password", reasons: ["length"] }, /doesn't meet the security requirements/, false],
  ["password rule (same as current)", { name: "AuthApiError", status: 422, code: "same_password" }, /must be different from your current password/, false],
  ["reauthentication_needed", { name: "AuthApiError", status: 400, code: "reauthentication_needed" }, /needs extra confirmation.*start again from Forgot Password/, false],
  ["reauthentication_not_valid", { name: "AuthApiError", status: 400, code: "reauthentication_not_valid" }, /needs extra confirmation.*start again from Forgot Password/, false],
  ["expired session (missing)", { name: "AuthSessionMissingError", status: 400 }, /reset link has expired.*Request a new reset link/, true],
  ["expired session (not found)", { name: "AuthApiError", status: 403, code: "session_not_found" }, /reset link has expired/, true],
  ["expired session (401)", { name: "AuthApiError", status: 401, code: "bad_jwt" }, /reset link has expired/, true],
  ["rate limited", { name: "AuthApiError", status: 429, code: "over_request_rate_limit" }, /Too many attempts\. Please wait a while/, false],
  ["temporary service failure", { name: "AuthApiError", status: 500, code: "unexpected_failure" }, /couldn't update your password right now/, false],
  ["network failure", { name: "AuthRetryableFetchError", status: 0 }, /couldn't reach the password service/, false],
];

for (const [label, fields, expected, expired] of updateFailures) {
  test(`F5: ${label} gets the right message and keeps the user on the form`, async () => {
    const page = mountReset(async () => ({ error: providerError(fields) }));
    await page.save();
    assert.match(page.error(), expected);
    assert.match(page.error(), /Your password was not changed\./);
    assert.equal(/expired/.test(page.error()), expired, "only an ended session is called an expired link");
    assert.equal(page.offersNewLink(), expired);
    assert.deepEqual(page.calls, ["updateUser(password)"], "no sign-out after a failure");
    assert.equal(page.navigations.length, 0);
    assert.doesNotMatch(page.error(), /\d/);
  });
}

test("F5: an update that throws is reported as a connection problem, not an expired link", async () => {
  const page = mountReset(async () => { throw new TypeError("network down"); });
  await page.save();
  assert.match(page.error(), /couldn't reach the password service/);
  assert.equal(page.offersNewLink(), false);
});

test("F5: client-side checks still run before anything is sent", async () => {
  const mismatch = mountReset(async () => ({ error: null }));
  await mismatch.save(STRONG, `${STRONG}x`);
  assert.equal(mismatch.error(), "Passwords do not match.");
  const weak = mountReset(async () => ({ error: null }));
  await weak.save("short");
  assert.notEqual(weak.error(), "");
  assert.deepEqual([...mismatch.calls, ...weak.calls], []);
});

test("F5: Settings keeps its existing password-change messages word for word", () => {
  const { passwordChangeError } = loadAuthService({});
  const cases: [Record<string, unknown>, string][] = [
    [{ code: "same_password", status: 422 }, "Your new password must be different from your current password. Your password was not changed."],
    [{ code: "weak_password", status: 422 }, "Choose a stronger password. Your password was not changed."],
    [{ code: "reauthentication_needed", status: 400 }, "For your security, sign out and sign in again, then change your password. Your password was not changed."],
    [{ code: "over_request_rate_limit", status: 429 }, "Too many attempts. Please wait a few minutes before changing your password again."],
    [{ code: "session_not_found", status: 403 }, "Your session has ended. Sign in again to change your password."],
    [{ status: 500 }, "We couldn't change your password right now. Please try again. Your password was not changed."],
  ];
  for (const [fields, message] of cases) assert.equal(passwordChangeError({ message: "x", ...fields }).message, message);
});

// ---------- F6: M8 daily-login reward ----------
// Each simulated browser tab gets its own sessionStorage. Module memory ("pending") belongs to a
// single page load; tests resolve it before simulating another tab or a reload.

function fakeStore() {
  const data = new Map<string, string>();
  const writes: [string, string][] = [];
  return {
    data, writes,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push([k, v]); data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

function useTab(store = fakeStore()) {
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: store });
  return store;
}

function useBlockedStorage() {
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("blocked"); } });
}

function mountProvider(options: {
  pathname: string; user: { id: string } | null; getUserError?: unknown; role?: string;
  initialize?: () => Promise<{ error: unknown }>;
}) {
  let emit: (event: string, session: unknown) => void = () => {};
  const posts: string[] = [];
  const location = { pathname: options.pathname };
  const runtime = createHookRuntime(require("react"));
  const listeners = new Set<() => void>();
  const document = {
    visibilityState: "visible",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const module = loadComponentModule(new URL("../src/auth/AuthProvider.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/lib/supabaseClient")) {
      return { supabase: { auth: {
        onAuthStateChange: (callback: typeof emit) => { emit = callback; return { data: { subscription: { unsubscribe() {} } } }; },
        getUser: async () => ({ data: { user: options.user }, error: options.getUserError ?? null }),
        initialize: options.initialize ?? (async () => ({ error: null })),
      } } };
    }
    if (id.endsWith("/authProfile")) return { getAuthProfile: async (userId: string) => ({ id: userId, role: options.role ?? "student", nickname: "S", full_name: "Student" }) };
    if (id.endsWith("/services/api")) return { default: { post: async (path: string) => { posts.push(path); return {}; } } };
    if (id.endsWith("/authHeaders")) return { getSessionAuthHeaders: async () => ({}) };
    if (id.endsWith("/dailyLoginClaim")) return dailyLogin;
    if (id.endsWith("/recoverySession")) return recovery;
    return require(id);
  }, { window: { setTimeout, location }, document });
  const render = () => runtime.render(module.AuthProvider, { children: null }).props.value;
  const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 5)); await tick(); render(); await tick(); render(); } };
  return {
    posts, location, render, settle,
    emit: async (event: string, session: unknown) => { emit(event, session); await settle(); },
    tabReturn: async () => { listeners.forEach((fn) => fn()); await settle(); },
  };
}

const student = { id: "student-1" };
const other = { id: "student-2" };
const CLAIM = "/api/m8/daily-login";
const invalidLink = async () => ({ error: providerError({ name: "AuthApiError", status: 403, code: "bad_jwt" }) });

/** Opens a valid reset link in the current tab and lets Supabase accept it. */
async function openValidLink(landing = "/") {
  captureAuthRedirect(fakeWindow(`${landing}${RECOVERY}`).win);
  assert.equal(recovery.getPasswordRecoveryState(), "pending");
  const app = mountProvider({ pathname: "/reset-password", user: student });
  await app.emit("INITIAL_SESSION", { user: student });
  await app.emit("PASSWORD_RECOVERY", { user: student });
  assert.equal(recovery.getPasswordRecoveryState(), "active");
  return app;
}

test.afterEach(() => { useTab(); recovery.clearPasswordRecovery(); });

test("F6: a normal login earns the daily-login claim once", async () => {
  useTab();
  const app = mountProvider({ pathname: "/login", user: null });
  await app.settle();
  app.location.pathname = "/dashboard";
  await app.emit("SIGNED_IN", { user: student });
  assert.deepEqual(app.posts, [CLAIM]);
});

test("F6: teachers and admins still never claim (unchanged M8 rule)", async () => {
  useTab();
  const app = mountProvider({ pathname: "/dashboard", user: null, role: "teacher" });
  await app.settle();
  await app.emit("SIGNED_IN", { user: { id: "teacher-1" } });
  assert.deepEqual(app.posts, []);
});

test("F6: valid recovery completed: no claim during it, normal claim at the next login", async () => {
  const tab = useTab();
  const app = await openValidLink();
  await app.tabReturn();
  await app.emit("USER_UPDATED", { user: student }); // updateUser({ password })
  await app.emit("SIGNED_OUT", null); // logout() after the reset
  assert.deepEqual(app.posts, []);
  assert.equal(recovery.getPasswordRecoveryState(), null);
  assert.equal(tab.data.size, 0);
  app.location.pathname = "/dashboard";
  await app.emit("SIGNED_IN", { user: student });
  assert.deepEqual(app.posts, [CLAIM]);
});

test("F6: the profile loading before Supabase confirms the link still claims nothing", async () => {
  useTab();
  captureAuthRedirect(fakeWindow(`/reset-password${RECOVERY}`).win);
  let accept!: (value: { error: null }) => void;
  const app = mountProvider({ pathname: "/reset-password", user: student, initialize: () => new Promise((r) => { accept = r; }) });
  await app.settle();
  assert.equal(app.render().profile?.id, "student-1");
  assert.deepEqual(app.posts, [], "pending: nothing is claimed before Supabase answers");
  app.location.pathname = "/dashboard";
  accept({ error: null });
  await app.settle();
  await app.tabReturn();
  assert.equal(recovery.getPasswordRecoveryState(), "active");
  assert.deepEqual(app.posts, []);
});

test("F6: an abandoned recovery only affects its own tab; a new tab claims normally", async () => {
  useTab();
  const app = await openValidLink();
  app.location.pathname = "/dashboard"; // the user wanders off without resetting or signing out
  await app.tabReturn();
  assert.deepEqual(app.posts, [], "the tab that opened the link is still a recovery visit");

  useTab(); // a later visit in a new tab (the old tab's sessionStorage is gone), still signed in
  const later = mountProvider({ pathname: "/dashboard", user: student });
  await later.settle();
  assert.equal(recovery.getPasswordRecoveryState(), null);
  assert.deepEqual(later.posts, [CLAIM], "valid rewards are not suppressed after the recovery tab");
});

test("F6: a valid link opened while already signed in: no claim in that tab, other tabs unaffected", async () => {
  const otherTab = fakeStore();
  useTab();
  await openValidLink();
  useTab(otherTab); // an already-open tab receives Supabase's cross-tab copy of the event
  const tab2 = mountProvider({ pathname: "/dashboard", user: student });
  await tab2.settle();
  await tab2.emit("PASSWORD_RECOVERY", { user: student });
  assert.equal(otherTab.data.size, 0, "the broadcast does not mark another tab");
  assert.deepEqual(tab2.posts, [CLAIM], "that tab's own genuine use still counts (one claim per day)");
});

test("F6: an invalid link while signed in keeps the genuine session and its normal claim", async () => {
  useTab();
  captureAuthRedirect(fakeWindow(`/#access_token=not-a-real-token&type=recovery`).win);
  let answer!: (value: { error: unknown }) => void;
  const app = mountProvider({ pathname: "/reset-password", user: student, initialize: () => new Promise((r) => { answer = r; }) });
  await app.settle();
  assert.deepEqual(app.posts, [], "nothing until Supabase answers");
  app.location.pathname = "/dashboard";
  answer(await invalidLink()); // Supabase keeps the existing session on a failed link
  await app.settle();
  assert.equal(recovery.getPasswordRecoveryState(), null);
  assert.deepEqual(app.posts, [CLAIM]);
});

test("F6: an invalid or expired link with no session claims nothing and leaves no flag", async () => {
  useTab();
  captureAuthRedirect(fakeWindow(`/#access_token=not-a-real-token&type=recovery`).win);
  const invalid = mountProvider({ pathname: "/reset-password", user: null, getUserError: { name: "AuthSessionMissingError", status: 400 }, initialize: invalidLink });
  await invalid.settle();
  assert.deepEqual(invalid.posts, []);
  assert.equal(recovery.getPasswordRecoveryState(), null);

  captureAuthRedirect(fakeWindow(`/reset-password${EXPIRED}`).win);
  const expired = mountProvider({ pathname: "/reset-password", user: null, getUserError: { name: "AuthSessionMissingError", status: 400 } });
  await expired.settle();
  assert.deepEqual(expired.posts, []);
  assert.equal(recovery.getPasswordRecoveryState(), null);
});

test("F6: sign-in or sign-out in another tab", async () => {
  useTab();
  const app = await openValidLink();
  await app.emit("SIGNED_IN", { user: student }); // same user signed in elsewhere (or a tab return)
  assert.equal(recovery.getPasswordRecoveryState(), "active", "that other tab claims; this one stays a recovery visit");
  app.location.pathname = "/dashboard"; // (on the reset page itself nothing is ever claimed)
  await app.emit("SIGNED_IN", { user: other }); // a different user signed in elsewhere
  assert.equal(recovery.getPasswordRecoveryState(), null);
  assert.deepEqual(app.posts, [CLAIM], "the new user's genuine sign-in follows the normal rule");

  useTab();
  const signOut = await openValidLink();
  await signOut.emit("SIGNED_OUT", null); // signed out in another tab
  assert.equal(recovery.getPasswordRecoveryState(), null);
  assert.deepEqual(signOut.posts, []);
});

test("F6: refreshing during recovery claims nothing", async () => {
  const tab = useTab();
  await openValidLink();
  // Reload of the same tab: sessionStorage survives; the session is restored from storage.
  const refreshed = mountProvider({ pathname: "/reset-password", user: student });
  await refreshed.settle();
  refreshed.location.pathname = "/dashboard";
  await refreshed.tabReturn();
  assert.deepEqual(refreshed.posts, []);
  assert.equal(tab.data.get("basa.auth.passwordRecovery"), "active");

  // A reload before Supabase confirmed the link loses "pending"; the reset page alone still blocks it.
  recovery.clearPasswordRecovery();
  const early = mountProvider({ pathname: "/reset-password", user: student });
  await early.settle();
  await early.tabReturn();
  assert.deepEqual(early.posts, []);
});

test("F6: storage unavailable or cleared", async () => {
  useBlockedStorage();
  const blocked = await openValidLink(); // falls back to memory for this page
  blocked.location.pathname = "/dashboard";
  await blocked.tabReturn();
  assert.deepEqual(blocked.posts, []);

  recovery.clearPasswordRecovery();
  useTab(); // storage cleared mid-recovery: the reset page still blocks
  const cleared = mountProvider({ pathname: "/reset-password", user: student });
  await cleared.settle();
  assert.deepEqual(cleared.posts, []);
});

test("F6: a genuine login after an abandoned recovery follows the normal rule", async () => {
  useTab();
  const app = await openValidLink();
  app.location.pathname = "/login";
  const service = loadAuthService({ signInWithPassword: async () => ({ data: { session: { user: student }, user: student }, error: null }) });
  await service.login("student@example.test", "whatever");
  await app.emit("SIGNED_IN", { user: student });
  app.location.pathname = "/dashboard";
  await app.settle();
  assert.equal(recovery.getPasswordRecoveryState(), null);
  assert.deepEqual(app.posts, [CLAIM]);

  // A failed password attempt does not end the recovery visit.
  useTab();
  await openValidLink();
  await loadAuthService({ signInWithPassword: async () => ({ data: { session: null, user: null }, error: providerError({ status: 400, code: "invalid_credentials" }) }) })
    .login("student@example.test", "wrong");
  assert.equal(recovery.getPasswordRecoveryState(), "active");

  // A sign-up confirmation link opened in the same tab replaces the session and ends it.
  captureAuthRedirect(fakeWindow("/#access_token=x&type=signup").win);
  assert.equal(recovery.getPasswordRecoveryState(), null);
});

test("F6: event ordering never produces a duplicate claim", async () => {
  useTab();
  const app = mountProvider({ pathname: "/dashboard", user: student });
  await app.emit("INITIAL_SESSION", { user: student });
  await app.emit("SIGNED_IN", { user: student });
  await app.emit("TOKEN_REFRESHED", { user: student });
  await app.emit("SIGNED_IN", { user: student });
  await app.tabReturn();
  await app.tabReturn();
  assert.deepEqual(app.posts, [CLAIM], "one claim per user per day from this tab");
});

test("F6: only a state word is stored, in this tab's sessionStorage, never a token", async () => {
  const tab = useTab();
  const shared = fakeStore();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: shared });
  try {
    await openValidLink();
    assert.deepEqual(tab.writes, [["basa.auth.passwordRecovery", "active"]]);
    assert.equal(shared.writes.length, 0, "nothing in localStorage (shared by all tabs)");
    assert.doesNotMatch(JSON.stringify([...tab.data]), /SYNTHETIC|token/i);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
