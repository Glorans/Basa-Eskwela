const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// Admin M6 self-practice through the real services, against an in-memory database with
// the production unique keys. No Supabase, no network, no paid calls.
const ADMIN = "11111111-1111-4111-8111-111111111111";
const OTHER_ADMIN = "22222222-2222-4222-8222-222222222222";
const STUDENT = "33333333-3333-4333-8333-333333333333";
const MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const DRAFT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const DELETED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad";
const FOREIGN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae";
const FOREIGN_ADMIN = "44444444-4444-4444-8444-444444444444";
const SCHOOL_1 = "00000000-0000-4000-8000-00000000c001";
const SCHOOL_2 = "00000000-0000-4000-8000-00000000c002";
const PASSAGE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PATH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STORY = "Every Saturday, Ben visited Mrs. Santos.";
const UNIQUE = { m6_comprehension_attempts: [["user_id", "submission_id"], ["user_id", "oral_reading_attempt_id"]] };

function database(tables) {
  class Query {
    constructor(table) { Object.assign(this, { table, filters: [], action: "select", mode: null, max: undefined }); }
    select() { return this; }
    insert(row) { this.action = "insert"; this.row = row; return this; }
    update(row) { this.action = "update"; this.row = row; return this; }
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
      if (this.action === "update") { found.forEach((row) => Object.assign(row, this.row)); return { data: found, error: null }; }
      if (this.sort) {
        const { column, ascending } = this.sort;
        found = [...found].sort((a, b) => (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1));
      }
      if (this.max !== undefined) found = found.slice(0, this.max);
      if (this.mode) return { data: found[0] ? { ...found[0] } : null, error: null };
      return { data: found.map((row) => ({ ...row })), error: null };
    }
  }
  return { tables, from: (table) => new Query(table), rpc: async (...args) => { tables.rpcCalls.push(args); return { data: { completed: true }, error: null }; } };
}

function module(id, createdBy, extra = {}) {
  return { id, path_id: PATH, title: "A Helping Hand", difficulty: "Easy", status: "published", passage: STORY,
    created_by: createdBy, deleted_at: null, ...extra };
}

function seed() {
  const questions = ["literal", "inferential", "critical"].map((type, index) => ({
    id: randomUUID(), module_id: MODULE, passage_id: PASSAGE, material_id: null, question_set_id: null,
    question_type: type, question_text: `${type} question?`, options: ["A", "B", "C", "D"],
    scaffolding_hint: "Think about the story.", review_status: "reviewed", display_order: index + 1,
  }));
  const passages = [MODULE, OTHER_MODULE, DRAFT, DELETED, FOREIGN].map((moduleId, index) => ({
    id: index === 0 ? PASSAGE : randomUUID(), module_id: moduleId, title: "A Helping Hand", passage_text: STORY, display_order: 1 }));
  return database({
    modules: [module(MODULE, ADMIN), module(OTHER_MODULE, OTHER_ADMIN), module(DRAFT, ADMIN, { status: "draft" }),
      module(DELETED, ADMIN, { deleted_at: "2026-11-01T00:00:00Z" }), module(FOREIGN, FOREIGN_ADMIN)],
    // School 1: both Admins; School 2: the foreign Admin (M1 multi-tenancy).
    profiles: [{ id: ADMIN, role: "admin", school_id: SCHOOL_1 }, { id: OTHER_ADMIN, role: "admin", school_id: SCHOOL_1 },
      { id: FOREIGN_ADMIN, role: "admin", school_id: SCHOOL_2 }, { id: STUDENT, role: "student", school_id: SCHOOL_1 }],
    module_passages: passages,
    learning_paths: [{ id: PATH, path_name: "English Easy", language: "English" }],
    oral_reading_attempts: [],
    comprehension_questions: questions,
    comprehension_question_answers: questions.map((question) => ({
      question_id: question.id, correct_answer: "B", answer_explanation: "Ben visited every Saturday.", supporting_evidence: "Every Saturday",
    })),
    m6_comprehension_attempts: [],
    m6_comprehension_responses: [],
    rpcCalls: [],
  });
}

let current;
test.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => current);
const { startComprehensionAttempt, getComprehensionAttempt, findComprehensionForReading } = require("../services/comprehensionAttemptService");
const { applyComprehensionAction } = require("../services/comprehensionActionService");

const admin = (id = ADMIN) => ({ user: { id }, profile: { id, role: "admin", school_id: SCHOOL_1 } });
const student = { user: { id: STUDENT }, profile: { id: STUDENT, role: "student" } };
function reading(db, { user = ADMIN, moduleId = MODULE, passageId = PASSAGE, roomId = null } = {}) {
  const row = { id: randomUUID(), user_id: user, module_id: moduleId, passage_id: passageId, room_id: roomId, assignment_id: null,
    material_id: null, passage_snapshot: STORY, language_snapshot: "en", completed_at: new Date().toISOString() };
  db.tables.oral_reading_attempts.push(row);
  return row.id;
}
const start = (requester, body) => startComprehensionAttempt(requester, { submissionId: randomUUID(), ...body });

