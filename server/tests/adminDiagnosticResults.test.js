const assert = require("node:assert/strict");
const test = require("node:test");
const SCHOOL = "5c000000-0000-4000-8000-000000000001";
const express = require("express");
const {
  createAdminDiagnosticResultsRouter,
} = require("../routes/adminDiagnosticResults");
const {
  listAdminDiagnosticResults,
} = require("../services/adminDiagnosticResultService");
const {
  AdminAuthorizationError,
  listManagedUsers,
} = require("../services/adminUserService");
const {
  SupabaseAuthenticationError,
} = require("../services/supabaseAdmin");

async function withTestServer(dependencies, callback) {
  const app = express();
  app.use(
    "/api/admin/diagnostic-results",
    createAdminDiagnosticResultsRouter(dependencies),
  );
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}/api/admin/diagnostic-results`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Admin diagnostic results reject a missing or invalid session", async () => {
  await withTestServer(
    {
      authorizeAdminRequest: async () => {
        throw new SupabaseAuthenticationError();
      },
    },
    async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 401);
    },
  );
});

test("non-Admin users cannot access all diagnostic results", async () => {
  await withTestServer(
    {
      authorizeAdminRequest: async () => {
        throw new AdminAuthorizationError();
      },
    },
    async (url) => {
      const response = await fetch(url, {
        headers: { Authorization: "Bearer learner" },
      });
      assert.equal(response.status, 403);
    },
  );
});

test("Admin can view the safe diagnostic result response", async () => {
  const results = [{ id: "result-id", role: "student" }];

  await withTestServer(
    {
      authorizeAdminRequest: async () => ({ user: { id: "admin-id" } }),
      listAdminDiagnosticResults: async () => results,
    },
    async (url) => {
      const response = await fetch(url, {
        headers: { Authorization: "Bearer admin" },
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).results, results);
    },
  );
});

test("service returns Student diagnostics only: a School Admin never receives Independent Learner results", async () => {
  const users = [
    { id: "student-id", fullName: "Student", email: "student@test", role: "student" },
    { id: "learner-id", fullName: "Learner", email: "learner@test", role: "general_user" },
    { id: "teacher-id", fullName: "Teacher", email: "teacher@test", role: "teacher" },
    { id: "admin-id", fullName: "Admin", email: "admin@test", role: "admin" },
  ];
  const row = (userId) => ({
    id: `${userId}-result`,
    user_id: userId,
    language: userId === "student-id" ? "en" : "fil",
    orv_score: 98,
    comprehension_score: 85.71,
    reading_speed_wpm: 80,
    reading_level: "Independent",
    difficulty_tier: "Hard",
    completed_at: "2026-10-01T00:00:00.000Z",
  });

  const results = await listAdminDiagnosticResults({
    getSupabaseAdmin: () => ({}),
    listManagedUsers: async () => users,
    listDiagnosticResultRows: async () => users.map((user) => row(user.id)),
  }, "admin", SCHOOL);

  // Even though the injected account list includes an Independent Learner, the result excludes them.
  assert.deepEqual(results.map((result) => result.role), ["student"]);
  assert.equal(results[0].email, "student@test");
  assert.equal(/learner-id|learner@test|"Learner"/.test(JSON.stringify(results)), false, "no Independent Learner id, name or email");
  assert.deepEqual(results.map(result => result.language), ["en"]);
  for (const role of [undefined, "system_admin", "teacher", "student", "general_user"]) {
    await assert.rejects(listAdminDiagnosticResults({ listManagedUsers: async () => users, listDiagnosticResultRows: async () => [] }, role, SCHOOL),
      (error) => error.statusCode === 403, String(role));
  }
  // M1 multi-tenancy: a School Admin without a school gets nothing.
  await assert.rejects(listAdminDiagnosticResults({ listManagedUsers: async () => users, listDiagnosticResultRows: async () => [] }, "admin", null),
    (error) => error.statusCode === 403);
  assert.equal("transcript" in results[0], false);
  assert.equal("oralReadingMetrics" in results[0], false);
});


test("profile loading resolves learner nicknames for both languages without mutating profiles", async () => {
  const profiles = [
    { id: "student", role: "student", nickname: " Mariel ", full_name: "" },
    { id: "independent", role: "general_user", nickname: " Kai ", full_name: "Legal Name" },
    { id: "legacy", role: "student", nickname: null, full_name: " Legacy Reader " },
    { id: "blank", role: "general_user", nickname: "  ", full_name: " Fallback " },
    { id: "unnamed", role: "student", nickname: null, full_name: " " },
    { id: "sentinel", role: "student", nickname: " New User ", full_name: "NEW USER" },
    { id: "sentinel-fallback", role: "general_user", nickname: "new user", full_name: "Real Name" },
  ].map(profile => ({ ...profile, created_at: "2026-10-01", status: "active" }));
  const original = structuredClone(profiles);
  const supabase = {
    auth: { admin: { listUsers: async () => ({ data: { users: [
      { id: "student", email: "student@test", created_at: "2026-10-01" },
    ] }, error: null }) } },
    from(table) {
      // Listing users as System Admin also reads the School Admin invitation records (#20): none in this test.
      if (table === "m1_school_admin_invitations" || table === "schools") return { select: async () => ({ data: [], error: null }) };
      assert.equal(table, "profiles");
      return {
        select(fields) {
          assert.deepEqual(fields.split(", "), ["id", "full_name", "nickname", "role", "status", "created_at", "teacher_status", "school_id"]);
          return this;
        },
        order: async () => ({ data: profiles, error: null }),
      };
    },
  };
  const users = await listManagedUsers({ getSupabaseAdmin: () => supabase }, "system_admin");
  assert.equal(users.find(user => user.id === "student").fullName, "");
  const results = await listAdminDiagnosticResults({
    getSupabaseAdmin: () => supabase,
    listManagedUsers: async () => users,
    listDiagnosticResultRows: async () => profiles.flatMap(profile => ["en", "fil"].map(language => ({
      id: `${profile.id}-${language}`, user_id: profile.id, language,
    }))),
  }, "admin", SCHOOL);
  // Students only (Independent Learners are outside the School Admin's scope).
  assert.deepEqual(results.map(result => result.learnerName), [
    "Mariel", "Mariel", "Legacy Reader", "Legacy Reader", "", "", "", "",
  ]);
  assert.ok(results.every(result => !("fullName" in result)));
  assert.deepEqual(profiles, original);
});
