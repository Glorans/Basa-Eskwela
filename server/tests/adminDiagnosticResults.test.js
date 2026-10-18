const assert = require("node:assert/strict");
const test = require("node:test");
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

test("service returns only Student and Independent Learner diagnostics", async () => {
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
  });

  assert.deepEqual(results.map((result) => result.role), ["student", "general_user"]);
  assert.equal(results[0].email, "student@test");
  assert.deepEqual(results.map(result => result.language), ["en", "fil"]);
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
      assert.equal(table, "profiles");
      return {
        select(fields) {
          assert.deepEqual(fields.split(", "), ["id", "full_name", "nickname", "role", "status", "created_at", "teacher_status"]);
          return this;
        },
        order: async () => ({ data: profiles, error: null }),
      };
    },
  };
  const users = await listManagedUsers({ getSupabaseAdmin: () => supabase });
  assert.equal(users.find(user => user.id === "student").fullName, "");
  const results = await listAdminDiagnosticResults({
    getSupabaseAdmin: () => supabase,
    listManagedUsers: async () => users,
    listDiagnosticResultRows: async () => profiles.flatMap(profile => ["en", "fil"].map(language => ({
      id: `${profile.id}-${language}`, user_id: profile.id, language,
    }))),
  });
  assert.deepEqual(results.map(result => result.learnerName), [
    "Mariel", "Mariel", "Kai", "Kai", "Legacy Reader", "Legacy Reader", "Fallback", "Fallback", "", "", "", "", "Real Name", "Real Name",
  ]);
  assert.ok(results.every(result => !("fullName" in result)));
  assert.deepEqual(profiles, original);
});