test("an Admin starts M6 on their own published module from their own saved reading", async () => {
  current = seed();
  const oral = reading(current);
  const attempt = await start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral });
  assert.equal(current.tables.m6_comprehension_attempts[0].user_id, ADMIN);
  assert.equal(attempt.oralReadingAttemptId, oral);
  assert.equal(attempt.roomId, null);
  assert.deepEqual(attempt.questions.map((q) => q.type).sort(), ["critical", "inferential", "literal"]);
  // Reopening (another submission, refresh, View Comprehension Result) never creates a second activity.
  const again = await start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral });
  assert.equal(again.id, attempt.id);
  assert.equal(current.tables.m6_comprehension_attempts.length, 1);
  assert.deepEqual(await findComprehensionForReading(admin(), oral), { id: attempt.id, status: "in_progress" });
});

test("an Admin practises another author's module of their own school, never another school's, a draft or a deleted one", async () => {
  // Same school, another author: access is granted (this seed has no questions for it, so it stops at the question bank).
  current = seed();
  let passageId = current.tables.module_passages.find((p) => p.module_id === OTHER_MODULE).id;
  let oral = reading(current, { moduleId: OTHER_MODULE, passageId });
  await assert.rejects(start(admin(), { moduleId: OTHER_MODULE, passageId, oralReadingAttemptId: oral }),
    { statusCode: 422, message: "Comprehension is not available yet. No reviewed questions are available for this story." });
  for (const moduleId of [DRAFT, DELETED]) {
    current = seed();
    passageId = current.tables.module_passages.find((p) => p.module_id === moduleId).id;
    oral = reading(current, { moduleId, passageId });
    await assert.rejects(start(admin(), { moduleId, passageId, oralReadingAttemptId: oral }), { statusCode: 403 }, moduleId);
    assert.equal(current.tables.m6_comprehension_attempts.length, 0);
  }
  // Another school's module: "not found", whatever the Admin sends.
  current = seed();
  passageId = current.tables.module_passages.find((p) => p.module_id === FOREIGN).id;
  oral = reading(current, { moduleId: FOREIGN, passageId });
  await assert.rejects(start(admin(), { moduleId: FOREIGN, passageId, oralReadingAttemptId: oral }), { statusCode: 404, message: "Reading module not found." });
  assert.equal(current.tables.m6_comprehension_attempts.length, 0);
});

test("an Admin cannot use a classroom, assignment or uploaded-material context", async () => {
  current = seed();
  const oral = reading(current);
  for (const extra of [{ roomId: ROOM }, { assignmentId: ROOM }]) {
    await assert.rejects(start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral, ...extra }), { statusCode: 403 });
  }
  await assert.rejects(start(admin(), { materialId: MODULE, activityAssignmentId: ROOM, oralReadingAttemptId: oral, roomId: ROOM }), { statusCode: 403 });
  assert.equal(current.tables.m6_comprehension_attempts.length, 0);
});

test("an Admin needs their own reading of this exact module and story", async () => {
  current = seed();
  const studentsReading = reading(current, { user: STUDENT });
  await assert.rejects(start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: studentsReading }), { statusCode: 403 });
  const otherAdmins = reading(current, { user: OTHER_ADMIN });
  await assert.rejects(start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: otherAdmins }), { statusCode: 403 });
  // No reading at all, or a reading of an older story text.
  await assert.rejects(start(admin(), { moduleId: MODULE, passageId: PASSAGE }), { statusCode: 403 });
  const stale = reading(current);
  current.tables.oral_reading_attempts.at(-1).passage_snapshot = "An older story.";
  await assert.rejects(start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: stale }), { statusCode: 403 });
  assert.equal(current.tables.m6_comprehension_attempts.length, 0);
});

test("reviewing Students never lets an Admin open, answer or complete a Student's activity", async () => {
  current = seed();
  const studentReading = reading(current, { user: STUDENT });
  current.tables.m6_comprehension_attempts.push({ id: randomUUID(), user_id: STUDENT, module_id: MODULE, passage_id: PASSAGE,
    oral_reading_attempt_id: studentReading, status: "in_progress", question_snapshot: [], language: "en" });
  const studentAttempt = current.tables.m6_comprehension_attempts[0].id;
  await assert.rejects(getComprehensionAttempt(admin(), studentAttempt), { statusCode: 404 });
  await assert.rejects(applyComprehensionAction(admin(), studentAttempt, { action: "complete" }), { statusCode: 404 });
  await assert.rejects(applyComprehensionAction(admin(), studentAttempt, {
    action: "answer", questionId: randomUUID(), optionIndex: 1, requestId: randomUUID() }), { statusCode: 404 });
  assert.equal(await findComprehensionForReading(admin(), studentReading), null, "the lookup is owner-only");
  assert.deepEqual(current.tables.rpcCalls, [], "nothing reached the database function");
  // And Students still cannot reach an Admin's practice.
  const oral = reading(current);
  const adminAttempt = await start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral });
  await assert.rejects(getComprehensionAttempt(student, adminAttempt.id), { statusCode: 404 });
});

