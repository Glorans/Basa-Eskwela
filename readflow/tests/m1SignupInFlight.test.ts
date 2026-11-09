import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// Sign-up sends one request per attempt, even when submits arrive before React re-renders,
// and a failed attempt can be retried.

const require = createRequire(import.meta.url);
const pageUrl = new URL("../src/modules/module1/pages/SignupPage.tsx", import.meta.url);

function mount(register: () => Promise<unknown>) {
  const runtime = createHookRuntime(require("react"));
  const calls: string[] = [];
  const navigations: string[] = [];
  class AuthServiceError extends Error { kind?: string; constructor(message: string, kind?: string) { super(message); this.kind = kind; } }
  const page = loadComponentModule(pageUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a", useNavigate: () => (to: string) => navigations.push(to) };
    if (id.endsWith("/authService.ts")) return { AuthServiceError, register: async () => { calls.push("register"); return register(); } };
    if (id.endsWith("/authOnboarding.ts")) return require(fileURLToPath(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url)));
    if (id.endsWith(".tsx")) return { default: function Stub(props: any) { return { type: "stub", props }; } };
    return require(id);
  }, { Error });
  const render = () => runtime.render(page.default, {});
  const field = (id: string) => findAll(render(), (n) => n.props?.id === id)[0];
  const fill = () => {
    field("email").props.onChange({ target: { value: "new.learner@example.test" } });
    field("password").props.onChange({ target: { value: "Str0ng-Passw0rd!" } });
    field("confirmPassword").props.onChange({ target: { value: "Str0ng-Passw0rd!" } });
    render();
  };
  const submit = () => findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  return { render, fill, submit, calls, navigations, text: () => textOf(render()) };
}

test("submits arriving before the page re-renders send a single sign-up request", async () => {
  let finish: (value: unknown) => void = () => {};
  const m = mount(() => new Promise((resolve) => { finish = resolve; }));
  m.fill();
  const form = findAll(m.render(), (n) => n.type === "form")[0];
  // Same render, so `submitting` is still false for all three.
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(m.calls, ["register"]);
  finish({ hasSession: true, confirmationSent: false });
  await tick(); await tick();
  assert.deepEqual(m.navigations, ["/select-role"]);
});

test("after a failed attempt the user can retry", async () => {
  let attempt = 0;
  const m = mount(async () => {
    attempt++;
    if (attempt === 1) throw new Error("network down");
    return { hasSession: true, confirmationSent: false };
  });
  m.fill();
  m.submit();
  await tick(); await tick();
  const shownError = findAll(m.render(), (n) => typeof n.props?.message === "string" && n.props.message)[0];
  assert.match(shownError.props.message, /couldn't finish account setup/);
  m.submit();
  await tick(); await tick();
  assert.deepEqual(m.calls, ["register", "register"]);
  assert.deepEqual(m.navigations, ["/select-role"]);
});
