import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// Settings: read-only email, specific password feedback, and messages that survive the
// profile reload that follows every save (it used to clear errors before they showed).

const require = createRequire(import.meta.url);
const settingsUrl = new URL("../src/modules/module1/pages/Settings.tsx", import.meta.url);
const real = (rel: string) => require(fileURLToPath(new URL(`../src/modules/module1/${rel}`, import.meta.url)));

function loadAuthService(updateUserResult: { error: unknown }) {
  const source = readFileSync(new URL("../src/services/authService.ts", import.meta.url), "utf8");
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require: (id: string) => id.endsWith("/supabaseClient.ts")
      ? { supabase: { auth: { updateUser: async () => updateUserResult } } }
      : id.endsWith("/authOnboarding.ts") ? { normalizeAuthEmail: (e: string) => e.trim().toLowerCase() }
      : { clearAllModuleDrafts: () => {} },
  });
  return module.exports;
}

function mount(updatePassword: (pw: string) => Promise<void>) {
  const runtime = createHookRuntime(require("react"));
  const user = { id: "u1", email: "learner@example.test" };
  let profileVersion = 0;
  const profile = () => ({ id: "u1", role: "general_user", nickname: "Lito", full_name: "Lito Cruz", status: "active", v: profileVersion });
  let currentProfile = profile();
  const calls: string[] = [];
  const page = loadComponentModule(settingsUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "lucide-react") return { Eye: "svg", EyeOff: "svg", User: "svg" };
    if (id.endsWith("/auth/useAuth")) {
      return { useAuth: () => ({ user, profile: currentProfile, loading: false,
        // Like AuthProvider, a refresh hands back a new profile object.
        refreshProfile: async () => { profileVersion++; currentProfile = profile(); return currentProfile; } }) };
    }
    if (id.endsWith("/services/authProfile")) {
      return { updateFullName: async () => { calls.push("name"); }, updateNickname: async () => { calls.push("nickname"); } };
    }
    if (id.endsWith("/services/authService")) {
      return { updatePassword: async (pw: string) => { calls.push("password"); return updatePassword(pw); } };
    }
    if (id.endsWith("/utils/authOnboarding")) return real("utils/authOnboarding.ts");
    if (id.endsWith("/utils/profileFields")) return real("utils/profileFields.ts");
    if (id.endsWith(".css")) return {};
    return require(id);
  }, { Error }); // the page checks `instanceof Error` against errors thrown here
  const render = () => runtime.render(page.default, {});
  const byId = (id: string) => findAll(render(), (n) => n.props?.id === id)[0];
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  const submit = async () => {
    findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    await settle();
  };
  return { render, byId, settle, submit, calls, text: () => textOf(render()) };
}

const STRONG = "Str0ng-Passw0rd!";

test("the registered email is shown read-only and is never sent on save", async () => {
  const m = mount(async () => {});
  await m.settle();
  const email = m.byId("email");
  assert.equal(email.props.value, "learner@example.test");
  assert.equal(email.props.readOnly, true);
  assert.equal(email.props.onChange, undefined, "typing cannot change it");
  assert.doesNotMatch(m.text(), /can't be changed here/);
});

test("a rejected same-password change shows a clear message that is not wiped by the reload", async () => {
  const { passwordChangeError } = loadAuthService({ error: null });
  const m = mount(async () => { throw new Error(passwordChangeError({ message: "New password should be different from the old password.", code: "same_password", status: 422 }).message); }); // same realm as the page
  await m.settle();
  m.byId("password").props.onChange({ target: { value: STRONG } });
  m.byId("confirmPassword").props.onChange({ target: { value: STRONG } });
  await m.submit();
  await m.settle(); // the profile refresh re-runs the load effect
  assert.match(m.text(), /must be different from your current password\. Your password was not changed\./);
  assert.doesNotMatch(m.text(), /Profile changes saved|password was changed/i);
});

test("a successful password change says so specifically", async () => {
  const m = mount(async () => {});
  await m.settle();
  m.byId("password").props.onChange({ target: { value: STRONG } });
  m.byId("confirmPassword").props.onChange({ target: { value: STRONG } });
  await m.submit();
  assert.deepEqual(m.calls, ["password"]);
  assert.match(m.text(), /Your password was changed\./);
});

test("a saved name with a failed password change reports both truthfully", async () => {
  const { passwordChangeError } = loadAuthService({ error: null });
  const m = mount(async () => { throw new Error(passwordChangeError({ message: "x", code: "weak_password", status: 422 }).message); }); // same realm as the page
  await m.settle();
  m.byId("profileName").props.onChange({ target: { value: "Lito Bagong" } });
  m.byId("password").props.onChange({ target: { value: STRONG } });
  m.byId("confirmPassword").props.onChange({ target: { value: STRONG } });
  await m.submit();
  assert.match(m.text(), /Choose a stronger password\. Your password was not changed\. Your nickname was saved\./);
});

test("saving with nothing changed says so instead of claiming a save", async () => {
  const m = mount(async () => {});
  await m.settle();
  await m.submit();
  assert.deepEqual(m.calls, []);
  assert.match(m.text(), /There are no changes to save\./);
});

test("password errors are mapped only from what the provider reported", async () => {
  const { passwordChangeError } = loadAuthService({ error: null });
  const msg = (error: object) => passwordChangeError({ message: "raw", ...error }).message;
  assert.match(msg({ code: "same_password", status: 422 }), /must be different from your current password/);
  assert.match(msg({ code: "weak_password", status: 422 }), /stronger password/);
  assert.match(msg({ code: "over_request_rate_limit", status: 429 }), /Too many attempts/);
  assert.match(msg({ code: "unexpected_failure", status: 500 }), /couldn't change your password right now/);
  assert.doesNotMatch(msg({ code: "unexpected_failure", status: 500 }), /different from your current/, "never claims reuse unless reported");

  const ok = loadAuthService({ error: null });
  await ok.updatePassword(STRONG);
  const rejected = loadAuthService({ error: { message: "New password should be different from the old password.", code: "same_password", status: 422 } });
  await assert.rejects(rejected.updatePassword(STRONG), /must be different from your current password/);
});
