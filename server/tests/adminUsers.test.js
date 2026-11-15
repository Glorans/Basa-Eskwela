const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminUsersRouter } = require("../routes/adminUsers");
const {
  AdminAuthorizationError,
  AdminUserOperationError,
  authorizeAdminRequest,
  deleteManagedUser,
  listManagedUsers,
} = require("../services/adminUserService");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const adminId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

test("account mapping preserves real status and email and never invents a missing profile", async () => {
  const profiles = [{ id: "real", full_name: "New User", nickname: "Reader", role: "student", status: "inactive", created_at: "2026-10-08" }];
  const supabase = {
    auth: { admin: { listUsers: async () => ({ data: { users: [
      { id: "real", email: "real@example.test", created_at: "2026-10-08" },
      { id: "missing", created_at: "2026-10-08" },
    ] }, error: null }) } },
    from: () => ({ select() { return this; }, order: async () => ({ data: profiles, error: null }) }),
  };
  const users = await listManagedUsers({ getSupabaseAdmin: () => supabase }, "system_admin");
  assert.equal(users[0].email, "real@example.test");
  assert.equal(users[0].status, "inactive");
  assert.equal(users[1].role, "");
  assert.equal(users[1].status, "");
  assert.equal(users[1].email, null);
  assert.equal(users[1].fullName, "");
  assert.equal(profiles[0].full_name, "New User");
});

async function withTestServer(dependencies, callback) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/users", createAdminUsersRouter(dependencies));
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}/api/admin/users`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Admin user endpoint rejects a missing or invalid session with 401", async () => {
  await withTestServer(
    { authorizeAccountManager: async () => { throw new SupabaseAuthenticationError(); } },
    async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 401);
    },
  );
});

test("Admin user endpoint rejects an authenticated non-Admin with 403", async () => {
  await withTestServer(
    { authorizeAccountManager: async () => { throw new AdminAuthorizationError(); } },
    async (url) => {
      const response = await fetch(url, { headers: { Authorization: "Bearer learner" } });
      assert.equal(response.status, 403);
    },
  );
});

test("Admin can list safe user-management fields", async () => {
  const managedUsers = [
    {
      id: userId,
      email: "learner@example.com",
      fullName: "Learner",
      role: "student",
      status: "active",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ];

  await withTestServer(
    {
      authorizeAccountManager: async () => ({ user: { id: adminId }, profile: { role: "admin" } }),
      listManagedUsers: async () => managedUsers,
    },
    async (url) => {
      const response = await fetch(url, { headers: { Authorization: "Bearer admin" } });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).users, managedUsers);
    },
  );
});

test("Admin role-update endpoint no longer exists", async () => {
  let authorizeCalled = false;
  await withTestServer(
    {
      authorizeAccountManager: async () => {
        authorizeCalled = true;
        return { user: { id: adminId }, profile: { role: "admin" } };
      },
    },
    async (url) => {
      const response = await fetch(`${url}/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer admin" },
        body: JSON.stringify({ role: "teacher" }),
      });
      assert.equal(response.status, 404);
      assert.equal(authorizeCalled, false);
    },
  );
});

test("delete requires Admin authorization and calls the protected delete service", async () => {
  let deleted;
  await withTestServer(
    {
      authorizeAccountManager: async () => ({ user: { id: adminId }, profile: { role: "admin" } }),
      deleteManagedUser: async (...args) => { deleted = args; },
    },
    async (url) => {
      const response = await fetch(`${url}/${userId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer admin" },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(deleted, [adminId, userId, undefined, "admin"], "the caller's database role is passed to the scope check");
    },
  );
});

test("service prevents an Admin from deleting the current account", async () => {
  await assert.rejects(
    () => deleteManagedUser(adminId, adminId, {}, "admin"),
    (error) => error instanceof AdminUserOperationError && error.statusCode === 409,
  );
});

test("service prevents a School Admin from deleting any Admin account, with the generic out-of-scope answer", async () => {
  let deleteCalled = false;
  const profileQuery = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return { data: { id: userId, role: "admin" }, error: null };
    },
  };
  const supabase = {
    from: () => profileQuery,
    auth: {
      admin: {
        async deleteUser() {
          deleteCalled = true;
          return { error: null };
        },
      },
    },
  };

  await assert.rejects(
    () => deleteManagedUser(adminId, userId, { getSupabaseAdmin: () => supabase }, "admin"),
    (error) => error instanceof AdminUserOperationError && error.statusCode === 403
      && error.message === "This account is outside the accounts you can manage.",
  );
  assert.equal(deleteCalled, false);
});

test("authorization reads the database profile role instead of browser metadata", async () => {
  const profileQuery = {
    select() { return this; },
    eq() { return this; },
    async single() {
      return { data: { id: userId, role: "student" }, error: null };
    },
  };

  await assert.rejects(
    () => authorizeAdminRequest(
      {},
      {
        getAuthenticatedSupabaseUser: async () => ({
          id: userId,
          user_metadata: { account_type: "admin" },
        }),
        getSupabaseAdmin: () => ({ from: () => profileQuery }),
      },
    ),
    (error) => error instanceof AdminAuthorizationError && error.statusCode === 403,
  );
});
