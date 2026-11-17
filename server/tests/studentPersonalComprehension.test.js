// Student personal comprehension (2026-11-17): a Student takes the M6 comprehension of a published module outside
// any classroom, after their own personal reading of it. Classroom assessments are unchanged, the one-assessment
// rule holds per activity, and switching between classroom and personal routes never yields a second assessment.
// In-memory data; the database functions (m6_apply_action and its completion rules) are covered by the SQL proposal.
const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID } = require("node:crypto");

const STUDENT = "11111111-1111-4111-8111-111111111111"; // enrolled in ROOM
const LONER = "22222222-2222-4222-8222-222222222222"; // no classroom
const OTHER = "33333333-3333-4333-8333-333333333333"; // another Student
const TEACHER = "44444444-4444-4444-8444-444444444444";
const ASSIGNED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // assigned in ROOM
const EARLY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"; // published, assigned nowhere
const DRAFT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const P_ASSIGNED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const P_EARLY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const P_DRAFT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const ROOM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASSIGNMENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PATH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STORY = "Every Saturday, Ben visited Mrs. Santos.";
const UNIQUE = { m6_comprehension_attempts: [["user_id", "submission_id"], ["user_id", "oral_reading_attempt_id"]] };

function database(tables) {
  class Query {
    constructor(table) { Object.assign(this, { table, filters: [], action: "select", mode: null, max: undefined }); }
    select() { return this; }
    insert(row) { this.action = "insert"; this.row = row; return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    is(column, value) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    order(column, { ascending = true } = {}) { this.sort = { column, ascending }; return this; }
    limit(value) { this.max = value; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    single() { this.mode = "one"; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      const rows = tables[this.table] ??= [];
      if (this.action === "insert") {
        for (const keys of UNIQUE[this.table] ?? []) {
          if (keys.every((key) => this.row[key] != null)
            && rows.some((row) => keys.every((key) => row[key] === this.row[key]))) return { data: null, error: { code: "23505" } };
        }
        const saved = { id: randomUUID(), created_at: new Date().toISOString(), status: "in_progress", ...this.row };
        rows.push(saved);
        return { data: { ...saved }, error: null };
      }
      let found = rows.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.sort) {
        const { column, ascending } = this.sort;
        found = [...found].sort((a, b) => (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1));
      }
      if (this.max !== undefined) found = found.slice(0, this.max);
      if (this.mode) return { data: found[0] ? { ...found[0] } : null, error: null };
      return { data: found.map((row) => ({ ...row })), error: null };
    }
  }
  const db = { tables, rpcResult: { data: { completed: true }, error: null }, from: (table) => new Query(table) };
  db.rpc = async () => db.rpcResult;
  return db;
}

function seed() {
  const modules = [[ASSIGNED, P_ASSIGNED, "published"], [EARLY, P_EARLY, "published"], [DRAFT, P_DRAFT, "draft"]];
  const questions = modules.flatMap(([moduleId, passageId]) => ["literal", "inferential", "critical"].map((type, index) => ({
    id: randomUUID(), module_id: moduleId, passage_id: passageId, material_id: null, question_set_id: null,
    question_type: type, question_text: `${type} question for ${moduleId.slice(-1)}?`, options: ["A", "B", "C", "D"],
    scaffolding_hint: "Think about the story.", review_status: "reviewed", display_order: index + 1,
  })));
  return database({
    modules: modules.map(([id, , status]) => ({ id, path_id: PATH, title: `Module ${id.slice(-1)}`, difficulty: "Easy", status,
      passage: STORY, created_by: TEACHER, deleted_at: null })),
    module_passages: modules.map(([moduleId, passageId]) => ({ id: passageId, module_id: moduleId, title: "A Helping Hand", passage_text: STORY, display_order: 1 })),
    learning_paths: [{ id: PATH, path_name: "English Easy", language: "English" }],
    rooms: [{ id: ROOM, teacher_id: TEACHER, archived_at: null }],
    enrollments: [{ student_id: STUDENT, room_id: ROOM }],
    room_modules: [{ id: ASSIGNMENT, room_id: ROOM, module_id: ASSIGNED, removed_at: null }],
    room_module_recipients: [],
    oral_reading_attempts: [],
    comprehension_questions: questions,
    comprehension_question_answers: questions.map((question) => ({
      question_id: question.id, correct_answer: "B", answer_explanation: "Ben visited every Saturday.", supporting_evidence: "Every Saturday",
    })),
    m6_comprehension_attempts: [],
    m6_comprehension_responses: [],
  });
}

let current;
test.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => current);
const { startComprehensionAttempt, getComprehensionAttempt, findComprehensionForReading } = require("../services/comprehensionAttemptService");
const { applyComprehensionAction } = require("../services/comprehensionActionService");
const PERSONAL_EXISTS = "You already have a personal comprehension assessment for this passage. Open it from your Reading History.";
const CLASSROOM_EXISTS = "You already have a comprehension assessment for this passage from a classroom. Open it from your Reading History.";

