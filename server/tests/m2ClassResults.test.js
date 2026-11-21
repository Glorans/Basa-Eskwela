// M2 F3/F5 class views (2026-11-21): the School Admin list carries each Student's ACTIVE Learning Rooms for the room
// filter, with the same scope as before (Students only, single-school pilot). In-memory database, synthetic people.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const { LIVE_FIXTURE } = require("../../supabase/tests/fixtures/liveDiagnosticFixture.cjs");
const { createPgliteSupabase } = require("./helpers/pgliteSupabase");
const { listSchoolStudentResults, listTeacherDiagnosticResults } = require("../services/diagnosticHistoryService");

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = uid(1), T2 = uid(2), ANA = uid(3), BEN = uid(4), CARA = uid(5), LIA = uid(6);
const A = uid(50), B = uid(51), OLD = uid(52);
const SCH1 = uid(60), SCH2 = uid(61), T9 = uid(9), ZED = uid(10), Z = uid(53);

async function setup() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [id, role, status, name] of [[T1, "teacher", "approved", "Tess"], [T2, "teacher", "approved", "Tom"], [ANA, "student", null, "Ana"],
    [BEN, "student", null, "Ben"], [CARA, "student", null, "Cara"], [LIA, "general_user", null, "Lia"]]) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role, teacher_status, full_name, nickname) values ($1, $2, $3, $4, $4)", [id, role, status, name]);
  }
  await d.query("insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Sampaguita', 'A'), ($3, $4, 'Narra', 'B')", [A, T1, B, T2]);
  await d.query("insert into rooms(id, teacher_id, room_name, room_code, archived_at, archived_by) values ($1, $2, 'Old Room', 'C', now(), $2)", [OLD, T1]);
  for (const [room, student] of [[A, ANA], [B, ANA], [A, BEN], [OLD, CARA], [A, LIA]]) {
    await d.query("insert into enrollments(room_id, student_id) values ($1, $2)", [room, student]);
  }
  await d.query(`insert into diagnostic_results(id, user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
    verification_status, verification_method, verification_recording_id, verified_at)
    values ($1, $2, 'en', 'grade5-en-passage-v3', '3.0', 90, 66.7, 'Instructional', 'Medium', 'server_verified', 'server_stt_receipt_v1', $3, now())`, [uid(100), ANA, uid(200)]);
  // M1 multi-tenancy: everyone above is in School 1 (the Independent Learner has no school); School 2 has its own
  // Teacher, room and Student, who must never appear in School 1's list.
  await d.query("alter table profiles add column if not exists school_id uuid");
  await d.query("update profiles set school_id = $1 where role in ('teacher', 'student')", [SCH1]);
  for (const [id, role, status, name] of [[T9, "teacher", "approved", "Other Teacher"], [ZED, "student", null, "Zed"]]) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role, teacher_status, full_name, nickname, school_id) values ($1, $2, $3, $4, $4, $5)", [id, role, status, name, SCH2]);
  }
  await d.query("insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Other School Room', 'Z')", [Z, T9]);
  await d.query("insert into enrollments(room_id, student_id) values ($1, $2)", [Z, ZED]);
  return createPgliteSupabase(d);
}

test("School Admin list: each Student with their ACTIVE rooms; a Student in no active room is still listed; Independent Learners never", async () => {
  const db = await setup();
  const students = await listSchoolStudentResults({ getAdmin: () => db, schoolId: SCH1 });
  assert.deepEqual(students.map((s) => [s.name, s.rooms.map((r) => r.name)]), [["Ana", ["Narra", "Sampaguita"]], ["Ben", ["Sampaguita"]], ["Cara", []]],
    "archived rooms are left out; Lia (Independent Learner) and School 2's Zed are not listed");
  const other = await listSchoolStudentResults({ getAdmin: () => db, schoolId: SCH2 });
  assert.deepEqual(other.map((s) => [s.name, s.rooms.map((r) => r.name)]), [["Zed", ["Other School Room"]]], "School 2 sees only School 2");
  await assert.rejects(listSchoolStudentResults({ getAdmin: () => db }), (e) => e.statusCode === 403, "no school: nothing");
  assert.equal(students[0].results.length, 1);
  assert.equal(JSON.stringify(students).includes("room_code"), false, "only room ids and names");
});

test("Teacher list is unchanged: own active rooms only", async () => {
  const db = await setup();
  const { students } = await listTeacherDiagnosticResults(T1, { getAdmin: () => db });
  assert.deepEqual(students.map((s) => [s.name, s.rooms.map((r) => r.name)]), [["Ana", ["Sampaguita"]], ["Ben", ["Sampaguita"]]], "Narra is Tom's room; Cara's room is archived");
});
