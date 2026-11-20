// School Admin / System Admin separation, tested with direct HTTP requests against the REAL routers, REAL
// authorization functions and REAL services. Only Supabase is replaced, by an in-memory database that honours the
// query filters; the caller is identified by the bearer token, and the role always comes from the profile row.
// Nothing here reaches a real database, deletes a real account or sends email.
const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createDatabase, material } = require("./fixtures/materialDatabase");
const {
  authorizeAccountManager,
  authorizeAdminRequest,
  createSchoolAdmin,
  deleteManagedUser,
  listManagedUsers,
} = require("../services/adminUserService");
const { listAdminDiagnosticResults } = require("../services/adminDiagnosticResultService");
const { createAdminUsersRouter } = require("../routes/adminUsers");
const { createAdminDiagnosticResultsRouter } = require("../routes/adminDiagnosticResults");
const { createMaterialsRouter } = require("../routes/materials");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACCOUNTS = {
  system: [uuid(1), "system_admin", "Sys Admin"],
  otherSystem: [uuid(2), "system_admin", "Other Sys"],
  school: [uuid(3), "admin", "School Admin One"],
  otherSchool: [uuid(4), "admin", "School Admin Two"],
  teacher: [uuid(5), "teacher", "Teacher Tess"],
  student: [uuid(6), "student", "Student Sam"],
  learner: [uuid(7), "general_user", "Indie Iris"],
  otherLearner: [uuid(8), "general_user", "Indie Ivan"],
};
const LEARNER_MARKERS = [uuid(7), uuid(8), "Indie Iris", "Indie Ivan", "iris@", "ivan@"];
const email = (name) => `${name.split(" ")[1].toLowerCase()}@example.test`;
const TEACHER_MATERIAL = uuid(70);
// M1 multi-tenancy: every School Admin, Teacher and Student here belongs to School 1.
const S1 = uuid(60);
const LEARNER_MATERIAL = uuid(71);

