// M2 F3: View Assessment Results and History. Synthetic data only; read-only service and route checks.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  HISTORY_COLUMNS, listOwnDiagnosticHistory, listTeacherDiagnosticResults,
} = require("../services/diagnosticHistoryService");
const { createDiagnosticHistoryRouter } = require("../routes/diagnosticHistory");
const { listAdminDiagnosticResults, listDiagnosticResultRows } = require("../services/adminDiagnosticResultService");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const SECRET_FIELDS = ["transcript", "oral_reading_metrics", "comprehensionAnswers", "verification_recording_id", "stt_confidence", "correctChoiceId"];

function result(id, userId, language, completedAt, extra = {}) {
  return {
    id, user_id: userId, assessment_type: "initial", language, assessment_id: `grade5-${language}-passage-v3`, assessment_version: "3.0",
    orv_score: 91.67, comprehension_score: 83.33, reading_level: "Instructional", difficulty_tier: "Medium", reading_speed_wpm: 100,
    completed_at: completedAt, verification_status: "server_verified",
    // Sensitive columns exist in the table; the services must never read or return them.
    transcript: "SECRET TRANSCRIPT", oral_reading_metrics: { comprehensionAnswers: { q1: "a" } }, verification_recording_id: "rec", stt_confidence: 0.9,
    ...extra,
  };
}

