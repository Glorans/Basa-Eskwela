const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// Independent Learner module comprehension, against an in-memory database that
// enforces the same unique keys as production: one activity per
// (user, submission_id) and per (user, oral_reading_attempt_id).
const LEARNER = "33333333-3333-4333-8333-333333333333";
const MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PASSAGE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
      const rows = tables[this.table];
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
  return { tables, from: (table) => new Query(table) };
}

function seed() {
  // Saved bank order (display_order): critical, literal, inferential.
  const questions = ["critical", "literal", "inferential"].map((type, index) => ({
    id: randomUUID(), module_id: MODULE, passage_id: PASSAGE, material_id: null, question_set_id: null,
    question_type: type, question_text: `${type} question?`, options: ["A", "B", "C", "D"],
    scaffolding_hint: "Think about the story.", review_status: "reviewed", display_order: index + 1,
  }));
  return database({
    modules: [{ id: MODULE, path_id: PATH, title: "A Helping Hand", difficulty: "Easy", status: "published", passage: STORY }],
    module_passages: [{ id: PASSAGE, module_id: MODULE, title: "A Helping Hand", passage_text: STORY, display_order: 1 }],
    learning_paths: [{ id: PATH, path_name: "English Easy", language: "English" }],
    oral_reading_attempts: [],
    comprehension_questions: questions,
    comprehension_question_answers: questions.map((question) => ({
      question_id: question.id, correct_answer: "B", answer_explanation: null, supporting_evidence: null,
    })),
    m6_comprehension_attempts: [],
    m6_comprehension_responses: [],
  });
}

// The services keep the admin-client function they loaded, so it is mocked once
// for this file and pointed at each test's database.
let current;
require("node:test").mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => current);
const { startComprehensionAttempt } = require("../services/comprehensionAttemptService");

const read = (db, completedAt) => {
  const reading = { id: randomUUID(), user_id: LEARNER, module_id: MODULE, passage_id: PASSAGE, room_id: null,
    assignment_id: null, passage_snapshot: STORY, language_snapshot: "en", completed_at: completedAt };
  db.tables.oral_reading_attempts.push(reading);
  return reading.id;
};

test("module comprehension: one assessment per learning activity, questions Literal → Inferential → Critical", async () => {
  const db = current = seed();
  const learner = { user: { id: LEARNER }, profile: { id: LEARNER, role: "general_user" } };
  const start = (extra = {}) => startComprehensionAttempt(learner, { moduleId: MODULE, passageId: PASSAGE, submissionId: randomUUID(), ...extra });

  const reading = read(db, "2026-10-25T08:00:00.000Z");
  // An old link without the oral-reading ID binds to the verified latest reading.
  const first = await start();
  assert.equal(first.oralReadingAttemptId, reading);
  assert.deepEqual(first.questions.map((question) => question.type), ["literal", "inferential", "critical"]);

  // Opening it again without the ID, or with it, reopens the same activity: no duplicates.
  assert.equal((await start()).id, first.id);
  assert.equal((await start({ oralReadingAttemptId: reading })).id, first.id);
  assert.equal(db.tables.m6_comprehension_attempts.length, 1);

  // A repeated M5 reading of the same passage is not a new M6 opportunity: with or without its
  // ID, or as a retried submission, it reopens the activity's assessment with its original reading.
  const submissionId = randomUUID();
  const fresh = read(db, "2026-10-25T09:00:00.000Z");
  const second = await start({ submissionId });
  assert.equal(second.id, first.id, "a repeated reading reopens the same assessment");
  assert.equal(second.oralReadingAttemptId, reading, "the assessment keeps its original reading");
  assert.equal((await start({ submissionId })).id, first.id);
  assert.equal((await start({ oralReadingAttemptId: fresh })).id, first.id);
  assert.equal(db.tables.m6_comprehension_attempts.length, 1);

  // Completed: a further reading opens the saved (read-only) result, never a new assessment.
  db.tables.m6_comprehension_attempts[0].status = "completed";
  db.tables.m6_comprehension_attempts[0].completed_at = "2026-10-25T08:30:00.000Z";
  const third = read(db, "2026-10-25T10:00:00.000Z");
  const reopened = await start({ oralReadingAttemptId: third });
  assert.deepEqual([reopened.id, reopened.status], [first.id, "completed"]);
  assert.equal(db.tables.m6_comprehension_attempts.length, 1);

  // An earlier activity keeps its saved question order even if the bank changes.
  db.tables.comprehension_questions.forEach((question) => { question.display_order = 10 - question.display_order; });
  assert.deepEqual((await start({ oralReadingAttemptId: reading })).questions.map((question) => question.type),
    ["literal", "inferential", "critical"]);
  assert.equal(db.tables.m6_comprehension_attempts[0].question_snapshot.length, 3);
});

test("module comprehension still requires a saved reading of the current story", async () => {
  const db = current = seed();
  const learner = { user: { id: LEARNER }, profile: { id: LEARNER, role: "general_user" } };
  await assert.rejects(startComprehensionAttempt(learner, { moduleId: MODULE, passageId: PASSAGE, submissionId: randomUUID() }),
    { statusCode: 403 });
  assert.equal(db.tables.m6_comprehension_attempts.length, 0);
});

