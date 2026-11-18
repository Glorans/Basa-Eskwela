import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const real = (path: string) => require(fileURLToPath(new URL(`../src/${path}`, import.meta.url)));
const hint = () => real("modules/module1/services/accountInvitationHint.ts");
const STRONG = "Str0ng-Passw0rd!";
const INVITED = { id: "u1", app_metadata: { provider: "email", school_admin_invitation: true } };
const ORDINARY = { id: "u1", app_metadata: { provider: "email" } };
const hang = () => new Promise<never>(() => {});

test("the invitation marker is only the server-set app_metadata flag (user_metadata or other values do not count)", () => {
  const { isInvitedSchoolAdmin } = hint();
  assert.equal(isInvitedSchoolAdmin(INVITED), true);
  for (const u of [ORDINARY, null, undefined, { app_metadata: { school_admin_invitation: "true" } }, { user_metadata: { school_admin_invitation: true } }]) {
    assert.equal(isInvitedSchoolAdmin(u as never), false, JSON.stringify(u));
  }
});

// ---------- Reset Password ----------
function mountReset(user: object, acceptResult: () => Promise<unknown>) {
  const calls: string[] = [];
  const navigations: unknown[] = [];
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module1/pages/ResetPasswordPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a", useNavigate: () => (...args: unknown[]) => navigations.push(args) };
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user, loading: false, authEvent: "PASSWORD_RECOVERY" }) };
    if (id.endsWith("/services/authService")) return { updatePassword: async () => { calls.push("updatePassword"); }, logout: async () => { calls.push("logout"); } };
    if (id.endsWith("/services/accountInvitation")) return {
      isInvitedSchoolAdmin: hint().isInvitedSchoolAdmin,
      getOwnSchoolAdminInvitation: async () => { calls.push("state"); return "pending"; },
      acceptSchoolAdminInvitation: async () => { calls.push("accept"); return acceptResult(); },
    };
    if (id.endsWith("/utils/authOnboarding")) return real("modules/module1/utils/authOnboarding.ts");
    if (id.endsWith("/utils/passwordRecoveryMessages")) return real("modules/module1/utils/passwordRecoveryMessages.ts");
    if (id.includes("/components/")) return { default: () => null };
    return require(id);
  }, { window: { location: { search: "", hash: "" } }, Error, URLSearchParams });
  const render = () => runtime.render(page.default, {});
  const field = (id: string) => findAll(render(), (n) => n.props?.id === id)[0];
  return {
    calls, navigations,
    save: async () => {
      field("newPassword").props.onChange({ target: { value: STRONG } });
      field("confirmNewPassword").props.onChange({ target: { value: STRONG } });
      findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
      for (let i = 0; i < 8; i++) { await tick(); render(); }
    },
  };
}

test("reset page: ordinary password recovery makes NO invitation request and is unchanged", async () => {
  const page = mountReset(ORDINARY, async () => { throw new Error("must not be called"); });
  await page.save();
  assert.deepEqual(page.calls, ["updatePassword", "logout"]);
  assert.equal(JSON.stringify(page.navigations), JSON.stringify([["/login", { replace: true, state: { passwordReset: true } }]]));
});

test("reset page: an invited account accepts in the link session, after the password and before sign-out", async () => {
  const page = mountReset(INVITED, async () => ({ role: "admin" }));
  await page.save();
  assert.deepEqual(page.calls, ["updatePassword", "accept", "logout"], "no separate status lookup");
  assert.match(JSON.stringify(page.navigations), /invitation was accepted/);
});

test("reset page: refused, timed-out or unreachable acceptance grants nothing and never blocks the password reset", async () => {
  const refused = mountReset(INVITED, async () => { throw { response: { data: { message: "This invitation has expired. Ask your System Admin to resend it." } } }; });
  await refused.save();
  assert.deepEqual(refused.calls, ["updatePassword", "accept", "logout"]);
  assert.match(JSON.stringify(refused.navigations), /was not accepted\. This invitation has expired/);
  const timedOut = mountReset(INVITED, async () => { throw Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" }); });
  await timedOut.save();
  assert.deepEqual(timedOut.calls, ["updatePassword", "accept", "logout"]);
  assert.match(JSON.stringify(timedOut.navigations), /couldn't reach the server.*Forgot password while the invitation is open/);
  assert.doesNotMatch(JSON.stringify(timedOut.navigations), /was accepted/);
});

// ---------- Role Selection ----------
function mountRoleSelection(user: object, invitation: () => Promise<string>, assign: () => Promise<void> = async () => {}) {
  const calls: string[] = [];
  let assigned: string | null = null; // the database role after a successful assignment
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module1/pages/RoleSelectionPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { useNavigate: () => () => {} };
    if (id === "lucide-react") return new Proxy({}, { get: (_t, k) => String(k) });
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user, profile: { id: "u1", role: null }, loading: false, profileError: false, refreshProfile: async () => ({ id: "u1", role: assigned }) }) };
    if (id.endsWith("/services/authProfile")) return {
      getPostAuthenticationPath: async () => "/select-role",
      assignOwnRoleOnce: async () => { calls.push("assign"); await assign(); assigned = "student"; },
    };
    if (id.endsWith("/services/accountInvitation")) return {
      isInvitedSchoolAdmin: hint().isInvitedSchoolAdmin,
      getOwnSchoolAdminInvitation: async () => { calls.push("state"); return invitation(); },
    };
    if (id.endsWith(".css")) return {};
    if (id.includes("/components/")) return { default: "Stub" };
    return require(id);
  });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  const form = () => findAll(render(), (n) => n.type === "form")[0];
  const chooseStudentAndSubmit = async () => {
    findAll(render(), (n) => n.props?.id === "role-student")[0].props.onSelect("student");
    await settle();
    form().props.onSubmit({ preventDefault() {} });
    await settle();
  };
  const error = () => findAll(render(), (n) => n.props && typeof n.props.message === "string")[0]?.props.message ?? "";
  return { calls, render, settle, form, chooseStudentAndSubmit, error, text: () => textOf(render()) };
}