function fakeDb(tables) {
  const selects = [];
  return {
    selects,
    from(table) {
      const filters = [];
      let columns = "*";
      const query = {
        select(cols) { columns = cols; selects.push([table, cols]); return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        is(column, value) { filters.push((row) => (value === null ? row[column] == null : row[column] === value)); return query; },
        order() { return query; },
        then(resolve, reject) {
          const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
          const picked = columns === "*" ? rows : rows.map((row) => Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c]])));
          return Promise.resolve({ data: picked.map((row) => ({ ...row })), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const TABLES = {
  profiles: [
    { id: "s1", role: "student", full_name: "Ana Cruz", nickname: "Ana" },
    { id: "s2", role: "student", full_name: "Ben Reyes", nickname: null },
    { id: "s3", role: "student", full_name: "Other Room Student", nickname: null },
    { id: "s4", role: "student", full_name: "Unenrolled Student", nickname: null },
    { id: "il1", role: "general_user", full_name: "Independent Learner", nickname: "Indie" },
  ],
  rooms: [
    { id: "r1", room_name: "Grade 5 Mabini", teacher_id: "t1", archived_at: null },
    { id: "r2", room_name: "Grade 5 Rizal (2025)", teacher_id: "t1", archived_at: "2026-10-01T00:00:00Z" },
    { id: "r3", room_name: "Another Teacher's Room", teacher_id: "t2", archived_at: null },
  ],
  enrollments: [
    { room_id: "r1", student_id: "s1" }, { room_id: "r2", student_id: "s1" }, { room_id: "r2", student_id: "s2" },
    { room_id: "r3", student_id: "s3" },
    // An Independent Learner should never be enrolled; even if a row existed, it must not be shown.
    { room_id: "r1", student_id: "il1" },
  ],
  diagnostic_results: [
    result("d1", "s1", "en", "2026-11-10T01:00:00Z"),
    result("d2", "s1", "fil", "2026-11-12T01:00:00Z", { reading_level: "Frustration", orv_score: 80, comprehension_score: 100 }),
    result("d3", "s2", "en", "2026-11-11T01:00:00Z", { verification_status: "unverified" }),
    result("d4", "s3", "en", "2026-11-11T02:00:00Z"),
    result("d5", "s4", "fil", "2026-11-11T03:00:00Z"),
    result("d6", "il1", "en", "2026-11-13T01:00:00Z"),
    result("d7", "il1", "fil", "2026-11-09T01:00:00Z"),
  ],
};

const assertNoSecrets = (value) => {
  const text = JSON.stringify(value);
  for (const field of SECRET_FIELDS) assert.equal(text.includes(field), false, `must not expose ${field}`);
  assert.equal(text.includes("SECRET TRANSCRIPT"), false);
};

test("the history query reads only display columns (no transcript, metrics, answers or recording id)", () => {
  for (const field of ["transcript", "oral_reading_metrics", "verification_recording_id", "stt_confidence"]) {
    assert.equal(HISTORY_COLUMNS.includes(field), false, field);
  }
});

test("Student: own results only, both languages, newest first, safe fields only", async () => {
  const db = fakeDb(TABLES);
  const results = await listOwnDiagnosticHistory("s1", { getAdmin: () => db });
  assert.deepEqual(results.map((r) => [r.id, r.language]), [["d2", "fil"], ["d1", "en"]]);
  assert.deepEqual(Object.keys(results[0]).sort(), ["assessmentId", "assessmentType", "assessmentVersion", "comprehensionScore",
    "completedAt", "id", "language", "readingLevel", "verified", "wordRecognitionScore"].sort());
  assert.deepEqual(results[1], {
    id: "d1", assessmentType: "initial", language: "en", completedAt: "2026-11-10T01:00:00Z", wordRecognitionScore: 91.67,
    comprehensionScore: 83.33, readingLevel: "Instructional", assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0", verified: true,
  });
  assertNoSecrets(results);
});

test("Student self-access is unchanged by room archiving: an archived-room Student still sees their own results", async () => {
  const results = await listOwnDiagnosticHistory("s2", { getAdmin: () => fakeDb(TABLES) });
  assert.deepEqual(results.map((r) => [r.id, r.verified]), [["d3", false]], "own row, unverified label kept");
});

test("Independent Learner: strictly their own results", async () => {
  const results = await listOwnDiagnosticHistory("il1", { getAdmin: () => fakeDb(TABLES) });
  assert.deepEqual(results.map((r) => r.id), ["d6", "d7"]);
  assertNoSecrets(results);
  assert.deepEqual(await listOwnDiagnosticHistory("nobody", { getAdmin: () => fakeDb(TABLES) }), [], "no invented records");
});

const copyTables = () => structuredClone(TABLES);

test("Teacher, ACTIVE enrollment: only Students currently enrolled in the Teacher's own active rooms", async () => {
  const db = fakeDb(TABLES);
  const data = await listTeacherDiagnosticResults("t1", { getAdmin: () => db });
  assert.deepEqual(data.students.map((s) => s.id), ["s1"], "Ana only");
  const ana = data.students[0];
  assert.equal(ana.name, "Ana");
  assert.deepEqual(ana.rooms, [{ id: "r1", name: "Grade 5 Mabini" }], "the archived room is not listed");
  assert.deepEqual(ana.results.map((r) => r.id), ["d2", "d1"], "newest first");
  // The archive filter is part of the SERVER query, not only a later in-memory step.
  assert.ok(db.selects.some(([table]) => table === "rooms"));
  const ids = JSON.stringify(data);
  for (const hidden of ["s2", "s3", "s4", "il1", "d3", "d4", "d5", "d6", "d7", "r2"]) assert.equal(ids.includes(`"${hidden}"`), false, hidden);
  assertNoSecrets(data);
});

test("Teacher, ARCHIVED room: a Student enrolled only in an archived room gives no access, including to results completed after archiving", async () => {
  const tables = copyTables();
  tables.diagnostic_results.push(result("d8", "s2", "fil", "2026-11-18T01:00:00Z")); // new result after the room was archived
  const data = await listTeacherDiagnosticResults("t1", { getAdmin: () => fakeDb(tables) });
  assert.deepEqual(data.students.map((s) => s.id), ["s1"]);
  assert.equal(JSON.stringify(data).includes('"d8"'), false);
  // Every room archived: the Teacher sees no Students at all.
  tables.rooms.find((room) => room.id === "r1").archived_at = "2026-11-15T00:00:00Z";
  assert.deepEqual(await listTeacherDiagnosticResults("t1", { getAdmin: () => fakeDb(tables) }), { students: [] });
});

test("Teacher, archived-room filter is re-checked in code even if the query layer ignored it", async () => {
  const db = fakeDb(TABLES);
  const loose = { from: (table) => { const q = db.from(table); q.is = () => q; return q; } }; // a query layer that drops .is()
  const data = await listTeacherDiagnosticResults("t1", { getAdmin: () => loose });
  assert.deepEqual(data.students.map((s) => s.id), ["s1"]);
  assert.deepEqual(data.students[0].rooms.map((r) => r.id), ["r1"]);
});

test("Teacher, RESTORED room: access returns only while the room is active again", async () => {
  const tables = copyTables();
  tables.rooms.find((room) => room.id === "r2").archived_at = null;
  const data = await listTeacherDiagnosticResults("t1", { getAdmin: () => fakeDb(tables) });
  assert.deepEqual(data.students.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(data.students[0].rooms.map((r) => r.id), ["r1", "r2"]);
});

test("Teacher, REMOVED enrollment: a Student removed from the active room is no longer visible", async () => {
  const tables = copyTables();
  tables.enrollments = tables.enrollments.filter((e) => !(e.room_id === "r1" && e.student_id === "s1")); // removal deletes the row
  const data = await listTeacherDiagnosticResults("t1", { getAdmin: () => fakeDb(tables) });
  assert.deepEqual(data.students.map((s) => s.id), [], "Ana now remains only in the archived room");
});

test("Teacher, UNRELATED enrollments: other Teachers' rooms, unenrolled Students and Independent Learners are never shown", async () => {
  const data = await listTeacherDiagnosticResults("t1", { getAdmin: () => fakeDb(TABLES) });
  const ids = JSON.stringify(data);
  for (const hidden of ["s3", "s4", "il1", "d4", "d5", "d6", "d7"]) assert.equal(ids.includes(`"${hidden}"`), false, hidden);
});

test("Teacher with no rooms, or another Teacher, sees nothing of t1's Students", async () => {
  assert.deepEqual(await listTeacherDiagnosticResults("t9", { getAdmin: () => fakeDb(TABLES) }), { students: [] });
  const other = await listTeacherDiagnosticResults("t2", { getAdmin: () => fakeDb(TABLES) });
  assert.deepEqual(other.students.map((s) => s.id), ["s3"]);
});

test("School Admin list: every assessment type with type and version; Independent Learners never shown", async () => {
  const db = fakeDb(TABLES);
  const users = TABLES.profiles.map((p) => ({ id: p.id, role: p.role, nickname: p.nickname, fullName: p.full_name, email: `${p.id}@example.invalid` }));
  const rows = await listAdminDiagnosticResults({ getSupabaseAdmin: () => db, listManagedUsers: async () => users }, "admin");
  assert.equal(rows.some((row) => row.role === "general_user" || ["d6", "d7"].includes(row.id)), false);
  assert.ok(rows.every((row) => row.assessmentType === "initial" && row.assessmentVersion === "3.0"));
  assert.equal(db.selects.some(([table, cols]) => table === "diagnostic_results" && /transcript|oral_reading_metrics|verification_recording_id/.test(cols)), false);
  await assert.rejects(listAdminDiagnosticResults({ getSupabaseAdmin: () => db, listManagedUsers: async () => users }, "system_admin"));
  await assert.rejects(listAdminDiagnosticResults({ getSupabaseAdmin: () => db, listManagedUsers: async () => users }, "teacher"));
  assert.equal(typeof listDiagnosticResultRows, "function");
});

// ---- Routes: server-side role checks for every role ----
const PROFILES = {
  student: { id: "s1", role: "student" },
  il: { id: "il1", role: "general_user" },
  teacher: { id: "t1", role: "teacher", teacher_status: "approved" },
  pending: { id: "t3", role: "teacher", teacher_status: "pending" },
  admin: { id: "a1", role: "admin" },
  sysadmin: { id: "sa1", role: "system_admin" },
};
const learnerAuth = (req) => {
  const p = PROFILES[(req.get("authorization") || "").replace("Bearer ", "")];
  if (!p) throw new SupabaseAuthenticationError();
  if (!["student", "general_user"].includes(p.role)) throw Object.assign(new Error("This oral-reading activity is not available to your account."), { statusCode: 403 });
  return { user: { id: p.id }, profile: p };
};
const teacherAuth = (req) => {
  const p = PROFILES[(req.get("authorization") || "").replace("Bearer ", "")];
  if (!p) throw new SupabaseAuthenticationError();
  if (p.role !== "teacher" || p.teacher_status !== "approved") throw Object.assign(new Error("Approved Teacher access is required."), { statusCode: 403 });
  return { user: { id: p.id }, profile: p };
};

async function startRouter(t, overrides = {}) {
  const app = express();
  const db = fakeDb(TABLES);
  app.use("/api/diagnostic-history", createDiagnosticHistoryRouter({
    authorizeLearner: learnerAuth, authorizeTeacher: teacherAuth,
    listOwn: (id) => listOwnDiagnosticHistory(id, { getAdmin: () => db }),
    listTeacher: (id) => listTeacherDiagnosticResults(id, { getAdmin: () => db }),
    log: () => {}, ...overrides,
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/diagnostic-history`;
  return async (path, token) => {
    const response = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
}

test("GET /me: Students and Independent Learners get only their own results; every other role is refused", async (t) => {
  const get = await startRouter(t);
  const student = await get("/me", "student");
  assert.equal(student.status, 200);
  assert.equal(student.cache, "no-store");
  assert.deepEqual(student.body.results.map((r) => r.id), ["d2", "d1"]);
  const il = await get("/me", "il");
  assert.deepEqual(il.body.results.map((r) => r.id), ["d6", "d7"]);
  assertNoSecrets([student.body, il.body]);
  assert.equal((await get("/me")).status, 401);
  for (const token of ["teacher", "pending", "admin", "sysadmin"]) assert.equal((await get("/me", token)).status, 403, token);
});

test("GET /teacher: only approved Teachers; Students, Independent Learners, pending Teachers, School Admin and System Admin are refused", async (t) => {
  const get = await startRouter(t);
  const teacher = await get("/teacher", "teacher");
  assert.equal(teacher.status, 200);
  assert.deepEqual(teacher.body.students.map((s) => s.id), ["s1"], "active-room enrollment only (s2 is only in an archived room)");
  assert.deepEqual(teacher.body.students[0].rooms, [{ id: "r1", name: "Grade 5 Mabini" }]);
  assertNoSecrets(teacher.body);
  assert.equal((await get("/teacher")).status, 401);
  for (const token of ["student", "il", "pending", "admin", "sysadmin"]) assert.equal((await get("/teacher", token)).status, 403, token);
});

test("server failures return a generic message without internal details", async (t) => {
  const get = await startRouter(t, { listOwn: async () => { throw new Error("relation diagnostic_results secret detail"); } });
  const response = await get("/me", "student");
  assert.equal(response.status, 500);
  assert.equal(response.body.message, "Unable to load diagnostic results.");
});