function world() {
  const profiles = Object.values(ACCOUNTS).map(([id, role, name]) => ({
    id, role, full_name: name, nickname: name.split(" ")[1], status: "active",
    teacher_status: role === "teacher" ? "approved" : null, created_at: "2026-11-01T00:00:00.000Z",
    school_id: ["admin", "teacher", "student"].includes(role) ? S1 : null,
  }));
  const db = createDatabase({
    profiles,
    schools: [{ id: S1, name: "School 1" }],
    uploaded_materials: [material(TEACHER_MATERIAL, uuid(5), "Teacher text"), material(LEARNER_MATERIAL, uuid(7), "Iris private text")],
    diagnostic_results: [uuid(6), uuid(7)].map((userId, n) => ({ id: uuid(80 + n), user_id: userId, assessment_type: "initial",
      language: "en", orv_score: 90, comprehension_score: 80, reading_speed_wpm: 70, reading_level: "Instructional",
      difficulty_tier: "Medium", completed_at: "2026-11-02T00:00:00.000Z", verification_status: "verified" })),
  });
  // The shared fixture has no `.is()` filter; createSchoolAdmin uses it to touch only an unassigned profile.
  const Query = db.from("profiles").constructor;
  Query.prototype.is ??= function is(column, value) { this.filters.push((row) => (row[column] ?? null) === value); return this; };
  const deletedAuthUsers = [];
  const authUsers = profiles.map((p) => ({ id: p.id, email: email(p.full_name), created_at: p.created_at }));
  db.auth = {
    admin: {
      listUsers: async () => ({ data: { users: authUsers.map((u) => ({ ...u })) }, error: null }),
      deleteUser: async (id) => {
        deletedAuthUsers.push(id);
        authUsers.splice(authUsers.findIndex((u) => u.id === id), 1);
        db.tables.profiles = db.tables.profiles.filter((p) => p.id !== id);
        return { error: null };
      },
      createUser: async ({ email: address }) => {
        const id = uuid(90 + authUsers.length);
        authUsers.push({ id, email: address, created_at: "2026-11-16T00:00:00.000Z" });
        db.tables.profiles.push({ id, role: null, full_name: "", status: "active", created_at: "2026-11-16T00:00:00.000Z" });
        return { data: { user: { id } }, error: null };
      },
    },
    resetPasswordForEmail: async () => ({ error: null }),
  };
  // M1 F8 invitation RPCs (fake): the account stays role-less; only acceptance (not exercised here) grants the role.
  db.tables.m1_school_admin_invitations = [];
  db.rpc = async (name, args) => {
    if (name === "m1_create_school_admin_invitation") {
      const actor = db.tables.profiles.find((p) => p.id === args.p_actor);
      if (actor?.role !== "system_admin") return { data: null, error: { message: "m1_invite_actor_not_system_admin" } };
      const target = db.tables.profiles.find((p) => p.id === args.p_user);
      target.full_name = args.p_full_name;
      const id = uuid(200 + db.tables.m1_school_admin_invitations.length);
      db.tables.m1_school_admin_invitations.push({ id, user_id: args.p_user, authorized_by: args.p_actor, status: "pending", expires_at: "2099-01-01T00:00:00Z" });
      return { data: id, error: null };
    }
    if (name === "m1_record_school_admin_invitation_email") return { data: "2099-01-01T00:00:00Z", error: null };
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  };
  const getSupabaseAdmin = () => db;
  // Bearer token -> user, like Supabase Auth. The token never carries a role.
  const getAuthenticatedSupabaseUser = async (req) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const account = ACCOUNTS[token];
    if (!account) throw new SupabaseAuthenticationError();
    return { id: account[0], user_metadata: { role: "system_admin" }, app_metadata: { role: "admin" } };
  };
  const deps = { getSupabaseAdmin, getAuthenticatedSupabaseUser };
  const app = express();
  app.use(express.json());
  app.use("/api/admin/users", createAdminUsersRouter({
    authorizeAccountManager: (req) => authorizeAccountManager(req, deps),
    listManagedUsers: (_unused, role, school) => listManagedUsers({ getSupabaseAdmin }, role, school),
    deleteManagedUser: (requesterId, userId, _unused, role) => deleteManagedUser(requesterId, userId, { getSupabaseAdmin }, role),
    createSchoolAdmin: (input, _unused, requester) => createSchoolAdmin(input, { getSupabaseAdmin, passwordSetupRedirect: () => "https://basaeskwela.com/reset-password" }, requester),
  }));
  app.use("/api/admin/diagnostic-results", createAdminDiagnosticResultsRouter({
    authorizeAdminRequest: (req) => authorizeAdminRequest(req, deps),
    listAdminDiagnosticResults: (_unused, role, school) => listAdminDiagnosticResults({ getSupabaseAdmin }, role, school),
  }));
  app.use("/api/materials", createMaterialsRouter(deps));
  return { app, db, deletedAuthUsers };
}