test("role selection: ordinary Student/Teacher/Independent Learner signup shows the choices at once with NO backend request (even if the backend hangs)", async () => {
  const m = mountRoleSelection(ORDINARY, hang);
  await m.settle();
  assert.deepEqual(m.calls, [], "no invitation request for ordinary accounts");
  assert.ok(m.form(), "role choices rendered");
  for (const role of ["student", "teacher", "general_user"]) assert.ok(findAll(m.render(), (n) => n.props?.id === `role-${role}`).length, role);
  assert.doesNotMatch(m.text(), /School Admin invitation/);
  await m.chooseStudentAndSubmit();
  assert.deepEqual(m.calls, ["assign"], "ordinary role selection goes straight to the existing role assignment");
});

test("role selection: an invited account sees the invitation guidance immediately, without waiting for the backend", async () => {
  const m = mountRoleSelection(INVITED, hang);
  await m.settle();
  assert.deepEqual(m.calls, []);
  assert.match(m.text(), /School Admin invitation/);
  assert.match(m.text(), /Email links can expire sooner than the invitation itself/);
  assert.equal(m.form(), undefined, "no role choices for an invited account");
});

test("role selection: Check invitation status is bounded; slow, failed or timed-out checks change nothing", async () => {
  const slow = mountRoleSelection(INVITED, hang);
  await slow.settle();
  const button = (m: ReturnType<typeof mountRoleSelection>) => findAll(m.render(), (n) => n.type === "button")[0];
  button(slow).props.onClick(); await slow.settle();
  assert.equal(textOf(button(slow)), "Checking…"); assert.equal(button(slow).props.disabled, true);
  assert.equal(slow.form(), undefined, "still no role choices while checking");
  const failing = mountRoleSelection(INVITED, async () => { throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); });
  await failing.settle();
  button(failing).props.onClick(); await failing.settle();
  assert.match(failing.text(), /couldn't check your invitation right now\. Nothing has changed/);
  assert.equal(failing.form(), undefined, "a failed check never unlocks role choices");
  assert.equal(button(failing).props.disabled, false, "retry stays available");
  const expired = mountRoleSelection(INVITED, async () => "expired");
  await expired.settle();
  button(expired).props.onClick(); await expired.settle();
  assert.match(expired.text(), /no longer open\. Ask your System Admin to resend it/);
});

test("role selection: an unmarked account whose role is refused asks once; only a positive answer shows the invitation", async () => {
  const refused = async () => { throw new Error("School Admin access is granted only by accepting a School Admin invitation"); };
  const invited = mountRoleSelection(ORDINARY, async () => "pending", refused);
  await invited.settle();
  await invited.chooseStudentAndSubmit();
  assert.deepEqual(invited.calls, ["assign", "state"]);
  assert.match(invited.text(), /School Admin invitation/);
  const unknown = mountRoleSelection(ORDINARY, async () => { throw new Error("offline"); }, refused);
  await unknown.settle();
  await unknown.chooseStudentAndSubmit();
  assert.ok(unknown.form(), "a failed lookup keeps the ordinary form and retry");
  assert.match(unknown.error(), /couldn't save your role/i);
  assert.doesNotMatch(unknown.text(), /School Admin invitation/);
  const typo = mountRoleSelection(ORDINARY, hang, async () => { throw new Error("Invalid Teacher invite code."); });
  await typo.settle();
  await typo.chooseStudentAndSubmit();
  assert.deepEqual(typo.calls, ["assign"], "other failures (e.g. an invalid Teacher code) make no backend request, even if it would hang");
  assert.match(typo.error(), /Invalid Teacher invite code|couldn't save your role/i, "the ordinary error shows at once (wording depends on the test realm)");
});

// ---------- System Admin panel ----------
const recorded = (state: string, id: string) => ({
  id, state, authorizedByName: "Sys Admin", authorizedAt: "2026-11-18T00:00:00Z", reference: "Request letter dated 2026-11-18",
  confirmationMethod: "official_school_phone", confirmationLabel: "Call to the school's official phone number", authorizingPosition: "School Principal",
  note: null, lastSentAt: "2026-11-18T00:00:00Z", sendCount: 1, expiresAt: "2026-11-25T00:00:00Z", acceptedAt: null, cancelledAt: null,
});
const user = (n: number, role: string | null, authorization: unknown) => ({
  id: `u${n}`, email: `p${n}@example.test`, fullName: `Person ${n}`, nickname: "", role, status: "active", createdAt: "2026-11-18T00:00:00Z", schoolAdminAuthorization: authorization,
});

function mountPanel(users: object[]) {
  const runtime = createHookRuntime(require("react"));
  const calls: string[][] = [];
  const mod = loadComponentModule(new URL("../src/modules/module1/pages/admin/SchoolAdminInvitationsPanel.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/components/ReadFlowDialog")) return { confirmReadFlow: async (message: string) => { calls.push(["confirm", message]); return true; } };
    if (id.endsWith("/services/adminUsers")) return {
      resendSchoolAdminInvitation: async (inv: string) => { calls.push(["resend", inv]); return { message: "A new setup link was sent." }; },
      cancelSchoolAdminInvitation: async (inv: string, reason: string) => { calls.push(["cancel", inv, reason]); return { message: "Invitation cancelled." }; },
      getAdminUserError: (e: Error) => e.message,
    };
    return require(id);
  });
  const render = () => runtime.render(mod.default, { users, onChanged: () => calls.push(["reload"]) });
  return { mod, render, calls, settle: async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } } };
}

