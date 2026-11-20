// M1 minimum viable multi-tenancy (Appendix N F7-F11): server-side school isolation. The backend reads with the service
// role (row-level security bypassed), so these checks are the isolation layer for every API path. Fakes only: no
// Supabase project. Database-level isolation (RLS, triggers, functions) is rehearsed separately on a restored copy of
// Staging (release-review/m1-multi-tenancy-20261121/rehearse_db.py).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const scope = require("../services/schoolScope");
const schools = require("../services/schoolService");
const { createAdminSchoolsRouter } = require("../routes/adminSchools");
const { AdminAuthorizationError } = require("../services/adminUserService");
const { createReassessmentAssignmentService } = require("../services/reassessmentAssignmentService");
const { createAssessmentPackageService } = require("../services/assessmentPackageService");
const { listPracticeReadingPassages } = require("../services/adminOralReadingService");
const { loadAccessiblePublishedModule } = require("../services/oralReadingAttemptService");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S1 = id(901), S2 = id(902);
const SA = id(1), A1 = id(2), A2 = id(3), T1 = id(4), T2 = id(5), ST1 = id(6), ST2 = id(7), IL = id(8);
const PROFILES = [
  { id: SA, role: "system_admin", school_id: null }, { id: A1, role: "admin", school_id: S1 }, { id: A2, role: "admin", school_id: S2 },
  { id: T1, role: "teacher", teacher_status: "approved", school_id: S1 }, { id: T2, role: "teacher", teacher_status: "approved", school_id: S2 },
  { id: ST1, role: "student", school_id: S1 }, { id: ST2, role: "student", school_id: S2 }, { id: IL, role: "general_user", school_id: null },
];
const requester = (userId) => ({ user: { id: userId }, profile: { ...PROFILES.find((p) => p.id === userId) } });

/** A tiny Supabase-like query builder over in-memory tables (select / eq / in / order / range / maybeSingle / single). */
function fakeDb(tables) {
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select() { return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    in(c, v) { this.filters.push((r) => v.includes(r[c])); return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c, op, v) { this.filters.push((r) => (op === "is" && v === null ? r[c] != null : true)); return this; }
    order() { return this; }
    range(a, b) { this.window = [a, b + 1]; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    single() { this.mode = "single"; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      calls.push(this.table);
      let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
      if (this.window) rows = rows.slice(...this.window);
      if (this.mode) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
  }
  return { calls, from: (t) => new Query(t), rpc: async () => ({ data: null, error: null }) };
}
const deps = (tables) => { const db = fakeDb(tables); return { db, getSupabaseAdmin: () => db }; };

test("school scope: the school comes from the database profile; a School Admin without one gets nothing", async () => {
  const d = deps({ profiles: PROFILES });
  assert.equal(await scope.requireRequesterSchool({ user: { id: A1 } }, d), S1, "loaded from the database, never the request");
  assert.equal(await scope.requireRequesterSchool({ user: { id: A2 }, profile: { role: "admin", school_id: S2 } }, d), S2);
  for (const who of [{ user: { id: SA } }, { user: { id: IL } }, { user: { id: id(999) } }, {}, null]) {
    await assert.rejects(scope.requireRequesterSchool(who, d), (e) => e.statusCode === 403, JSON.stringify(who));
  }
  assert.deepEqual([...(await scope.schoolMemberIds(S1, d))].sort(), [A1, T1, ST1].sort());
  assert.deepEqual([...(await scope.filterSchoolMembers(S1, [ST1, ST2, IL, "not-a-uuid", null], d))], [ST1]);
  await assert.rejects(scope.assertSchoolMember(S1, ST2, d), (e) => e.statusCode === 404, "another school's id answers not found");
  await scope.assertSchoolMember(S2, ST2, d);
});

test("shared content: only another school's owners are foreign; platform content and school-less requesters are unchanged", async () => {
  const d = deps({ profiles: PROFILES });
  assert.deepEqual([...(await scope.foreignSchoolOwners(requester(T1), [T1, T2, SA, IL], d))], [T2]);
  assert.deepEqual([...(await scope.foreignSchoolOwners(requester(ST2), [T1, T2, SA], d))], [T1]);
  assert.equal((await scope.foreignSchoolOwners(requester(IL), [T1, T2], d)).size, 0, "Independent Learners: unchanged");
  assert.equal((await scope.foreignSchoolOwners(requester(SA), [T1, T2], d)).size, 0, "System Admin: platform level");
});

test("F8 Create School: server-side validation, duplicate and permission errors mapped, never a raw database error", async () => {
  for (const input of [{}, { name: "A", code: "SCHOOL-2" }, { name: "Good Name", code: "x" }, { name: "Good Name", code: "bad code!" },
    { name: "Good Name", code: "SCHOOL-2", status: "deleted" }, { name: "n".repeat(121), code: "SCHOOL-2" }]) {
    assert.throws(() => schools.readSchoolInput(input), (e) => e.statusCode === 400, JSON.stringify(input));
  }
  assert.deepEqual(schools.readSchoolInput({ name: "  Mabini   Elementary ", code: " school-2 " }), { name: "Mabini Elementary", code: "SCHOOL-2", status: "active" });
  const rpcs = [];
  const make = (error) => ({ getSupabaseAdmin: () => ({ ...fakeDb({ schools: [], profiles: [] }), rpc: async (name, args) => { rpcs.push([name, args]); return error ? { data: null, error } : { data: S2, error: null }; } }) });
  for (const [message, status] of [["m1_school_duplicate_code", 409], ["m1_school_duplicate_name", 409], ["m1_school_actor_not_system_admin", 403],
    ["Could not find the function public.m1_create_school", 503], ["some private detail", 502]]) {
    await assert.rejects(schools.createSchool(SA, { name: "Mabini Elementary", code: "SCHOOL-2" }, make({ message })),
      (e) => e.statusCode === status && !/private detail/.test(e.message), message);
  }
  assert.deepEqual(rpcs[0], ["m1_create_school", { p_actor: SA, p_name: "Mabini Elementary", p_code: "SCHOOL-2", p_status: "active" }], "the actor is the signed-in System Admin");
  await assert.rejects(schools.updateSchool(SA, "not-a-uuid", { status: "inactive" }, make(null)), (e) => e.statusCode === 404);
  await assert.rejects(schools.updateSchool(SA, S2, {}, make(null)), (e) => e.statusCode === 400);
});

test("F8 routes: System Admin only; School Admins, Teachers and learners are refused before anything is read", async () => {
  const seen = [];
  const service = { listSchools: async () => { seen.push("list"); return [{ id: S1, name: "School 1" }]; },
    createSchool: async (actor, body) => { seen.push(["create", actor, body.code]); return { id: S2, ...body }; },
    updateSchool: async (actor, schoolId, body) => { seen.push(["update", actor, schoolId, body.status]); return { id: schoolId, ...body }; } };
  const run = async (role, fn) => {
    const app = express(); app.use(express.json());
    app.use("/s", createAdminSchoolsRouter({ schoolService: service, authorizeSystemAdminRequest: async () => {
      if (role !== "system_admin") throw new AdminAuthorizationError("System Admin access is required.");
      return { user: { id: SA }, profile: { role } };
    } }));
    const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/s`;
    try { await fn(base); } finally { server.close(); }
  };
  for (const role of ["admin", "teacher", "student", "general_user"]) {
    await run(role, async (base) => {
      assert.equal((await fetch(base)).status, 403, role);
      assert.equal((await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "X School", code: "XX" }) })).status, 403);
    });
  }
  assert.deepEqual(seen, [], "nothing read or written for other roles");
  await run("system_admin", async (base) => {
    assert.equal((await (await fetch(base)).json()).schools.length, 1);
    const created = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Mabini", code: "SCHOOL-2", actor: A1 }) });
    assert.equal(created.status, 201);
    assert.equal((await fetch(`${base}/${S2}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "inactive" }) })).status, 200);
  });
  assert.deepEqual(seen.slice(1), [["create", SA, "SCHOOL-2"], ["update", SA, S2, "inactive"]], "the actor comes from the session, never the body");
});

