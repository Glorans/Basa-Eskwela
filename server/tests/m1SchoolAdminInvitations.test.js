// M1 F8 School Admin authorization record + invitation lifecycle: ordering, cleanup, acceptance checks, routes.
// Fakes only: no Supabase project, no real accounts or emails.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const svc = require("../services/schoolAdminInvitations");
const { createAdminUsersRouter } = require("../routes/adminUsers");
const { createAccountInvitationRouter } = require("../routes/accountInvitation");
const { AdminAuthorizationError } = require("../services/adminUserService");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SA = id(1), NEW = id(5), INV = id(9);
const AUTH = { reference: "Request letter dated 2026-11-18", confirmationMethod: "official_school_phone", authorizingPosition: "School Principal" };
const deps = (client) => ({ getSupabaseAdmin: () => client, passwordSetupRedirect: () => "https://basaeskwela.com/reset-password" });

function fake({ rpcErrors = {}, emailFails = false, banFails = false, existing = [], invitation = { id: INV, user_id: NEW, email: "new@x.test", status: "pending", expires_at: "2099-01-01T00:00:00Z" } } = {}) {
  const log = [];
  const client = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: existing.map((email) => ({ email })) }, error: null }),
        createUser: async (attrs) => { log.push(["createUser", attrs.email, attrs.email_confirm, attrs.app_metadata]); return { data: { user: { id: NEW } }, error: null }; },
        deleteUser: async (uid) => { log.push(["deleteUser", uid]); return { error: null }; },
        updateUserById: async (uid, attrs) => { log.push(["ban", attrs.ban_duration]); return { error: banFails && attrs.ban_duration !== "none" ? { message: "down" } : null }; },
      },
      resetPasswordForEmail: async (email, opts) => { log.push(["email", email, opts.redirectTo]); return { error: emailFails ? { message: "smtp" } : null }; },
    },
    rpc: async (name, args) => {
      log.push(["rpc", name, args.p_outcome ?? args.p_link_at ?? args.p_reason ?? null]);
      if (rpcErrors[name]) return { data: null, error: rpcErrors[name] };
      return { data: name === "m1_create_school_admin_invitation" ? INV : name === "m1_accept_school_admin_invitation" ? "admin" : "2099-01-01T00:00:00Z", error: null };
    },
    from: (table) => {
      log.push(["from", table]);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: invitation, error: null }) }) }), update: () => { throw new Error("no direct profile/role update allowed"); } };
    },
  };
  return { client, log };
}

test("create: validates the authorization record and requires the requesting System Admin", async () => {
  const { client, log } = fake();
  for (const authorization of [undefined, { ...AUTH, reference: "abc" }, { ...AUTH, confirmationMethod: "checkbox" }, { ...AUTH, authorizingPosition: "x" }, { ...AUTH, note: "n".repeat(501) }]) {
    await assert.rejects(svc.createSchoolAdmin({ email: "new@x.test", fullName: "Ana Reyes", authorization }, deps(client), { userId: SA }), (e) => e.statusCode === 400);
  }
  await assert.rejects(svc.createSchoolAdmin({ email: "new@x.test", fullName: "Ana Reyes", authorization: AUTH }, deps(client), {}), (e) => e.statusCode === 403);
  assert.deepEqual(log, [], "nothing created for invalid input");
});

test("create: unconfirmed Auth user, atomic authorization record, send recorded before the email; never sets a role", async () => {
  const { client, log } = fake();
  const account = await svc.createSchoolAdmin({ email: " New@X.test ", fullName: "  Ana   Reyes ", authorization: AUTH }, deps(client), { userId: SA });
  assert.deepEqual(account, { id: NEW, invitationId: INV, email: "new@x.test", fullName: "Ana Reyes", role: null, invitationStatus: "pending", setupEmailSent: true, expiresAt: "2099-01-01T00:00:00Z" });
  assert.deepEqual(log[0][3], { school_admin_invitation: true }, "display marker set with the service role (not used for access)");
  assert.deepEqual(log.map((l) => l.slice(0, 3)), [
    ["createUser", "new@x.test", false],
    ["rpc", "m1_create_school_admin_invitation", null],
    ["rpc", "m1_record_school_admin_invitation_email", "sent"],
    ["email", "new@x.test", "https://basaeskwela.com/reset-password"],
  ]);
});

