// M2 F9 Assign Reassessment: service + router against the REAL proposed SQL (packages + reassessment foundation) on a
// copy of the live diagnostic_results/rooms/enrollments shape, in disposable in-memory PostgreSQL (PGlite).
// The repository runs as service_role, so the migration's grants are exercised too. Never connects to Supabase.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { LIVE_FIXTURE } = require("../../supabase/tests/fixtures/liveDiagnosticFixture.cjs");
const { createReassessmentAssignmentService } = require("../services/reassessmentAssignmentService");
const { createReassessmentsRouter } = require("../routes/reassessments");

const sql = (f) => readFileSync(resolve(__dirname, "../../supabase/proposed", f), "utf8");
const PACKAGES = sql("m2_assessment_packages_PROPOSED.sql");
const FOUNDATION = sql("m2_reassessment_foundation_PROPOSED.sql");
const F10 = sql("m2_f10_direct_publish_PROPOSED.sql");
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = {
  sa: [uid(1), "system_admin", null, "Sys Admin"], admin: [uid(2), "admin", null, "School Admin"],
  teacher: [uid(3), "teacher", "approved", "Teacher One"], other: [uid(4), "teacher", "approved", "Teacher Two"],
  pending: [uid(5), "teacher", "pending", "Pending Teacher"], s1: [uid(6), "student", null, "Ana"], s2: [uid(7), "student", null, "Ben"],
  s3: [uid(8), "student", null, "Carla"], outsider: [uid(9), "student", null, "Dan"], learner: [uid(10), "general_user", null, "Solo"],
  s4: [uid(11), "student", null, "Eli"],
};
const ROOM_A = uid(50), ROOM_B = uid(51), ARCHIVED = uid(52);
const as = (key) => ({ user: { id: P[key][0] }, profile: { id: P[key][0], role: P[key][1], teacher_status: P[key][2] } });