// ---- M2 F9/F10: School Admin rooms, packages and assignments stay inside the school ----
const ROOM1 = id(101), ROOM2 = id(102), PKG1 = id(201), PKG2 = id(202), VER1 = id(301), VER2 = id(302), ASG1 = id(401), ASG2 = id(402);
function m2Repository() {
  const rooms = [{ id: ROOM1, room_name: "Room One", teacher_id: T1 }, { id: ROOM2, room_name: "Room Two", teacher_id: T2 }];
  const packages = [{ id: PKG1, kind: "reassessment", audience: "classroom", scope: "school", owner_id: A1, language: "en", title: "School 1 package" },
    { id: PKG2, kind: "reassessment", audience: "classroom", scope: "school", owner_id: A2, language: "en", title: "School 2 package" }];
  const versions = [{ id: VER1, package_id: PKG1, status: "published", version_label: "1.0", version_number: 1 },
    { id: VER2, package_id: PKG2, status: "published", version_label: "1.0", version_number: 1 }];
  const assignments = [{ id: ASG1, kind: "classroom", status: "active", room_id: ROOM1, student_id: ST1, package_id: PKG1, package_version_id: VER1, language: "en" },
    { id: ASG2, kind: "classroom", status: "active", room_id: ROOM2, student_id: ST2, package_id: PKG2, package_version_id: VER2, language: "en" }];
  return {
    getSettings: async () => ({ official_reassessment_enabled: true }),
    listActiveRooms: async ({ teacherId } = {}) => rooms.filter((r) => !teacherId || r.teacher_id === teacherId),
    loadProfiles: async (ids) => PROFILES.filter((p) => ids.includes(p.id)),
    listPackages: async ({ scopes }) => packages.filter((p) => scopes.includes(p.scope)),
    listVersions: async (ids) => versions.filter((v) => ids.includes(v.package_id)),
    listEnrollments: async (ids) => [{ room_id: ROOM1, student_id: ST1 }, { room_id: ROOM2, student_id: ST2 }].filter((e) => ids.includes(e.room_id)),
    listAssignments: async ({ roomIds, studentIds } = {}) => assignments.filter((a) => (!roomIds || roomIds.includes(a.room_id)) && (!studentIds || studentIds.includes(a.student_id))),
    getAssignment: async (assignmentId) => assignments.find((a) => a.id === assignmentId) ?? null,
    cancelAssignment: async () => { throw new Error("must not be reached across schools"); },
    insertAssignments: async () => { throw new Error("must not be reached across schools"); },
    loadPackages: async (ids) => packages.filter((p) => ids.includes(p.id)),
    loadVersions: async (ids) => versions.filter((v) => ids.includes(v.id)),
    loadRooms: async (ids) => rooms.filter((r) => ids.includes(r.id)),
    getPackage: async (packageId) => packages.find((p) => p.id === packageId) ?? null,
  };
}
const bySchool = async (who, ids) => new Set(ids.filter((x) => PROFILES.find((p) => p.id === x)?.school_id === who.profile.school_id));