test("a different passage, or the same passage in another classroom assignment, is a separate activity", async () => {
  const db = current = seed();
  const learner = { user: { id: LEARNER }, profile: { id: LEARNER, role: "general_user" } };
  const reading = read(db, "2026-10-25T08:00:00.000Z");
  const first = await startComprehensionAttempt(learner, { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: reading, submissionId: randomUUID() });
  const { findActivityAttempt, activityKey } = require("../services/comprehensionAttemptService");
  // Same learner, same module: another passage, or another room assignment, has no assessment yet.
  for (const other of [{ passage_id: randomUUID() }, { room_id: randomUUID(), assignment_id: randomUUID() }]) {
    const key = activityKey({ module_id: MODULE, passage_id: PASSAGE, room_id: null, assignment_id: null, ...other });
    assert.equal(await findActivityAttempt(db, LEARNER, key), null, JSON.stringify(other));
  }
  // An assigned material is keyed by its activity assignment only.
  assert.deepEqual(Object.keys(activityKey({ material_id: "m", activity_assignment_id: "a", room_id: "r" })), ["material_id", "activity_assignment_id"]);
  // The activity's own key finds the one assessment.
  assert.equal((await findActivityAttempt(db, LEARNER, activityKey({ module_id: MODULE, passage_id: PASSAGE }))).id, first.id);
  // Another learner's assessment is never found.
  assert.equal(await findActivityAttempt(db, "44444444-4444-4444-8444-444444444444", activityKey({ module_id: MODULE, passage_id: PASSAGE })), null);
});

test("an extra attempt saved before the one-per-activity rule cannot be answered or finished, and points to the activity's assessment", async () => {
  const db = current = seed();
  const learner = { user: { id: LEARNER }, profile: { id: LEARNER, role: "general_user" } };
  const { getComprehensionAttempt } = require("../services/comprehensionAttemptService");
  const { applyComprehensionAction } = require("../services/comprehensionActionService");
  const first = await startComprehensionAttempt(learner, { moduleId: MODULE, passageId: PASSAGE,
    oralReadingAttemptId: read(db, "2026-10-25T08:00:00.000Z"), submissionId: randomUUID() });
  Object.assign(db.tables.m6_comprehension_attempts[0], { status: "completed", completed_at: "2026-10-25T08:30:00.000Z" });
  // A legacy extra attempt for the same activity, from a later reading (as on Staging before the rule).
  const extra = { ...db.tables.m6_comprehension_attempts[0], id: randomUUID(), submission_id: randomUUID(), status: "in_progress",
    completed_at: null, created_at: "2026-10-25T09:00:00.000Z", oral_reading_attempt_id: read(db, "2026-10-25T09:00:00.000Z") };
  db.tables.m6_comprehension_attempts.push(extra);
  db.rpc = async () => { throw new Error("must not reach the database function"); };
  for (const action of [{ action: "complete" }, { action: "answer", questionId: randomUUID(), optionIndex: 0, requestId: randomUUID() }]) {
    await assert.rejects(applyComprehensionAction(learner, extra.id, action), { statusCode: 409, message: /already has a comprehension assessment/ });
  }
  assert.equal((await getComprehensionAttempt(learner, extra.id)).activityAttemptId, first.id, "the page opens the activity's assessment");
  assert.equal((await getComprehensionAttempt(learner, first.id)).activityAttemptId, first.id);
  // Both readings lead to the completed assessment; the saved rows are unchanged.
  assert.equal((await startComprehensionAttempt(learner, { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId: extra.oral_reading_attempt_id,
    submissionId: randomUUID() })).id, first.id);
  assert.deepEqual(db.tables.m6_comprehension_attempts.map((row) => row.status), ["completed", "in_progress"]);
});

test("simultaneous starts from two different readings: one assessment with the database guard (the race it closes)", async () => {
  const learner = { user: { id: LEARNER }, profile: { id: LEARNER, role: "general_user" } };
  const twoStarts = async (db) => {
    const [r1, r2] = [read(db, "2026-10-25T08:00:00.000Z"), read(db, "2026-10-25T08:00:01.000Z")];
    return Promise.all([r1, r2].map((oralReadingAttemptId) =>
      startComprehensionAttempt(learner, { moduleId: MODULE, passageId: PASSAGE, oralReadingAttemptId, submissionId: randomUUID() })));
  };
  // Without the proposed guard, both requests can pass the backend check before either insert.
  let db = current = seed();
  await twoStarts(db);
  const withoutGuard = db.tables.m6_comprehension_attempts.length;
  // With it (one attempt per user and activity; here the activity is a module passage without a classroom).
  UNIQUE.m6_comprehension_attempts.push(["user_id", "module_id", "passage_id"]);
  try {
    db = current = seed();
    const results = await twoStarts(db);
    assert.equal(results[0].id, results[1].id, "both requests open the same assessment");
    assert.equal(db.tables.m6_comprehension_attempts.length, 1);
  } finally { UNIQUE.m6_comprehension_attempts.pop(); }
  assert.ok(withoutGuard >= 1);
  console.log(`# without the database guard, simultaneous starts created ${withoutGuard} attempt(s)`);
});

test("the database guard refusing a second completed result is reported as a clear 409, not a retryable save error", async () => {
  const db = current = seed();
  const learner = { user: { id: LEARNER }, profile: { id: LEARNER, role: "general_user" } };
  const { applyComprehensionAction } = require("../services/comprehensionActionService");
  const saved = await startComprehensionAttempt(learner, { moduleId: MODULE, passageId: PASSAGE,
    oralReadingAttemptId: read(db, "2026-10-25T08:00:00.000Z"), submissionId: randomUUID() });
  db.tables.m6_comprehension_responses ??= [];
  db.rpc = async () => ({ data: null, error: { code: "23505", message: "This learning activity already has a completed comprehension assessment." } });
  await assert.rejects(applyComprehensionAction(learner, saved.id, { action: "complete" }),
    { statusCode: 409, message: /already has a comprehension assessment/ });
});