const as = (id) => ({ user: { id }, profile: { id, role: "student" } });
function reading(db, { user, moduleId, passageId, roomId = null, assignmentId = null }) {
  const row = { id: randomUUID(), user_id: user, module_id: moduleId, passage_id: passageId, room_id: roomId, assignment_id: assignmentId,
    material_id: null, passage_snapshot: STORY, language_snapshot: "en", completed_at: new Date().toISOString() };
  db.tables.oral_reading_attempts.push(row);
  return row.id;
}
const start = (requester, body) => startComprehensionAttempt(requester, { submissionId: randomUUID(), ...body });
const saved = (id) => current.tables.m6_comprehension_attempts.find((row) => row.id === id);

test("a Student with no classroom takes the comprehension of a published module as personal practice", async () => {
  current = seed();
  const oral = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY });
  const attempt = await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: oral });
  const row = saved(attempt.id);
  assert.deepEqual([row.user_id, row.module_id, row.passage_id, row.room_id ?? null, row.assignment_id ?? null, row.oral_reading_attempt_id],
    [LONER, EARLY, P_EARLY, null, null, oral]);
  // The module's own reviewed questions, literal/inferential/critical, without answers before submission.
  assert.equal(attempt.questions.length, 3);
  assert.deepEqual(attempt.questions.map((q) => q.type), ["literal", "inferential", "critical"]);
  // As in classroom assessments, answer fields stay empty until a question is answered.
  for (const question of attempt.questions) assert.equal(question.correctOptionIndex ?? null, null);
  const visible = JSON.stringify(attempt.questions);
  for (const secret of ["correctAnswer", "Ben visited every Saturday.", "Every Saturday\""]) assert.ok(!visible.includes(secret), secret);
  assert.ok(row.question_snapshot.every((q) => q.questionText.endsWith("b?")), "questions belong to the selected module and passage");
  // Nothing classroom-like was created.
  assert.deepEqual(current.tables.enrollments, [{ student_id: STUDENT, room_id: ROOM }]);
  assert.equal(current.tables.room_modules.length, 1);
  // The result page finds it from the reading.
  assert.deepEqual(await findComprehensionForReading(as(LONER), oral), { id: attempt.id, status: "in_progress" });
});

test("one personal assessment per passage: a repeat start or a later reading reopens it", async () => {
  current = seed();
  const first = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY });
  const attempt = await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: first });
  assert.equal((await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: first })).id, attempt.id);
  const again = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY });
  assert.equal((await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: again })).id, attempt.id);
  // Completed stays completed and read-only: it reopens, nothing new starts.
  saved(attempt.id).status = "completed"; saved(attempt.id).completed_at = new Date().toISOString();
  const reopened = await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: again });
  assert.equal(reopened.id, attempt.id);
  assert.equal(reopened.status, "completed");
  assert.equal(current.tables.m6_comprehension_attempts.length, 1);
});

test("an enrolled Student: an unassigned module is personal, an assigned one keeps the classroom assessment", async () => {
  current = seed();
  const personalReading = reading(current, { user: STUDENT, moduleId: EARLY, passageId: P_EARLY });
  const personal = await start(as(STUDENT), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: personalReading });
  assert.equal(saved(personal.id).room_id ?? null, null);
  const classroomReading = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED, roomId: ROOM, assignmentId: ASSIGNMENT });
  const classroom = await start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: classroomReading });
  assert.deepEqual([saved(classroom.id).room_id, saved(classroom.id).assignment_id], [ROOM, ASSIGNMENT]);
});

test("a personal reading is never evidence for a classroom assessment, nor a classroom reading for a personal one", async () => {
  current = seed();
  // Assigned module, but only a personal-shaped reading: the classroom assessment needs its classroom reading.
  const wrong = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED });
  await assert.rejects(start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: wrong }),
    { statusCode: 403, message: /Complete and save oral reading/ });
  // A former classroom reading does not open a personal assessment either.
  const classroomShaped = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY, roomId: ROOM, assignmentId: ASSIGNMENT });
  await assert.rejects(start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: classroomShaped }), { statusCode: 403 });
  assert.equal(current.tables.m6_comprehension_attempts.length, 0);
});

test("switching contexts cannot add an assessment: a classroom one for the passage blocks a personal one", async () => {
  current = seed();
  const classroomReading = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED, roomId: ROOM, assignmentId: ASSIGNMENT });
  const classroom = await start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: classroomReading });
  saved(classroom.id).status = "completed"; saved(classroom.id).completed_at = new Date().toISOString();
  // Later the Student leaves the classroom; the module is now "unassigned" for them and reachable as personal.
  current.tables.enrollments = [];
  const personalReading = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED });
  await assert.rejects(start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: personalReading }),
    { statusCode: 409, message: "You already have a comprehension assessment for this passage from a classroom. Open it from your Reading History." });
  assert.equal(current.tables.m6_comprehension_attempts.length, 1);
  // While enrolled, the assigned module always takes the classroom path, so it never becomes personal there.
  current = seed();
  const own = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED, roomId: ROOM, assignmentId: ASSIGNMENT });
  reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED });
  const viaCatalog = await start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED });
  assert.equal(saved(viaCatalog.id).room_id, ROOM);
  assert.equal(saved(viaCatalog.id).oral_reading_attempt_id, own);
});