test("create: failures never leave a usable account; the unused Auth user is removed; email failure keeps it pending", async () => {
  let f = fake({ existing: ["new@x.test"] });
  await assert.rejects(svc.createSchoolAdmin({ email: "new@x.test", fullName: "A B", authorization: AUTH }, deps(f.client), { userId: SA }), (e) => e.statusCode === 409);
  f = fake({ rpcErrors: { m1_create_school_admin_invitation: { code: "PGRST202", message: "Could not find the function" } } });
  await assert.rejects(svc.createSchoolAdmin({ email: "new@x.test", fullName: "A B", authorization: AUTH }, deps(f.client), { userId: SA }), (e) => e.statusCode === 503);
  assert.deepEqual(f.log.at(-1), ["deleteUser", NEW], "cleanup before the migration exists");
  f = fake({ rpcErrors: { m1_create_school_admin_invitation: { message: "m1_invite_actor_not_system_admin" } } });
  await assert.rejects(svc.createSchoolAdmin({ email: "new@x.test", fullName: "A B", authorization: AUTH }, deps(f.client), { userId: SA }), (e) => e.statusCode === 403);
  assert.ok(f.log.some((l) => l[0] === "deleteUser") && !f.log.some((l) => l[0] === "email"));
  f = fake({ emailFails: true });
  const account = await svc.createSchoolAdmin({ email: "new@x.test", fullName: "A B", authorization: AUTH }, deps(f.client), { userId: SA });
  assert.equal(account.setupEmailSent, false);
  assert.deepEqual(f.log.at(-1).slice(0, 3), ["rpc", "m1_record_school_admin_invitation_email", "failed"]);
  assert.ok(!f.log.some((l) => l[0] === "deleteUser"), "a pending invitation stays for Resend");
});

test("resend renews then sends; cancel bans first and undoes the ban if the database step fails", async () => {
  let f = fake();
  assert.equal((await svc.resendSchoolAdminInvitation(SA, INV, deps(f.client))).setupEmailSent, true);
  assert.deepEqual(f.log.filter((l) => l[0] !== "from").map((l) => l.slice(0, 3)), [["rpc", "m1_record_school_admin_invitation_email", "resent"], ["email", "new@x.test", "https://basaeskwela.com/reset-password"]]);
  f = fake({ invitation: { id: INV, user_id: NEW, email: "new@x.test", status: "accepted" } });
  await assert.rejects(svc.resendSchoolAdminInvitation(SA, INV, deps(f.client)), (e) => e.statusCode === 409);
  await assert.rejects(svc.cancelSchoolAdminInvitation(SA, INV, "x", deps(f.client)), (e) => e.statusCode === 409);
  f = fake();
  assert.equal((await svc.cancelSchoolAdminInvitation(SA, INV, "Wrong address", deps(f.client))).status, "cancelled");
  assert.deepEqual(f.log.filter((l) => l[0] !== "from").map((l) => l[0] + ":" + (l[1] ?? "")), ["ban:876000h", "rpc:m1_cancel_school_admin_invitation"]);
  f = fake({ rpcErrors: { m1_cancel_school_admin_invitation: { message: "boom" } } });
  await assert.rejects(svc.cancelSchoolAdminInvitation(SA, INV, null, deps(f.client)), (e) => e.statusCode === 502);
  assert.deepEqual(f.log.at(-1), ["ban", "none"], "ban undone");
  f = fake({ banFails: true });
  await assert.rejects(svc.cancelSchoolAdminInvitation(SA, INV, null, deps(f.client)), (e) => e.statusCode === 502);
  assert.ok(!f.log.some((l) => l[1] === "m1_cancel_school_admin_invitation"), "no record change when the ban fails");
});