function pgliteRepository(d) {
  const all = async (q, params) => (await d.query(q, params)).rows;
  return {
    getSettings: async () => (await all("select official_reassessment_enabled from m2_reassessment_settings"))[0] ?? null,
    listActiveRooms: ({ teacherId } = {}) => (teacherId
      ? all("select * from rooms where archived_at is null and teacher_id = $1", [teacherId])
      : all("select * from rooms where archived_at is null")),
    listEnrollments: (ids) => all("select room_id, student_id from enrollments where room_id = any($1)", [ids]),
    loadProfiles: (ids) => all("select id, role, teacher_status, full_name, nickname from profiles where id = any($1)", [ids]),
    listPackages: ({ scopes, ownerId }) => (ownerId
      ? all("select * from m2_assessment_packages where kind = 'reassessment' and audience = 'classroom' and scope = any($1) and owner_id = $2", [scopes, ownerId])
      : all("select * from m2_assessment_packages where kind = 'reassessment' and audience = 'classroom' and scope = any($1)", [scopes])),
    listVersions: (ids) => all("select id, package_id, version_label, status from m2_assessment_package_versions where package_id = any($1)", [ids]),
    listReviews: (ids) => all("select id, version_id, outcome, reviewed_on, recorded_at from m2_assessment_educator_reviews where version_id = any($1)", [ids]),
    listAssignments: ({ roomIds, studentIds, statuses } = {}) => {
      const where = ["kind = 'classroom'"]; const params = [];
      if (statuses) { params.push(statuses); where.push(`status = any($${params.length})`); }
      if (roomIds) { params.push(roomIds); where.push(`room_id = any($${params.length})`); }
      if (studentIds) { params.push(studentIds); where.push(`student_id = any($${params.length})`); }
      return all(`select * from m2_reassessment_assignments where ${where.join(" and ")}`, params);
    },
    getAssignment: async (id) => (await all("select * from m2_reassessment_assignments where id = $1", [id]))[0] ?? null,
    loadRooms: (ids) => all("select * from rooms where id = any($1)", [ids]),
    loadPackages: (ids) => all("select * from m2_assessment_packages where id = any($1)", [ids]),
    loadVersions: (ids) => all("select id, package_id, version_label, status from m2_assessment_package_versions where id = any($1)", [ids]),
    // ONE statement for the whole batch (as the Supabase repository's single multi-row insert).
    insertAssignments: (list) => {
      const cols = ["package_version_id", "package_id", "language", "kind", "room_id", "student_id", "assigned_by", "due_at"];
      const params = []; const tuples = list.map((row) => `(${cols.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(", ")})`);
      return all(`insert into m2_reassessment_assignments(${cols.join(", ")}) values ${tuples.join(", ")} returning *`, params);
    },
    cancelAssignment: (id, by, reason) => all(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = $3
      where id = $1 and status = 'active' returning *`, [id, by, reason]),
  };
}

async function setup({ gate = true } = {}) {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [id, role, status, name] of Object.values(P)) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role, teacher_status, full_name, nickname) values ($1, $2, $3, $4, $4)", [id, role, status, name]);
  }
  await d.query("insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Room A', 'A'), ($3, $4, 'Room B', 'B')", [ROOM_A, P.teacher[0], ROOM_B, P.other[0]]);
  await d.query("insert into rooms(id, teacher_id, room_name, room_code, archived_at, archived_by) values ($1, $2, 'Old Room', 'C', now(), $2)", [ARCHIVED, P.teacher[0]]);
  for (const [room, s] of [[ROOM_A, "s1"], [ROOM_A, "s2"], [ROOM_A, "s3"], [ROOM_B, "outsider"], [ROOM_B, "s1"], [ARCHIVED, "s2"]]) {
    await d.query("insert into enrollments(room_id, student_id) values ($1, $2)", [room, P[s][0]]);
  }
  await d.exec(PACKAGES);
  await d.exec(FOUNDATION);
  await d.exec(F10);
  if (gate) await d.exec("update m2_reassessment_settings set official_reassessment_enabled = true");
  await d.exec("set role service_role");
  const service = createReassessmentAssignmentService({ repository: pgliteRepository(d), now: () => new Date("2026-11-19T04:00:00Z"), schoolFilter: async (_requester, ids) => new Set(ids.filter(Boolean)) });
  return { d, service, repo: pgliteRepository(d) };
}

const QUESTIONS = ["literal", "literal", "inferential", "inferential", "inferential", "critical"].map((type, i) => ({
  id: `q${i + 1}`, type, prompt: `Q${i + 1}?`, correctChoiceId: "a", choices: ["a", "b", "c", "d"].map((c) => ({ id: c, label: c })) }));
const PARAGRAPHS = ["Ana walked to the river with her small brown dog early in the morning.", "They watched the fish swim under the old bridge until the sun was high and warm."];

/** Creates a package (as the database superuser) taken to `upTo`, optionally endorsed. Returns the version id. */
async function pkg(d, { scope = "teacher", owner = P.teacher[0], language = "en", title = "Package", upTo = "published", endorse = true, archive = false } = {}) {
  await d.exec("reset role");
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ('reassessment','classroom',$1,$2,$3,$4) returning id`, [scope, owner, language, title]);
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 1, '1.0', $2, 'Story', $3, $4) returning id`, [p.id, owner, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  const steps = ["in_review", "approved", "published"];
  for (const step of steps.slice(0, steps.indexOf(upTo) + 1)) {
    if (step === "in_review") await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, owner]);
    if (step === "approved") await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library' where id = $1`, [v.id, P.admin[0]]);
    if (step === "published") await d.query("select m2_publish_assessment_version($1, $2)", [v.id, owner]);
  }
  if (upTo === "direct") await d.query("select m2_publish_assessment_version($1, $2)", [v.id, owner]);
  if (endorse && !["draft", "direct"].includes(upTo)) {
    await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
      answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'Reviewer', 'Teacher (stated)', '2026-11-18', true, true, true, true, 'endorsed', $2)`, [v.id, P.admin[0]]);
  }
  if (archive) await d.query("update m2_assessment_packages set archived_at = now() where id = $1", [p.id]);
  await d.exec("set role service_role");
  return v.id;
}
const refused = (promise, status, code) => assert.rejects(promise, (e) => {
  assert.equal(e.statusCode, status, `${e.code}: ${e.message}`);
  if (code) assert.equal(e.code, code, e.message);
  return true;
});
const count = async (d) => (await d.query("select count(*)::int n from m2_reassessment_assignments")).rows[0].n;

test("only School Admins and approved Teachers: System Admin, Students, Independent Learners and pending Teachers are refused", async () => {
  const { service } = await setup();
  for (const key of ["sa", "s1", "learner", "pending"]) {
    await refused(service.overview(as(key)), 403, "ASSIGNMENT_FORBIDDEN");
    await refused(service.createAssignments(as(key), { roomId: ROOM_A }), 403, "ASSIGNMENT_FORBIDDEN");
    await refused(service.listAssignments(as(key)), 403, "ASSIGNMENT_FORBIDDEN");
    await refused(service.cancelAssignment(as(key), uid(999), { reason: "x" }), 403, "ASSIGNMENT_FORBIDDEN");
    await refused(service.roomRoster(as(key), ROOM_A), 403, "ASSIGNMENT_FORBIDDEN");
  }
  await refused(service.overview(null), 403);
});

test("default gate OFF: the page reports it, the service refuses, and the database refuses even a direct insert", async () => {
  const { d, service, repo } = await setup({ gate: false });
  const v = await pkg(d);
  const overview = await service.overview(as("teacher"));
  assert.equal(overview.enabled, false);
  assert.equal(overview.packages[0].eligible, true, "the package itself is ready; only the gate blocks");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0]] }), 409, "REASSESSMENT_NOT_ENABLED");
  await assert.rejects(repo.insertAssignments([{ package_version_id: v, package_id: null, language: "en", kind: "classroom", room_id: ROOM_A,
    student_id: P.s2[0], assigned_by: P.teacher[0], due_at: null }]), /Reassessment is not enabled/);
  assert.equal(await count(d), 0);
  // The backend role cannot switch the gate on.
  await assert.rejects(d.query("update m2_reassessment_settings set official_reassessment_enabled = true"), /permission denied/);
});

test("Teacher sees only own active rooms and own private packages, each with the reason when not assignable", async () => {
  const { d, service } = await setup();
  const ok = await pkg(d, { title: "A ready" });
  await pkg(d, { title: "B unendorsed", endorse: false });
  const direct = await pkg(d, { title: "F published directly", upTo: "direct" });
  await pkg(d, { title: "C draft", upTo: "draft" });
  await pkg(d, { title: "D approved only", upTo: "approved" });
  await pkg(d, { title: "E archived", archive: true });
  await pkg(d, { title: "Other teacher's", owner: P.other[0] });
  await pkg(d, { title: "School package", scope: "school", owner: P.admin[0] });
  const o = await service.overview(as("teacher"));
  assert.deepEqual(o.rooms.map((r) => r.name), ["Room A"], "no archived room, no other Teacher's room");
  assert.deepEqual(o.packages.map((p) => [p.title, p.eligible, p.reason]), [
    ["A ready", true, null], ["B unendorsed", true, null], ["F published directly", true, null], ["C draft", false, "Not published in the library"],
    ["D approved only", false, "Not published in the library"], ["E archived", false, "Archived"]],
    "F10: published is enough; no educator endorsement");
  const directRoster = await service.roomRoster(as("teacher"), ROOM_A, direct);
  assert.ok(directRoster.students.length > 0);
  assert.equal(o.packages[0].versionId, ok);
  assert.doesNotMatch(JSON.stringify(o), /Other teacher's|School package|correctChoiceId|paragraphs/);
  const roster = await service.roomRoster(as("teacher"), ROOM_A, ok);
  assert.deepEqual(roster.students.map((s) => [s.name, s.reason]), [["Ana", null], ["Ben", null], ["Carla", null]]);
  await refused(service.roomRoster(as("teacher"), ROOM_B), 404, "ROOM_NOT_FOUND");
  await refused(service.roomRoster(as("teacher"), ARCHIVED), 404, "ROOM_NOT_FOUND");
});

test("School Admin: all active rooms (single school); school packages only — Teachers' private packages are never offered or assignable (F10)", async () => {
  const { d, service } = await setup();
  const school = await pkg(d, { scope: "school", owner: P.admin[0], title: "School story" });
  const teachers = await pkg(d, { title: "Teacher One story" });
  const o = await service.overview(as("admin"));
  assert.deepEqual(o.rooms.map((r) => [r.name, r.teacherName]), [["Room A", "Teacher One"], ["Room B", "Teacher Two"]]);
  assert.deepEqual(o.packages.map((p) => p.title), ["School story"], "no Teacher package is listed for the School Admin");
  for (const room of [ROOM_A, ROOM_B]) {
    assert.deepEqual((await service.assignablePackagesForRoom(as("admin"), room)).packages.map((p) => [p.title, p.eligible]), [["School story", true]]);
  }
  // Server: a Teacher's package id is treated as unknown, even in that Teacher's own room.
  await refused(service.createAssignments(as("admin"), { roomId: ROOM_A, packageVersionId: teachers, studentIds: [P.s2[0]] }), 404, "PACKAGE_NOT_FOUND");
  await refused(service.roomRoster(as("admin"), ROOM_A, teachers), 404, "PACKAGE_NOT_FOUND");
  // Database (m2_f10_direct_publish): refused even if the server check were bypassed.
  await assert.rejects(d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, room_id, student_id, assigned_by)
    select id, package_id, 'en', 'classroom', $2, $3, $4 from m2_assessment_package_versions where id = $1`, [teachers, ROOM_A, P.s2[0], P.admin[0]]),
  /School Admin for school packages/);
  assert.equal(await count(d), 0);
  const inBSchool = await service.createAssignments(as("admin"), { roomId: ROOM_B, packageVersionId: school, studentIds: [P.outsider[0]] });
  assert.equal(inBSchool.assignments[0].assignedBy, "School Admin");
  // The Teacher still assigns their own package in their own room; Teachers are not offered school packages.
  assert.equal((await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: teachers, studentIds: [P.s2[0]] })).created, 1);
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: school, studentIds: [P.s3[0]] }), 404, "PACKAGE_NOT_FOUND");
});