async function serve(callback) {
  const w = world();
  const listener = w.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const call = async (who, method, path, body) => {
    const response = await fetch(base + path, {
      method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), "Content-Type": "application/json", "X-Role": "system_admin" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  try { await callback({ ...w, call }); } finally { await new Promise((resolve) => listener.close(resolve)); }
}
const leaksLearner = (text) => LEARNER_MARKERS.some((marker) => text.includes(marker));
const exists = (db, id) => db.tables.profiles.some((p) => p.id === id);

test("School Admin lists Teachers and Students only; no query manipulation returns an Independent Learner", async () => {
  await serve(async ({ call }) => {
    const list = await call("school", "GET", "/api/admin/users");
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.users.map((u) => u.role).sort(), ["student", "teacher"]);
    assert.deepEqual(list.json.users.map((u) => u.email).sort(), ["sam@example.test", "tess@example.test"], "roles and emails shown");
    assert.equal(list.json.users.length, 2, "the count covers Teachers and Students only");
    assert.deepEqual(list.json.permissions, { role: "admin", visibleRoles: ["teacher", "student"], deletableRoles: ["teacher", "student"], statusRoles: ["teacher", "student"], canCreateSchoolAdmin: false, canManageSchools: false });
    assert.equal(leaksLearner(list.text), false);
    assert.equal(/Sys Admin|Other Sys|School Admin Two/.test(list.text), false, "no administrator accounts");
    for (const query of ["?role=general_user", "?search=iris", "?q=Indie", `?userId=${uuid(7)}`, `?id=${uuid(7)}`, "?page=2&perPage=1000", "?includeAll=true", "?scope=all"]) {
      const manipulated = await call("school", "GET", `/api/admin/users${query}`);
      assert.equal(manipulated.text, list.text, `query ${query} changes nothing`);
    }
  });
});

test("School Admin cannot retrieve, delete or probe an Independent Learner (or any administrator) by ID", async () => {
  await serve(async ({ call, db, deletedAuthUsers }) => {
    for (const method of ["GET", "PATCH", "PUT"]) {
      const direct = await call("school", method, `/api/admin/users/${uuid(7)}`, method === "GET" ? undefined : { role: "student" });
      assert.equal(direct.status, 404, `${method} by ID is not an endpoint`);
      // Express echoes the requested path; nothing else about the account (name, email) comes back.
      assert.equal(/Indie|iris@|ivan@|general_user/.test(direct.text), false);
    }
    const answers = [];
    for (const target of [uuid(7), uuid(8), uuid(4), uuid(1), uuid(2), uuid(99)]) {
      const response = await call("school", "DELETE", `/api/admin/users/${target}`, { role: "system_admin" });
      answers.push(`${response.status} ${response.text}`);
    }
    assert.equal(new Set(answers).size, 1, "Independent Learner, School Admin, System Admin and missing IDs all get the same answer");
    assert.match(answers[0], /^410 .*Permanent account deletion is disabled/);
    assert.deepEqual(deletedAuthUsers, []);
    for (const id of [uuid(7), uuid(8), uuid(4), uuid(1), uuid(2)]) assert.ok(exists(db, id));
    assert.equal((await call("school", "DELETE", `/api/admin/users/${uuid(3)}`)).status, 410, "routine deletion is disabled, including their own account");
  });
});

test("School Admin cannot permanently delete Teachers or Students, and cannot create School Admin or System Admin accounts", async () => {
  await serve(async ({ call, db, deletedAuthUsers }) => {
    assert.equal((await call("school", "DELETE", `/api/admin/users/${uuid(5)}`)).status, 410);
    assert.equal((await call("school", "DELETE", `/api/admin/users/${uuid(6)}`)).status, 410);
    assert.deepEqual(deletedAuthUsers, [], "deactivation replaced routine deletion");
    for (const body of [{ email: "new@school.test", fullName: "New Admin" }, { email: "x@school.test", fullName: "X Y", role: "system_admin" }]) {
      assert.equal((await call("school", "POST", "/api/admin/users/school-admins", body)).status, 403);
    }
    assert.equal(db.tables.profiles.some((p) => p.full_name === "New Admin" || p.full_name === "X Y"), false);
  });
});

test("School Admin diagnostic results and materials never include an Independent Learner", async () => {
  await serve(async ({ call, db }) => {
    const results = await call("school", "GET", "/api/admin/diagnostic-results");
    assert.equal(results.status, 200);
    assert.deepEqual(results.json.results.map((r) => r.userId), [uuid(6)], "Student diagnostics only");
    assert.equal(leaksLearner(results.text), false);

    const materials = await call("school", "GET", "/api/materials");
    assert.equal(materials.status, 200);
    assert.deepEqual(materials.json.materials.map((m) => m.id), [TEACHER_MATERIAL]);
    assert.equal(leaksLearner(materials.text) || materials.text.includes("Iris private text"), false);
    const missing = await call("school", "GET", `/api/materials/${uuid(79)}`);
    for (const [method, path] of [["GET", `/api/materials/${LEARNER_MATERIAL}`], ["DELETE", `/api/materials/${LEARNER_MATERIAL}`],
      ["GET", `/api/materials/${LEARNER_MATERIAL}/question-sets`]]) {
      const response = await call("school", method, path);
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.text, missing.text, "indistinguishable from a material that does not exist");
    }
    assert.ok(db.tables.uploaded_materials.some((m) => m.id === LEARNER_MATERIAL), "not deleted");
    assert.equal((await call("school", "GET", `/api/materials/${TEACHER_MATERIAL}`)).status, 200, "Teacher material still managed");
    // The Independent Learner's own access is unchanged.
    assert.deepEqual((await call("learner", "GET", "/api/materials")).json.materials.map((m) => m.id), [LEARNER_MATERIAL]);
    assert.equal((await call("learner", "GET", `/api/materials/${LEARNER_MATERIAL}`)).status, 200);
  });
});