test("an Admin answers and completes their own activity through the existing protected function", async () => {
  current = seed();
  const oral = reading(current);
  const attempt = await start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral });
  const done = await applyComprehensionAction(admin(), attempt.id, { action: "complete" });
  assert.deepEqual(done.outcome, { completed: true });
  assert.deepEqual(current.tables.rpcCalls.map(([name, args]) => [name, args.target_user, args.action_name]),
    [["m6_apply_action", ADMIN, "complete"]], "the same M6 function and scoring, as the Admin");
});

test("Students' classroom M6 is unchanged by the Admin rule", async () => {
  current = seed();
  // A Student without an enrollment is still refused by the existing classroom checks for a classroom request.
  current.tables.enrollments = [];
  const oral = reading(current, { user: STUDENT });
  await assert.rejects(start(student, { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral, roomId: ROOM }), { statusCode: 403 });
  // Without a classroom it is the Student's personal practice (2026-11-17), with no classroom attached.
  const personal = await start(student, { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral });
  assert.equal(personal.roomId ?? null, null);
  assert.equal(current.tables.m6_comprehension_attempts.find((row) => row.id === personal.id).room_id ?? null, null);
});

test("Admin M5 practice saves the normal reading results; their school's modules are open, another school's are not", async () => {
  current = seed();
  const { createOralReadingAttempt, getOralReadingAttempt } = require("../services/oralReadingAttemptService");
  const deps = { getSupabaseAdmin: () => current };
  const saved = await createOralReadingAttempt(admin(), { moduleId: MODULE, passageId: PASSAGE, submissionId: randomUUID(),
    transcript: "Every Saturday Ben visited Mrs Santos", durationSeconds: 6 }, deps);
  // The same server-side scoring as for learners: nothing is switched off for an Admin.
  assert.equal(saved.userId, ADMIN);
  assert.equal(saved.pronunciationAccuracy, 100);
  assert.equal(Math.round(saved.readingSpeedWpm), 60);
  assert.equal(saved.expectedWordCount, 6);
  assert.ok(saved.wordMetrics.every((metric) => metric.type === "match"));
  // Reopened later (Reading History or a refresh) by its owner only.
  assert.equal((await getOralReadingAttempt(admin(), saved.id, deps)).pronunciationAccuracy, 100);
  await assert.rejects(getOralReadingAttempt(admin(OTHER_ADMIN), saved.id, deps), { statusCode: 403 });
  const otherPassage = current.tables.module_passages.find((p) => p.module_id === OTHER_MODULE).id;
  // Another author's module of the same school is practice material too (expanded 2026-11-21).
  const sameSchool = await createOralReadingAttempt(admin(), { moduleId: OTHER_MODULE, passageId: otherPassage, submissionId: randomUUID(),
    transcript: "Every Saturday", durationSeconds: 3 }, deps);
  assert.equal(sameSchool.userId, ADMIN);
  const foreignPassage = current.tables.module_passages.find((p) => p.module_id === FOREIGN).id;
  await assert.rejects(createOralReadingAttempt(admin(), { moduleId: FOREIGN, passageId: foreignPassage, submissionId: randomUUID(),
    transcript: "Every Saturday", durationSeconds: 3 }, deps), { statusCode: 404 });
  assert.equal(current.tables.oral_reading_attempts.length, 2);
});

test("a completed Admin M6 result reopens as the same activity with its saved score", async () => {
  current = seed();
  const oral = reading(current);
  const attempt = await start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral });
  const row = current.tables.m6_comprehension_attempts[0];
  row.status = "completed";
  row.completed_at = new Date().toISOString();
  for (const question of row.question_snapshot) {
    current.tables.m6_comprehension_responses.push({ id: randomUUID(), attempt_id: row.id, question_id: question.id,
      first_option_index: 1, first_answer_correct: question.correctOptionIndex === 1, answer_history: [], resolved: true, hint_used: false });
  }
  const reopened = await start(admin(), { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: oral });
  assert.equal(reopened.id, attempt.id);
  assert.equal(reopened.status, "completed");
  assert.equal(reopened.summary.totalQuestions, 3);
  assert.equal(reopened.summary.firstCorrect, 3, "every saved answer was the key (B) in this fixture");
  assert.deepEqual(await findComprehensionForReading(admin(), oral), { id: attempt.id, status: "completed" });
  assert.equal(current.tables.m6_comprehension_attempts.length, 1, "no duplicate activity");
});