test("Teacher assigns selected Students with a due date (end of the day in Manila); ownership and room are enforced", async () => {
  const { d, service } = await setup();
  const v = await pkg(d);
  const otherV = await pkg(d, { owner: P.other[0] });
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_B, packageVersionId: v, studentIds: [P.outsider[0]] }), 404, "ROOM_NOT_FOUND");
  await refused(service.createAssignments(as("teacher"), { roomId: ARCHIVED, packageVersionId: v, studentIds: [P.s2[0]] }), 404, "ROOM_NOT_FOUND");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: otherV, studentIds: [P.s2[0]] }), 404, "PACKAGE_NOT_FOUND");
  await refused(service.createAssignments(as("other"), { roomId: ROOM_B, packageVersionId: v, studentIds: [P.outsider[0]] }), 404, "PACKAGE_NOT_FOUND");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0]], dueDate: "2026-11-18" }), 400, "INVALID_DUE_DATE");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0]], dueDate: "soon" }), 400, "INVALID_DUE_DATE");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [] }), 400, "STUDENTS_REQUIRED");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: ["x"] }), 400, "INVALID_STUDENT");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: "x", studentIds: [P.s2[0]] }), 400, "PACKAGE_REQUIRED");
  const r = await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0], P.s3[0], P.s2[0]], dueDate: "2026-11-19" });
  assert.equal(r.created, 2, "duplicates in one request are collapsed");
  const row = (await d.query("select due_at, language, kind, assigned_by from m2_reassessment_assignments limit 1")).rows[0];
  assert.equal(new Date(row.due_at).toISOString(), "2026-11-19T15:59:59.000Z", "23:59:59 Philippine time");
  assert.deepEqual([row.language, row.kind, row.assigned_by], ["en", "classroom", P.teacher[0]]);
});