const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
test("accept: requires a session from an emailed link for the same user; password sessions are refused", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(svc.linkSessionTime(jwt({ sub: NEW, amr: [{ method: "otp", timestamp: now }] }), NEW), new Date(now * 1000).toISOString());
  assert.equal(svc.linkSessionTime(jwt({ sub: NEW, amr: [{ method: "password", timestamp: now }] }), NEW), null);
  assert.equal(svc.linkSessionTime(jwt({ sub: id(6), amr: [{ method: "otp", timestamp: now }] }), NEW), null, "token of another user");
  assert.equal(svc.linkSessionTime("not-a-jwt", NEW), null);
  let f = fake();
  assert.deepEqual(await svc.acceptSchoolAdminInvitation({ id: NEW }, jwt({ sub: NEW, amr: [{ method: "otp", timestamp: now }] }), deps(f.client)), { role: "admin" });
  assert.equal(f.log.at(-1)[2], new Date(now * 1000).toISOString());
  f = fake();
  await assert.rejects(svc.acceptSchoolAdminInvitation({ id: NEW }, jwt({ sub: NEW, amr: [{ method: "password", timestamp: now }] }), deps(f.client)), (e) => e.statusCode === 403);
  assert.deepEqual(f.log, [], "no database call without a link session");
  for (const [code, status] of [["m1_invite_expired", 410], ["m1_invite_cancelled", 410], ["m1_invite_link_not_current", 403], ["m1_invite_already_accepted", 409], ["m1_invite_none", 404]]) {
    f = fake({ rpcErrors: { m1_accept_school_admin_invitation: { message: code } } });
    await assert.rejects(svc.acceptSchoolAdminInvitation({ id: NEW }, jwt({ sub: NEW, amr: [{ method: "otp", timestamp: now }] }), deps(f.client)), (e) => e.statusCode === status, code);
  }
});

test("own state: none before the update is installed or without an invitation; a pending invitation past expiry is expired", async () => {
  const table = (data, error = null) => ({ getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) }) });
  assert.deepEqual(await svc.ownInvitationState({ id: NEW }, table(null, { code: "PGRST205", message: "Could not find the table" })), { state: "none" });
  assert.deepEqual(await svc.ownInvitationState({ id: NEW }, table(null)), { state: "none" });
  assert.equal((await svc.ownInvitationState({ id: NEW }, table({ status: "pending", expires_at: "2000-01-01T00:00:00Z" }))).state, "expired");
  assert.equal((await svc.ownInvitationState({ id: NEW }, table({ status: "pending", expires_at: "2099-01-01T00:00:00Z" }))).state, "pending");
});

async function serve(router, run) {
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0);
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test("routes: resend/cancel are System Admin-only; the account router uses only the verified token identity", async () => {
  const calls = [];
  const as = (role) => createAdminUsersRouter({
    authorizeAccountManager: async () => { if (!["admin", "system_admin"].includes(role)) throw new AdminAuthorizationError(); return { user: { id: SA }, profile: { role } }; },
    resendSchoolAdminInvitation: async (actor, inv) => { calls.push(["resend", actor, inv]); return { setupEmailSent: true }; },
    cancelSchoolAdminInvitation: async (actor, inv, reason) => { calls.push(["cancel", actor, inv, reason]); return { status: "cancelled" }; },
  });
  for (const role of ["admin", "teacher", "student"]) {
    await serve(as(role), async (url) => {
      for (const action of ["resend", "cancel"]) assert.equal((await fetch(`${url}/school-admins/invitations/${INV}/${action}`, { method: "POST" })).status, 403, `${role} ${action}`);
    });
  }
  await serve(as("system_admin"), async (url) => {
    assert.equal((await fetch(`${url}/school-admins/invitations/not-a-uuid/resend`, { method: "POST" })).status, 400);
    assert.equal((await fetch(`${url}/school-admins/invitations/${INV}/resend`, { method: "POST" })).status, 200);
    const cancel = await fetch(`${url}/school-admins/invitations/${INV}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Wrong address" }) });
    assert.equal(cancel.status, 200);
  });
  assert.deepEqual(calls, [["resend", SA, INV], ["cancel", SA, INV, "Wrong address"]], "only System Admin calls reach the service");

  const seen = [];
  const account = createAccountInvitationRouter({
    getAuthenticatedSupabaseUser: async (req) => { if (!req.get("authorization")) { const { SupabaseAuthenticationError } = require("../services/supabaseAdmin"); throw new SupabaseAuthenticationError(); } return { id: NEW }; },
    invitations: { ownInvitationState: async (user) => ({ state: "pending", user: user.id }), acceptSchoolAdminInvitation: async (user, token) => { seen.push([user.id, token]); return { role: "admin" }; } },
  });
  await serve(account, async (url) => {
    assert.equal((await fetch(`${url}/school-admin-invitation`)).status, 401);
    assert.equal((await (await fetch(`${url}/school-admin-invitation`, { headers: { authorization: "Bearer t" } })).json()).invitation.user, NEW);
    const accepted = await fetch(`${url}/school-admin-invitation/accept`, { method: "POST", headers: { authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ userId: id(66) }) });
    assert.equal(accepted.status, 200);
  });
  assert.deepEqual(seen, [[NEW, "tok"]], "the body cannot choose another account");
});