test("invitations panel: open invitations only; cancelled cannot be reused; resend and cancel go through confirmation", async () => {
  const users = [user(1, null, recorded("pending", "i1")), user(2, null, recorded("expired", "i2")), user(3, null, recorded("cancelled", "i3")),
    user(4, "admin", recorded("accepted", "i4")), user(5, "admin", { state: "unavailable" }), user(6, "teacher", null)];
  const m = mountPanel(users);
  const rows = () => findAll(m.render(), (n) => n.type === "tr").slice(1);
  assert.equal(rows().length, 3, "pending, expired and cancelled; accepted and legacy admins are in the School Admins table");
  assert.match(textOf(rows()[0]), /Invitation pending/);
  assert.match(textOf(rows()[1]), /Invitation no longer open/);
  assert.match(textOf(rows()[1]), /Closed /);
  assert.match(textOf(rows()[2]), /Cannot be reused/);
  assert.equal(findAll(rows()[2], (n) => n.type === "button").length, 0);
  assert.match(textOf(m.render()), /Invite authorized School Admins and manage pending invitations\./);
  findAll(rows()[0], (n) => n.type === "button" && textOf(n) === "Resend invitation")[0].props.onClick();
  await m.settle();
  findAll(rows()[1], (n) => n.type === "button" && textOf(n) === "Cancel invitation")[0].props.onClick();
  await m.settle();
  assert.deepEqual(m.calls.filter((c) => c[0] !== "confirm"), [["resend", "i1"], ["reload"], ["cancel", "i2", "Cancelled by System Admin"], ["reload"]]);
  assert.ok(m.calls.some((c) => c[0] === "confirm" && /can never be used again/.test(c[1])));
});

test("expiry wording: plain 7-day help text, no provider names, no fixed link duration is promised", async () => {
  const m = mountPanel([user(1, null, recorded("pending", "i1"))]);
  const text = textOf(m.render());
  assert.match(text, /Invitation open until/);
  assert.doesNotMatch(text, /\bExpires\b/);
  assert.match(text, /Invitations are valid for 7 days\. If an email link expires, send a new invitation link\./);
  assert.doesNotMatch(text, /Supabase|SMTP|GoTrue/, "no technical provider names in user-facing text");
  assert.doesNotMatch(text, /\b(1|one) hour\b|60 minutes/i, "the local link setting is not presented as universal");
  const row = findAll(m.render(), (n) => n.type === "tr").slice(1)[0];
  findAll(row, (n) => n.type === "button" && textOf(n) === "Resend invitation")[0].props.onClick();
  await m.settle();
  const confirm = m.calls.find((c) => c[0] === "confirm");
  assert.ok(confirm && !/Supabase|SMTP|GoTrue/.test(String(confirm[1])), "resend confirmation has no provider names");
});

test("empty state: no open invitations shows 'No pending invitations.'", () => {
  const m = mountPanel([user(4, "admin", recorded("accepted", "i4")), user(6, "teacher", null)]);
  assert.match(textOf(m.render()), /No pending invitations\./);
});

test("authorization note: the recorded decision, or 'unavailable' for accounts created before records; never 'verified'", () => {
  const { mod } = mountPanel([]);
  const note = (authorization: unknown) => textOf(mod.SchoolAdminAuthorizationNote({ authorization }));
  assert.match(note({ state: "unavailable" }), /Authorization record unavailable/);
  assert.match(note(recorded("accepted", "i4")), /Authorization recorded by Sys Admin on .* Call to the school's official phone number/);
  for (const authorization of [{ state: "unavailable" }, recorded("accepted", "i4")]) assert.doesNotMatch(note(authorization), /verified/i);
  assert.equal(mod.SchoolAdminAuthorizationNote({ authorization: null }), null);
});