test("selected Students are all-or-nothing; the reasons are returned and nothing is created", async () => {
  const { d, service } = await setup();
  const v = await pkg(d);
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0], P.outsider[0]] }), 409, "STUDENTS_INELIGIBLE");
  try {
    await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0], P.outsider[0]] });
  } catch (e) {
    assert.deepEqual(e.ineligible.map((x) => [x.studentId, x.name, x.reason]), [[P.outsider[0], null, "Not currently enrolled in this Learning Room"]],
      "another room's Student is not named");
  }
  assert.equal(await count(d), 0);
});

test("duplicates: same version never twice; one active per language across rooms; English and Filipino separate", async () => {
  const { d, service } = await setup();
  const en1 = await pkg(d, { title: "EN one" });
  const en2 = await pkg(d, { title: "EN two" });
  const fil = await pkg(d, { title: "FIL", language: "fil" });
  const school = await pkg(d, { scope: "school", owner: P.admin[0], title: "School EN" });
  await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: en1, studentIds: [P.s2[0]] });
  const again = service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: en1, studentIds: [P.s2[0]] });
  await assert.rejects(again, (e) => e.code === "STUDENTS_INELIGIBLE" && e.ineligible[0].reason === "Already assigned this package version");
  await assert.rejects(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: en2, studentIds: [P.s2[0]] }),
    (e) => e.ineligible[0].reason === "Already has an active English reassessment");
  assert.equal((await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: fil, studentIds: [P.s2[0]] })).created, 1);
  // Ana is in Room A and Room B: an active English reassessment from Room B blocks another English one in Room A.
  await service.createAssignments(as("admin"), { roomId: ROOM_B, packageVersionId: school, studentIds: [P.s1[0]] });
  const roster = await service.roomRoster(as("teacher"), ROOM_A, en2);
  assert.deepEqual(roster.students.map((s) => [s.name, s.reason]),
    [["Ana", "Already has an active English reassessment"], ["Ben", "Already has an active English reassessment"], ["Carla", null]]);
});

