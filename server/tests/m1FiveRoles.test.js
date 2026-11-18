// M1 five roles: System Admin and School Admin account management (F6 view roles, F7 delete, F8 create School
// Admin). Fake Supabase clients only; nothing reaches a real database or sends email.
const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const scope = require("../services/m1AccountScope");
const {
  AdminAuthorizationError,
  AdminUserOperationError,
  authorizeAccountManager,
  createSchoolAdmin,
  deleteManagedUser,
  listManagedUsers,
  passwordSetupRedirect,
} = require("../services/adminUserService");
const { createAdminUsersRouter } = require("../routes/adminUsers");

const ROLES = ["system_admin", "admin", "teacher", "student", "general_user", null];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("scope matrix: who may view and delete which role (deny by default)", () => {
  const view = (manager, target) => scope.canViewAccount(manager, target);
  const del = (manager, target) => scope.canDeleteAccount({ managerRole: manager, managerId: id(1), targetRole: target, targetId: id(2) });
  // System Admin: views every account; deletes Independent Learners and School Admins only.
  for (const target of ROLES) assert.equal(view("system_admin", target), true, String(target));
  assert.deepEqual(ROLES.filter((t) => del("system_admin", t)), ["admin", "general_user"]);
  // School Admin: views and deletes Teachers and Students only. Never Independent Learners or administrators.
  assert.deepEqual(ROLES.filter((t) => view("admin", t)), ["teacher", "student"]);
  assert.deepEqual(ROLES.filter((t) => del("admin", t)), ["teacher", "student"]);
  // Everyone else: nothing, including unknown or spoofed role names.
  for (const manager of ["teacher", "student", "general_user", null, "", "System Admin", "superadmin", "ADMIN"]) {
    for (const target of ROLES) {
      assert.equal(view(manager, target), false, `${manager} viewing ${target}`);
      assert.equal(del(manager, target), false, `${manager} deleting ${target}`);
    }
    assert.equal(scope.describePermissions(manager), null);
  }
  // Nobody deletes their own account here.
  assert.equal(scope.canDeleteAccount({ managerRole: "system_admin", managerId: id(1), targetRole: "admin", targetId: id(1) }), false);
  assert.equal(scope.describePermissions("admin").canCreateSchoolAdmin, false);
  assert.equal(scope.describePermissions("system_admin").canCreateSchoolAdmin, true);
});

function profileReader(role) {
  return { from: () => ({ select() { return this; }, eq() { return this; }, async single() { return { data: role === undefined ? null : { id: id(9), role }, error: null }; } }) };
}

test("account management authorization: only System Admin and School Admin, read from the database", async () => {
  for (const role of ["system_admin", "admin"]) {
    const result = await authorizeAccountManager({}, { getAuthenticatedSupabaseUser: async () => ({ id: id(9) }), getSupabaseAdmin: () => profileReader(role) });
    assert.equal(result.profile.role, role);
  }
  for (const role of ["teacher", "student", "general_user", null]) {
    await assert.rejects(
      authorizeAccountManager({}, {
        // Escalation attempt: the browser claims to be an admin; only the database role counts.
        getAuthenticatedSupabaseUser: async () => ({ id: id(9), user_metadata: { role: "system_admin" }, app_metadata: { role: "admin" } }),
        getSupabaseAdmin: () => profileReader(role),
      }),
      (error) => error instanceof AdminAuthorizationError && error.statusCode === 403, String(role));
  }
});

function directory() {
  const accounts = [
    ["system_admin", 1], ["admin", 2], ["teacher", 3], ["student", 4], ["general_user", 5], [null, 6],
  ].map(([role, n]) => ({ id: id(n), role, full_name: `User ${n}`, status: "active", created_at: `2026-11-0${n}` }));
  return {
    auth: { admin: { listUsers: async () => ({ data: { users: accounts.map((a) => ({ id: a.id, email: `u${a.id.slice(-1)}@example.test`, created_at: a.created_at })) }, error: null }) } },
    from: () => ({ select() { return this; }, order: async () => ({ data: accounts, error: null }) }),
  };
}

test("F6 view roles: School Admin sees only Teachers and Students; System Admin sees everyone", async () => {
  const roles = async (manager) => (await listManagedUsers({ getSupabaseAdmin: directory }, manager)).map((u) => u.role).sort();
  assert.deepEqual(await roles("admin"), ["student", "teacher"], "no Independent Learners, administrators or unassigned accounts");
  assert.deepEqual(await roles("system_admin"), ["", "admin", "general_user", "student", "system_admin", "teacher"].sort());
  for (const role of [undefined, null, "teacher", "student", "general_user", "School Admin"]) {
    await assert.rejects(roles(role), (error) => error instanceof AdminAuthorizationError, `fails closed for ${role}`);
  }
});

function deletionClient(targetRole) {
  const calls = [];
  return {
    calls,
    client: {
      from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: targetRole === undefined ? null : { id: id(7), role: targetRole }, error: null }; } }),
      auth: { admin: { async deleteUser(userId) { calls.push(userId); return { error: null }; } } },
    },
  };
}