test("unpublished modules and classroom requests the Student cannot use stay refused", async () => {
  current = seed();
  const draftReading = reading(current, { user: LONER, moduleId: DRAFT, passageId: P_DRAFT });
  await assert.rejects(start(as(LONER), { moduleId: DRAFT, passageId: P_DRAFT, oralReadingAttemptId: draftReading }), { statusCode: 403 });
  const early = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY });
  await assert.rejects(start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: early, roomId: ROOM }), { statusCode: 403 });
  current.tables.modules.find((m) => m.id === EARLY).deleted_at = "2026-11-01T00:00:00Z";
  await assert.rejects(start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: early }), { statusCode: 403 });
  assert.equal(current.tables.m6_comprehension_attempts.length, 0);
});

test("another Student cannot open, find or reuse a personal assessment", async () => {
  current = seed();
  const oral = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY });
  const attempt = await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: oral });
  await assert.rejects(getComprehensionAttempt(as(OTHER), attempt.id), (error) => [403, 404].includes(error.statusCode));
  assert.equal(await findComprehensionForReading(as(OTHER), oral), null);
  await assert.rejects(start(as(OTHER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: oral }), { statusCode: 403 });
});

test("personal first, then assigned: no classroom assessment of the same passage starts (both open and completed)", async () => {
  for (const status of ["in_progress", "completed"]) {
    current = seed();
    const personalReading = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY });
    const personal = await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: personalReading });
    if (status === "completed") { saved(personal.id).status = "completed"; saved(personal.id).completed_at = new Date().toISOString(); }
    // The teacher now assigns Early Start in a room the Student joins.
    current.tables.enrollments.push({ student_id: LONER, room_id: ROOM });
    current.tables.room_modules.push({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9", room_id: ROOM, module_id: EARLY, removed_at: null });
    const classroomReading = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY, roomId: ROOM, assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9" });
    await assert.rejects(start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: classroomReading }),
      { statusCode: 409, message: PERSONAL_EXISTS }, status);
    // Nothing converted or added: the personal assessment stays personal, and still reopens (resume / read-only).
    assert.equal(current.tables.m6_comprehension_attempts.length, 1);
    assert.equal(saved(personal.id).room_id ?? null, null);
    const reopened = await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: personalReading });
    assert.equal(reopened.id, personal.id);
    assert.equal(reopened.status, status);
  }
});

test("an open classroom assessment still resumes in its classroom, and blocks a personal one", async () => {
  current = seed();
  const classroomReading = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED, roomId: ROOM, assignmentId: ASSIGNMENT });
  const classroom = await start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: classroomReading });
  // Resumed the way the classroom link does it (with its room and assignment).
  assert.equal((await start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: classroomReading,
    roomId: ROOM, assignmentId: ASSIGNMENT })).id, classroom.id);
  current.tables.enrollments = [];
  const personalReading = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED });
  await assert.rejects(start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: personalReading }),
    { statusCode: 409, message: CLASSROOM_EXISTS });
});

test("other passages are unaffected: a personal assessment of one module does not block another module's classroom one", async () => {
  current = seed();
  const personalReading = reading(current, { user: STUDENT, moduleId: EARLY, passageId: P_EARLY });
  await start(as(STUDENT), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: personalReading });
  const classroomReading = reading(current, { user: STUDENT, moduleId: ASSIGNED, passageId: P_ASSIGNED, roomId: ROOM, assignmentId: ASSIGNMENT });
  const classroom = await start(as(STUDENT), { moduleId: ASSIGNED, passageId: P_ASSIGNED, oralReadingAttemptId: classroomReading });
  assert.equal(saved(classroom.id).room_id, ROOM);
});

test("the database's cross-context refusal at completion reaches the Student as a clear message", async () => {
  for (const [message, expected] of [["This passage already has a classroom comprehension assessment", CLASSROOM_EXISTS],
    ["This passage already has a personal comprehension assessment", PERSONAL_EXISTS]]) {
    current = seed();
    const oral = reading(current, { user: LONER, moduleId: EARLY, passageId: P_EARLY });
    const attempt = await start(as(LONER), { moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: oral });
    current.rpcResult = { data: null, error: { code: "42501", message } };
    await assert.rejects(applyComprehensionAction(as(LONER), attempt.id, { action: "complete" }), { statusCode: 409, message: expected });
  }
  // Any other 42501 keeps the existing wording.
  current.rpcResult = { data: null, error: { code: "42501", message: "Module access revoked" } };
  const attemptId = current.tables.m6_comprehension_attempts[0].id;
  await assert.rejects(applyComprehensionAction(as(LONER), attemptId, { action: "complete" }),
    { statusCode: 403, message: "Access to this activity has been revoked or is not authorized." });
});