test("whole room: snapshot of eligible enrolled Students, skipped Students reported explicitly, later enrolments not added", async () => {
  const { d, service } = await setup();
  const v = await pkg(d, { title: "First" });
  const v2 = await pkg(d, { title: "Second" });
  await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s1[0]] });
  const r = await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v2, mode: "all_eligible" });
  assert.equal(r.created, 2);
  assert.deepEqual(r.skipped.map((s) => [s.name, s.reason]), [["Ana", "Already has an active English reassessment"]]);
  await d.exec("reset role");
  await d.query("insert into enrollments(room_id, student_id) values ($1, $2)", [ROOM_A, P.s4[0]]);
  await d.exec("set role service_role");
  assert.equal((await d.query("select count(*)::int n from m2_reassessment_assignments where student_id = $1", [P.s4[0]])).rows[0].n, 0);
  // Re-running "all eligible" now assigns only the newly enrolled Student; nobody gets the same version twice.
  const rerun = await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v2, mode: "all_eligible" });
  assert.equal(rerun.created, 1);
  assert.equal(rerun.assignments[0].studentName, "Eli");
  assert.deepEqual(rerun.skipped.map((x) => x.reason).sort(), ["Already assigned this package version", "Already assigned this package version",
    "Already has an active English reassessment"]);
  const rows = (await d.query("select student_id from m2_reassessment_assignments where package_version_id = $1", [v2])).rows.map((x) => x.student_id).sort();
  assert.ok(rows.length === 3 && new Set(rows).size === 3, "never a duplicate for the same version");
});