const APPROVED = { approvedDeletionRequestId: "approved-request-test" };
// The reserved permanent-deletion function keeps its scope rules for a future, separately approved process.
test("reserved deletion process: each administrator deletes only inside its scope; administrators and System Admins are protected", async () => {
  const attempt = async (manager, targetRole) => {
    const { calls, client } = deletionClient(targetRole);
    try {
      await deleteManagedUser(id(1), id(7), { getSupabaseAdmin: () => client, ...APPROVED }, manager);
      return { ok: true, deleted: calls.length };
    } catch (error) {
      assert.ok(error instanceof AdminUserOperationError, error.message);
      return { ok: false, status: error.statusCode, deleted: calls.length };
    }
  };
  for (const target of ["teacher", "student"]) assert.deepEqual(await attempt("admin", target), { ok: true, deleted: 1 }, `School Admin deletes ${target}`);
  assert.deepEqual(await attempt("admin", "general_user"), { ok: false, status: 403, deleted: 0 }, "School Admin cannot delete an Independent Learner");
  // One answer for every out-of-scope target, so a School Admin cannot probe what an ID is.
  assert.deepEqual(await attempt("admin", "admin"), { ok: false, status: 403, deleted: 0 }, "School Admin cannot delete a School Admin");
  assert.deepEqual(await attempt("admin", "system_admin"), { ok: false, status: 403, deleted: 0 }, "School Admin cannot delete a System Admin");
  assert.deepEqual(await attempt("admin", undefined), { ok: false, status: 403, deleted: 0 }, "a missing account looks the same");
  assert.deepEqual(await attempt("admin", null), { ok: false, status: 403, deleted: 0 }, "unassigned accounts are not school accounts");
  for (const target of ["general_user", "admin"]) assert.deepEqual(await attempt("system_admin", target), { ok: true, deleted: 1 }, `System Admin deletes ${target}`);
  for (const target of ["teacher", "student"]) assert.deepEqual(await attempt("system_admin", target), { ok: false, status: 403, deleted: 0 }, `${target} accounts belong to the School Admin`);
  assert.deepEqual(await attempt("system_admin", "system_admin"), { ok: false, status: 409, deleted: 0 }, "System Admins are never deleted here");
  await assert.rejects(deleteManagedUser(id(1), id(7), { getSupabaseAdmin: () => deletionClient("student").client, ...APPROVED }, "teacher"),
    (error) => error instanceof AdminAuthorizationError, "a Teacher cannot delete anyone");
  await assert.rejects(deleteManagedUser(id(1), id(7), { getSupabaseAdmin: () => deletionClient("student").client, ...APPROVED }),
    (error) => error instanceof AdminAuthorizationError, "no manager role: fails closed");
  await assert.rejects(deleteManagedUser(id(1), id(1), { ...APPROVED }, "system_admin"), (error) => error.statusCode === 409, "no self-deletion");
});

// F8 creation is covered by tests/m1SchoolAdminInvitations.test.js (authorization record + invitation lifecycle).

async function server(dependencies, callback) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/users", createAdminUsersRouter(dependencies));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  try { await callback(`http://127.0.0.1:${listener.address().port}/api/admin/users`); } finally { await new Promise((resolve) => listener.close(resolve)); }
}

test("routes: permissions summary, scoped delete, and School Admin creation for System Admins only", async () => {
  const calls = { list: [], del: [], create: [] };
  const as = (role) => ({
    authorizeAccountManager: async () => {
      if (!["admin", "system_admin"].includes(role)) throw new AdminAuthorizationError("Administrator access is required.");
      return { user: { id: id(1) }, profile: { role } };
    },
    listManagedUsers: async (...args) => { calls.list.push(args); return []; },
    deleteManagedUser: async (...args) => { calls.del.push(args); },
    createSchoolAdmin: async (input) => { calls.create.push(input); return { id: id(77), email: input.email, fullName: input.fullName, role: "admin", setupEmailSent: true }; },
  });
  const post = (url, body) => fetch(`${url}/school-admins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await server(as("admin"), async (url) => {
    const listing = await (await fetch(url)).json();
    assert.deepEqual(listing.permissions, { role: "admin", visibleRoles: ["teacher", "student"], deletableRoles: ["teacher", "student"], statusRoles: ["teacher", "student"], canCreateSchoolAdmin: false });
    assert.deepEqual(calls.list.at(-1), [undefined, "admin"]);
    assert.equal((await post(url, { email: "a@b.co", fullName: "A B" })).status, 403, "School Admin cannot create School Admins");
    assert.equal(calls.create.length, 0);
    assert.equal((await fetch(`${url}/${id(4)}`, { method: "DELETE" })).status, 410, "routine permanent deletion is disabled");
    assert.deepEqual(calls.del, []);
  });
  for (const role of ["teacher", "student", "general_user"]) {
    await server(as(role), async (url) => {
      assert.equal((await fetch(url)).status, 403, `${role} cannot list accounts`);
      assert.equal((await post(url, { email: "a@b.co", fullName: "A B" })).status, 403, `${role} cannot create School Admins`);
      assert.equal((await fetch(`${url}/${id(4)}`, { method: "DELETE" })).status, 410, `${role} cannot delete accounts`);
    });
  }
  await server(as("system_admin"), async (url) => {
    const listing = await (await fetch(url)).json();
    assert.equal(listing.permissions.canCreateSchoolAdmin, true);
    assert.deepEqual(listing.permissions.deletableRoles, ["general_user", "admin"]);
    const response = await post(url, { email: "new@school.test", fullName: "New Admin", role: "system_admin" });
    assert.equal(response.status, 201);
    assert.deepEqual(calls.create.at(-1), { email: "new@school.test", fullName: "New Admin", authorization: undefined }, "a role in the request body is ignored");
    assert.match((await response.json()).message, /invitation sent. The account gets School Admin access only after the invitee accepts/);
  });
});
