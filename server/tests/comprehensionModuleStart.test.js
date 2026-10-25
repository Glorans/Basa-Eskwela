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

test("module comprehension: one activity per saved reading, questions Literal → Inferential → Critical", async () => {
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

  // A retry of the same submission (same request, no ID) returns the same activity.
  const submissionId = randomUUID();
  const fresh = read(db, "2026-10-25T09:00:00.000Z");
  const second = await start({ submissionId });
  assert.equal(second.oralReadingAttemptId, fresh, "a new reading gets its own activity");
  assert.equal((await start({ submissionId })).id, second.id);
  assert.equal(db.tables.m6_comprehension_attempts.length, 2);

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