test("concurrent identical submissions: exactly one batch is created; the other is refused as a whole", async () => {
  const { d, service } = await setup();
  const v = await pkg(d);
  const body = { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0], P.s3[0]] };
  const results = await Promise.allSettled([service.createAssignments(as("teacher"), body), service.createAssignments(as("teacher"), body)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const rejected = results.find((r) => r.status === "rejected").reason;
  assert.equal(rejected.statusCode, 409);
  assert.ok(["ASSIGNMENT_CONFLICT", "STUDENTS_INELIGIBLE"].includes(rejected.code), rejected.code);
  assert.equal(await count(d), 2, "two rows (one per Student), never four and never a partial batch");
});

test("a batch that fails at the database leaves nothing behind (single-statement insert)", async () => {
  const { d, repo } = await setup();
  const v = await pkg(d);
  const row = (student) => ({ package_version_id: v, package_id: null, language: "en", kind: "classroom", room_id: ROOM_A, student_id: student, assigned_by: P.teacher[0], due_at: null });
  await assert.rejects(repo.insertAssignments([row(P.s2[0]), row(P.outsider[0])]), /not enrolled/);
  assert.equal(await count(d), 0, "the enrolled Student's row was not kept");
});

test("listing: Teachers see their own rooms only; School Admin sees all; no content or answer keys", async () => {
  const { d, service } = await setup();
  const mine = await pkg(d);
  const school = await pkg(d, { scope: "school", owner: P.admin[0] });
  await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: mine, studentIds: [P.s2[0]] });
  await service.createAssignments(as("admin"), { roomId: ROOM_B, packageVersionId: school, studentIds: [P.outsider[0]] });
  const t = await service.listAssignments(as("teacher"));
  assert.deepEqual(t.assignments.map((a) => [a.studentName, a.roomName, a.status, a.versionLabel]), [["Ben", "Room A", "active", "1.0"]]);
  const other = await service.listAssignments(as("other"));
  assert.deepEqual(other.assignments.map((a) => a.studentName), ["Dan"], "Teacher Two sees the School Admin's assignment in Room B only");
  await refused(service.listAssignments(as("teacher"), { roomId: ROOM_B }), 404, "ROOM_NOT_FOUND");
  const a = await service.listAssignments(as("admin"));
  assert.equal(a.assignments.length, 2);
  assert.equal((await service.listAssignments(as("admin"), { status: "cancelled" })).assignments.length, 0);
  await refused(service.listAssignments(as("admin"), { status: "deleted" }), 400, "INVALID_STATUS");
  assert.doesNotMatch(JSON.stringify(a), /correctChoiceId|paragraphs|questions|prompt/);
});

test("cancellation: reason required, only authorized rooms, only active, recorded; the version can then be reassigned", async () => {
  const { d, service } = await setup();
  const v = await pkg(d);
  const { assignments: [created] } = await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0]] });
  await refused(service.cancelAssignment(as("teacher"), created.id, { reason: "  " }), 400, "REASON_REQUIRED");
  await refused(service.cancelAssignment(as("teacher"), created.id, { reason: "x".repeat(501) }), 400, "REASON_TOO_LONG");
  await refused(service.cancelAssignment(as("other"), created.id, { reason: "Not mine" }), 404, "ASSIGNMENT_NOT_FOUND");
  await refused(service.cancelAssignment(as("teacher"), "nope", { reason: "x" }), 404, "ASSIGNMENT_NOT_FOUND");
  const { assignment } = await service.cancelAssignment(as("teacher"), created.id, { reason: "Assigned to the wrong Student" });
  assert.deepEqual([assignment.status, assignment.cancelledBy, assignment.cancelReason], ["cancelled", "Teacher One", "Assigned to the wrong Student"]);
  assert.ok(assignment.cancelledAt);
  await refused(service.cancelAssignment(as("teacher"), created.id, { reason: "again" }), 409, "ASSIGNMENT_NOT_ACTIVE");
  await refused(service.cancelAssignment(as("admin"), created.id, { reason: "again" }), 409, "ASSIGNMENT_NOT_ACTIVE");
  const again = await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0]] });
  assert.equal(again.created, 1, "a cancelled assignment does not block the same version");
  // The School Admin can cancel in any room (single-school pilot).
  const admin = await service.cancelAssignment(as("admin"), again.assignments[0].id, { reason: "Room schedule changed" });
  assert.equal(admin.assignment.cancelledBy, "School Admin");
  // Concurrent cancellations: exactly one wins.
  const third = await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s3[0]] });
  const races = await Promise.allSettled([service.cancelAssignment(as("teacher"), third.assignments[0].id, { reason: "a" }),
    service.cancelAssignment(as("admin"), third.assignments[0].id, { reason: "b" })]);
  assert.deepEqual(races.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
});

