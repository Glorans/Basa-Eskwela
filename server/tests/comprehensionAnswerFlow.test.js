// Real PostgreSQL (PGlite, in memory) running the actual m6_apply_action SQL:
// answers, hints, first-answer scoring, two-try resolution and idempotent
// retries. Calls are made as service_role, as the backend does. No network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile, id } = require("./fixtures/m5M6SecurityDatabase");
const { createM8TrustDatabase, USERS, MODULE } = require("./fixtures/m8TrustDatabase");
const { summarizeComprehension } = require("../services/comprehensionScoring");

const LITERAL = id(8101);
const INFERENTIAL = id(8102);
const CRITICAL = id(8103);
const SNAPSHOT = [
  [LITERAL, "literal", 1], [INFERENTIAL, "inferential", 2], [CRITICAL, "critical", 3],
].map(([questionId, type, correct]) => ({
  id: questionId, type, questionText: `${type}?`, options: ["a", "b", "c", "d"],
  correctOptionIndex: correct, scaffoldingHint: `Think about the ${type} clue.`,
}));

let submission = 0;
let requests = 0; // Distinct request IDs; 7999 is reserved for the retry test.
async function newAttempt(db, user = USERS.general) {
  const { rows } = await db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,module_id,passage_id,
      passage_title,passage_text,language,question_snapshot,status)
    values ($1,$2,$3,$3,'Story','Story text','en',$4,'in_progress') returning id`,
  [user, id(9500 + ++submission), MODULE.enEasy, JSON.stringify(SNAPSHOT)]);
  return rows[0].id;
}

function actions(db, attempt, user = USERS.general) {
  const call = async (questionId, action, option = null, request = null) => {
    await db.exec("set role service_role");
    try {
      const { rows } = await db.query("select public.m6_apply_action($1,$2,$3,$4,$5,$6) as result",
        [attempt, user, questionId, action, option, request]);
      return rows[0].result;
    } finally {
      await db.exec("reset role");
    }
  };
  return {
    answer: (questionId, option, request = id(7000 + ++requests)) => call(questionId, "answer", option, request),
    hint: (questionId) => call(questionId, "hint"),
    complete: () => call(null, "complete"),
  };
}

const response = async (db, attempt, questionId) => (await db.query(
  "select * from public.m6_comprehension_responses where attempt_id = $1 and question_id = $2", [attempt, questionId])).rows[0];

test("M6 answers and hints on real PostgreSQL", { timeout: 180000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));

  await t.test("a correct first answer resolves the question and counts as first-correct", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    assert.deepEqual(await act.answer(LITERAL, 1), { correct: true, resolved: true });
    const saved = await response(db, attempt, LITERAL);
    assert.deepEqual([saved.first_option_index, saved.first_answer_correct, saved.resolved, saved.hint_used], [1, true, true, false]);
    await assert.rejects(act.answer(LITERAL, 2), /already finished/);
  });

  await t.test("a wrong first answer allows one more try; the first answer stays the score", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    assert.deepEqual(await act.answer(INFERENTIAL, 0), { correct: false, resolved: false });
    assert.deepEqual(await act.answer(INFERENTIAL, 2), { correct: true, resolved: true });
    const saved = await response(db, attempt, INFERENTIAL);
    assert.deepEqual([saved.first_option_index, saved.first_answer_correct, saved.resolved], [0, false, true]);
    assert.deepEqual(saved.answer_history.map((entry) => [entry.optionIndex, entry.correct]), [[0, false], [2, true]]);

    // Two wrong answers also finish the question, so the learner moves on to the explanation.
    assert.deepEqual(await act.answer(CRITICAL, 0), { correct: false, resolved: false });
    assert.deepEqual(await act.answer(CRITICAL, 1), { correct: false, resolved: true });
    await assert.rejects(act.answer(CRITICAL, 3), /already finished/);
  });

  await t.test("a hint is recorded, returned, and does not change the first-answer rule", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    assert.deepEqual(await act.hint(LITERAL), { hint: "Think about the literal clue.", resolved: false });
    assert.deepEqual(await act.answer(LITERAL, 1), { correct: true, resolved: true });
    const saved = await response(db, attempt, LITERAL);
    assert.deepEqual([saved.hint_used, saved.first_answer_correct], [true, true]);
    assert.equal(saved.answer_history[0].hintUsed, true, "the answer records that a hint came first");
    // Asking again after the question is finished does not mark a new hint.
    const other = await newAttempt(db);
    const otherAct = actions(db, other);
    await otherAct.answer(INFERENTIAL, 2);
    await otherAct.hint(INFERENTIAL);
    assert.equal((await response(db, other, INFERENTIAL)).hint_used, false);
  });

  await t.test("a retried request is applied once; a reused request ID cannot change the answer", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    const request = id(7999);
    assert.deepEqual(await act.answer(CRITICAL, 0, request), { correct: false, resolved: false });
    assert.deepEqual(await act.answer(CRITICAL, 0, request), { correct: false, resolved: false });
    assert.equal((await response(db, attempt, CRITICAL)).answer_history.length, 1);
    await assert.rejects(act.answer(CRITICAL, 3, request), /Request ID already used/);
    assert.equal((await response(db, attempt, CRITICAL)).answer_history.length, 1);
  });

  await t.test("invalid answers, foreign questions and other learners are refused", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    await assert.rejects(act.answer(LITERAL, 4), /Invalid answer request/);
    await assert.rejects(act.answer(id(8199), 1), /does not belong/);
    await assert.rejects(actions(db, attempt, USERS.student).answer(LITERAL, 1), /Activity not found/);
    assert.equal(await response(db, attempt, LITERAL), undefined);
  });

  await t.test("completion needs every question finished; the saved rows give the first-answer score", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    await act.hint(LITERAL);
    await act.answer(LITERAL, 0); // wrong first, with a hint
    await act.answer(LITERAL, 1);
    await act.answer(INFERENTIAL, 2); // right first
    await assert.rejects(act.complete(), /Finish every question/);
    await act.answer(CRITICAL, 0);
    await act.answer(CRITICAL, 0); // two wrong answers
    assert.deepEqual(await act.complete(), { completed: true });
    assert.deepEqual(await act.complete(), { completed: true }, "a repeated completion is harmless");
    await assert.rejects(act.answer(LITERAL, 1), /already finished|already completed/);

    const { rows } = await db.query("select * from public.m6_comprehension_responses where attempt_id = $1", [attempt]);
    const summary = summarizeComprehension(SNAPSHOT, rows);
    assert.deepEqual([summary.totalQuestions, summary.firstCorrect, summary.firstAttemptPercentage, summary.hintsUsed, summary.allResolved],
      [3, 1, 33, 1, true]);
    assert.deepEqual(["literal", "inferential", "critical"].map((type) => summary.byType[type].firstCorrect), [0, 1, 0]);
    const status = (await db.query("select status, completed_at from public.m6_comprehension_attempts where id = $1", [attempt])).rows[0];
    assert.equal(status.status, "completed");
    assert.ok(status.completed_at);
  });
});