test("System Admin manages Independent Learners and School Admins, never System Admins, itself, or M2-M8 data", async () => {
  await serve(async ({ call, db, deletedAuthUsers }) => {
    const list = await call("system", "GET", "/api/admin/users");
    assert.deepEqual(list.json.users.map((u) => u.role).sort(), ["admin", "admin", "general_user", "general_user", "student", "system_admin", "system_admin", "teacher"]);
    assert.deepEqual(list.json.permissions.deletableRoles, ["general_user", "admin"]);
    for (const target of [7, 4, 2, 1, 5, 6]) {
      assert.equal((await call("system", "DELETE", `/api/admin/users/${uuid(target)}`)).status, 410, `routine deletion disabled (${target})`);
    }
    assert.deepEqual(deletedAuthUsers, [], "no Auth user is ever deleted");

    assert.equal((await call("system", "POST", "/api/admin/users/school-admins", { email: "x@school.test", fullName: "No Basis" })).status, 400,
      "an authorization record is required");
    const created = await call("system", "POST", "/api/admin/users/school-admins", { email: "Principal@School.test", fullName: "Pat Principal", role: "system_admin", schoolId: S1,
      authorization: { reference: "Request letter dated 2026-11-18", confirmationMethod: "official_school_phone", authorizingPosition: "School Principal" } });
    assert.equal(created.status, 201);
    assert.equal(created.json.account.role, null, "no role until the invitation is accepted");
    assert.equal(created.json.account.invitationStatus, "pending");
    const row = db.tables.profiles.find((p) => p.full_name === "Pat Principal");
    assert.equal(row.role, null, "the body's role is ignored; the account has no access while pending");
    assert.equal(db.tables.m1_school_admin_invitations.at(-1).authorized_by, uuid(1), "the authorizing System Admin is recorded");
    assert.equal(db.tables.profiles.filter((p) => p.role === "system_admin").length, 2, "no new System Admin");

    // No System Admin access to School Admin (M2-M8) features.
    assert.equal((await call("system", "GET", "/api/admin/diagnostic-results")).status, 403);
    // M3 F8 (System Admin): its OWN uploaded materials only; another user's material never appears.
    const ownMaterials = await call("system", "GET", "/api/materials");
    assert.equal(ownMaterials.status, 200);
    assert.ok(!JSON.stringify(ownMaterials.json).includes(TEACHER_MATERIAL), "no Teacher material in the System Admin list");
    assert.equal((await call("system", "GET", `/api/materials/${TEACHER_MATERIAL}`)).status, 403);
  });
});

test("Teachers, Students, Independent Learners and anonymous callers get no account-management data", async () => {
  await serve(async ({ call, deletedAuthUsers }) => {
    for (const who of ["teacher", "student", "learner"]) {
      for (const [method, path, body] of [["GET", "/api/admin/users"], ["PATCH", `/api/admin/users/${uuid(8)}/status`, { status: "inactive" }],
        ["POST", "/api/admin/users/school-admins", { email: "a@b.co", fullName: "A B" }], ["GET", "/api/admin/diagnostic-results"]]) {
        const response = await call(who, method, path, body);
        assert.equal(response.status, 403, `${who} ${method} ${path}`);
        assert.equal(leaksLearner(response.text), false);
      }
    }
    for (const [method, path] of [["GET", "/api/admin/users"], ["PATCH", `/api/admin/users/${uuid(8)}/status`], ["GET", "/api/admin/diagnostic-results"]]) {
      assert.equal((await call(null, method, path)).status, 401);
    }
    assert.equal((await call(null, "DELETE", `/api/admin/users/${uuid(8)}`)).status, 410, "deletion is disabled for everyone");
    assert.deepEqual(deletedAuthUsers, []);
  });
});