test("cancelling still works with the gate OFF (clean-up), creation does not", async () => {
  const { d, service } = await setup();
  const v = await pkg(d);
  const { assignments: [a] } = await service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s2[0]] });
  await d.exec("reset role; update m2_reassessment_settings set official_reassessment_enabled = false; set role service_role");
  await refused(service.createAssignments(as("teacher"), { roomId: ROOM_A, packageVersionId: v, studentIds: [P.s3[0]] }), 409, "REASSESSMENT_NOT_ENABLED");
  assert.equal((await service.cancelAssignment(as("teacher"), a.id, { reason: "Gate switched off" })).assignment.status, "cancelled");
});

async function call(router, method, path, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/reassessments", router);
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reassessments${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  } finally {
    server.close();
  }
}

test("routes: 401, 403 for learners, 404/409 codes with ineligible details, no-store, 500 hides details", async () => {
  const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
  const { OralReadingAuthorizationError } = require("../services/oralReadingAttemptService");
  const { d, service } = await setup();
  const v = await pkg(d);
  const unauth = await call(createReassessmentsRouter({ authorize: async () => { throw new SupabaseAuthenticationError(); }, service }), "GET", "/overview");
  assert.deepEqual([unauth.status, unauth.body.code], [401, "AUTH_REQUIRED"]);
  const learner = await call(createReassessmentsRouter({ authorize: async () => { throw new OralReadingAuthorizationError(); }, service }), "GET", "/assignments");
  assert.deepEqual([learner.status, learner.body.code], [403, "ASSIGNMENT_FORBIDDEN"]);
  assert.match(learner.body.message, /School Admins and approved Teachers only/);
  const sa = await call(createReassessmentsRouter({ authorize: async () => as("sa"), service }), "GET", "/overview");
  assert.equal(sa.status, 403);
  const teacher = createReassessmentsRouter({ authorize: async () => as("teacher"), service });
  const ov = await call(teacher, "GET", "/overview");
  assert.deepEqual([ov.status, ov.body.enabled, ov.cache], [200, true, "no-store"]);
  const bad = await call(teacher, "POST", "/assignments", { roomId: ROOM_A, packageVersionId: v, studentIds: [P.outsider[0]] });
  assert.deepEqual([bad.status, bad.body.code, bad.body.ineligible.length], [409, "STUDENTS_INELIGIBLE", 1]);
  const ok = await call(teacher, "POST", "/assignments", { roomId: ROOM_A, packageVersionId: v, mode: "all_eligible", dueDate: "2026-12-01" });
  assert.deepEqual([ok.status, ok.body.created], [200, 3]);
  assert.equal((await call(teacher, "GET", "/rooms/" + ROOM_B + "/students")).status, 404);
  assert.equal((await call(teacher, "POST", `/assignments/${ok.body.assignments[0].id}/cancel`, {})).status, 400);
  assert.equal((await call(teacher, "POST", `/assignments/${ok.body.assignments[0].id}/cancel`, { reason: "Test" })).status, 200);
  const logged = [];
  const broken = createReassessmentsRouter({ authorize: async () => as("teacher"), log: (...x) => logged.push(x),
    service: { overview: async () => { throw new Error("password=secret"); } } });
  const crash = await call(broken, "GET", "/overview");
  assert.equal(crash.status, 500);
  assert.doesNotMatch(JSON.stringify(crash.body) + JSON.stringify(logged), /secret/);
});