test("M2 F9: a School Admin sees and assigns only their own school's rooms, packages and assignments", async () => {
  const service = createReassessmentAssignmentService({ repository: m2Repository(), schoolFilter: bySchool });
  const one = await service.overview(requester(A1));
  assert.deepEqual(one.rooms.map((r) => r.id), [ROOM1]);
  assert.deepEqual(one.packages.map((p) => p.packageId), [PKG1]);
  const two = await service.overview(requester(A2));
  assert.deepEqual([two.rooms.map((r) => r.id), two.packages.map((p) => p.packageId)], [[ROOM2], [PKG2]]);
  await assert.rejects(service.roomRoster(requester(A1), ROOM2), (e) => e.statusCode === 404, "another school's room is not found");
  await assert.rejects(service.createAssignments(requester(A1), { roomId: ROOM2, packageVersionId: VER2, mode: "selected", studentIds: [ST2] }), (e) => e.statusCode === 404);
  await assert.rejects(service.createAssignments(requester(A1), { roomId: ROOM1, packageVersionId: VER2, mode: "selected", studentIds: [ST1] }), (e) => e.statusCode === 404,
    "another school's package is not offered");
  assert.deepEqual((await service.listAssignments(requester(A1))).assignments.map((a) => a.id), [ASG1]);
  assert.deepEqual((await service.listAssignments(requester(A1), { roomId: ROOM2 })).assignments, []);
  await assert.rejects(service.cancelAssignment(requester(A1), ASG2, { reason: "x" }), (e) => e.statusCode === 404);
  // Teachers are unchanged: their own rooms (same school by construction).
  assert.deepEqual((await service.overview(requester(T2))).rooms.map((r) => r.id), [ROOM2]);
});

test("M2 F10: a School Admin lists and opens only their own school's packages", async () => {
  const service = createAssessmentPackageService({ repository: m2Repository(), schoolFilter: bySchool });
  assert.deepEqual((await service.listPackages(requester(A1))).packages.map((p) => p.id), [PKG1]);
  assert.deepEqual((await service.listPackages(requester(A2))).packages.map((p) => p.id), [PKG2]);
  await assert.rejects(service.getPackage(requester(A1), PKG2), (e) => e.statusCode === 404, "another school's package is reported missing");
  await assert.rejects(service.renamePackage?.(requester(A1), PKG2, { title: "Hijack" }) ?? Promise.reject(Object.assign(new Error("n/a"), { statusCode: 404 })),
    (e) => e.statusCode === 404);
});

test("M5/M6 shared catalog: another school's published modules are invisible to Teachers and Students; platform modules stay", async () => {
  const PATH = id(600), M_OWN = id(501), M_OTHER = id(502), M_PLATFORM = id(503);
  const tables = {
    profiles: PROFILES,
    modules: [[M_OWN, T1], [M_OTHER, T2], [M_PLATFORM, SA]].map(([moduleId, owner]) => ({ id: moduleId, path_id: PATH, title: `Module ${moduleId.slice(-1)}`,
      status: "published", deleted_at: null, passage: "Ana walked to the river.", created_by: owner, difficulty: "Easy" })),
    learning_paths: [{ id: PATH, language: "English" }],
    module_passages: [],
    enrollments: [],
  };
  const d = deps(tables);
  const catalog = await listPracticeReadingPassages(requester(T1), d);
  assert.deepEqual(catalog.map((p) => p.moduleId).sort(), [M_OWN, M_PLATFORM].sort());
  const otherCatalog = await listPracticeReadingPassages(requester(T2), d);
  assert.deepEqual(otherCatalog.map((p) => p.moduleId).sort(), [M_OTHER, M_PLATFORM].sort());
  await assert.rejects(loadAccessiblePublishedModule(requester(ST1), M_OTHER, d, {}, { studentPersonal: true }), (e) => e.statusCode === 404);
  await assert.rejects(loadAccessiblePublishedModule(requester(T1), M_OTHER, d), (e) => e.statusCode === 404);
  const il = await loadAccessiblePublishedModule(requester(IL), M_OTHER, d).catch((e) => e);
  assert.notEqual(il?.statusCode, 404, "Independent Learners keep their previous access");
});
