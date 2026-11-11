const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { listEnrolledRoomTeachers, teacherDisplayName } = require("../services/studentRoomTeachers");
const { createStudentClassroomsRouter } = require("../routes/studentClassrooms");

// A minimal in-memory stand-in for the service-role query builder used by the service.
function fakeDb(tables, log = []) {
  return {
    from(table) {
      const filters = [];
      let columns = "*";
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)))
        .map((row) => (columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c]]))));
      const q = {
        select(c) { columns = c; log.push({ table, columns: c }); return q; },
        eq(c, v) { filters.push((row) => row[c] === v); return q; },
        in(c, vs) { filters.push((row) => vs.includes(row[c])); return q; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve) { return Promise.resolve({ data: rows(), error: null }).then(resolve); },
      };
      return q;
    },
  };
}

const LONG = "Maria Clara Concepcion de los Santos-Villanueva y Bautista Dela Cruz";
const tables = {
  profiles: [
    { id: "stu", role: "student", full_name: null, nickname: "Ana", email: "ana@example.test" },
    { id: "other-stu", role: "student", full_name: "Other Student" },
    { id: "t1", role: "teacher", full_name: "  Rosa   Mendoza ", email: "rosa@example.test", teacher_status: "approved" },
    { id: "t2", role: "teacher", full_name: LONG, teacher_status: "approved" },
    { id: "t3", role: "teacher", full_name: "New User", teacher_status: "approved" },
    { id: "t4", role: "teacher", full_name: "", teacher_status: "approved" },
    { id: "t5", role: "teacher", full_name: "Not My Teacher", teacher_status: "approved" },
    { id: "adm", role: "admin", full_name: "Admin Creator" },
  ],
  // Admin-created rooms store the ASSIGNED Teacher in teacher_id (m4_admin_create_room); no creator column exists.
  rooms: [
    { id: "r-teacher", teacher_id: "t1", room_name: "Teacher-created" },
    { id: "r-admin", teacher_id: "t2", room_name: "Admin-created" },
    { id: "r-newuser", teacher_id: "t3", room_name: "Placeholder name" },
    { id: "r-blank", teacher_id: "t4", room_name: "Blank name" },
    { id: "r-admin-owner", teacher_id: "adm", room_name: "Owner is not a Teacher" },
    { id: "r-unenrolled", teacher_id: "t5", room_name: "Not enrolled" },
  ],
  enrollments: ["r-teacher", "r-admin", "r-newuser", "r-blank", "r-admin-owner"].map((room_id) => ({ room_id, student_id: "stu" }))
    .concat([{ room_id: "r-unenrolled", student_id: "other-stu" }]),
};
const deps = (userId, log) => ({ getAuthenticatedSupabaseUser: async () => ({ id: userId }), getSupabaseAdmin: () => fakeDb(tables, log) });

test("Students get the assigned Teacher's full name for each of their own enrolled rooms only", async () => {
  const log = [];
  const rooms = await listEnrolledRoomTeachers({}, deps("stu", log));
  const byRoom = Object.fromEntries(rooms.map((r) => [r.roomId, r.teacherName]));
  assert.deepEqual(Object.keys(byRoom).sort(), ["r-admin", "r-admin-owner", "r-blank", "r-newuser", "r-teacher"]);
  assert.equal(byRoom["r-teacher"], "Rosa Mendoza", "Teacher-created room: whitespace normalized");
  assert.equal(byRoom["r-admin"], LONG, "Admin-created room shows the assigned Teacher, long name intact");
  assert.equal(byRoom["r-newuser"], null, "placeholder profile name is not shown");
  assert.equal(byRoom["r-blank"], null, "empty name falls back");
  assert.equal(byRoom["r-admin-owner"], null, "a non-Teacher profile's name is never returned");
  assert.ok(!("r-unenrolled" in byRoom), "rooms the Student is not enrolled in are excluded");
  assert.ok(rooms.every((r) => Object.keys(r).sort().join() === "roomId,teacherName"), "only room id and display name are returned");
  assert.ok(!JSON.stringify(rooms).includes("@"), "no e-mail address");
  const teacherLookup = log.filter((q) => q.table === "profiles" && q.columns.includes("full_name"));
  assert.deepEqual(teacherLookup.map((q) => q.columns), ["id, full_name"], "Teacher lookup selects only id and full_name");
});

test("non-Students are refused and Students without enrollments get an empty list", async () => {
  for (const id of ["t1", "adm"]) {
    await assert.rejects(listEnrolledRoomTeachers({}, deps(id)), (e) => e.statusCode === 403);
  }
  await assert.rejects(listEnrolledRoomTeachers({}, deps("missing")), (e) => e.statusCode === 403);
  const lonely = { ...tables, profiles: [...tables.profiles, { id: "new-stu", role: "student" }] };
  assert.deepEqual(await listEnrolledRoomTeachers({}, { getAuthenticatedSupabaseUser: async () => ({ id: "new-stu" }), getSupabaseAdmin: () => fakeDb(lonely) }), []);
});

test("teacherDisplayName never invents a name", () => {
  assert.equal(teacherDisplayName("  Ana  Reyes "), "Ana Reyes");
  for (const value of [null, undefined, "", "   ", "new user", "NEW USER", 42]) assert.equal(teacherDisplayName(value), null);
});

test("HTTP: GET /api/classrooms/teachers is session-authenticated and Student-only", async () => {
  const serve = async (dependencies) => {
    const app = express(); app.use("/api/classrooms", createStudentClassroomsRouter(dependencies));
    const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/classrooms/teachers`);
      return { status: res.status, body: await res.json() };
    } finally { await new Promise((r) => server.close(r)); }
  };
  const ok = await serve(deps("stu"));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.rooms.find((r) => r.roomId === "r-teacher").teacherName, "Rosa Mendoza");
  assert.equal((await serve(deps("t1"))).status, 403);
  const unauth = await serve({ getAuthenticatedSupabaseUser: async () => { throw new SupabaseAuthenticationError(); }, getSupabaseAdmin: () => fakeDb(tables) });
  assert.equal(unauth.status, 401);
  assert.doesNotMatch(JSON.stringify(unauth.body), /stack|service_role/i);
});
