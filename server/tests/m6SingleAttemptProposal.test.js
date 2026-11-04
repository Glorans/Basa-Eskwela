// The PROPOSED M6 single-attempt migration on real PostgreSQL (PGlite, in memory):
// supabase/proposed/m6_single_attempt_PROPOSED.sql over the current
// m6_apply_action (20261026_m8_trusted_xp.sql). Calls run as service_role, as
// the backend does. No network, no staging database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile, id } = require("./fixtures/m5M6SecurityDatabase");
const { createM8TrustDatabase, verifiedDiagnostic, USERS, MODULE } = require("./fixtures/m8TrustDatabase");
const { summarizeComprehension } = require("../services/comprehensionScoring");

const PROPOSED = "supabase/proposed/m6_single_attempt_PROPOSED.sql";
const ROLLBACK = "supabase/proposed/m6_single_attempt_ROLLBACK_PROPOSED.sql";
const Q = [id(8201), id(8202), id(8203)];
const SNAPSHOT = Q.map((questionId, index) => ({
  id: questionId, type: ["literal", "inferential", "critical"][index], questionText: `Question ${index + 1}?`,
  options: ["a", "b", "c", "d"], correctOptionIndex: index + 1, scaffoldingHint: "Look for the clue in the story.",
}));

let submission = 0;
let requests = 0;
async function newAttempt(db, user = USERS.general) {
  const { rows } = await db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,module_id,passage_id,
      passage_title,passage_text,language,question_snapshot,status)
    values ($1,$2,$3,$3,'Story','Story text','en',$4,'in_progress') returning id`,
  [user, id(9600 + ++submission), MODULE.enEasy, JSON.stringify(SNAPSHOT)]);
  return rows[0].id;
}

function actions(db, attempt, user = USERS.general) {
  const call = async (questionId, action, option = null, request = null) => {
    await db.exec("set role service_role");
    try {
      return (await db.query("select public.m6_apply_action($1,$2,$3,$4,$5,$6) as result",
        [attempt, user, questionId, action, option, request])).rows[0].result;
    } finally {
      await db.exec("reset role");
    }
  };
  return {
    answer: (questionId, option, request = id(7100 + ++requests)) => call(questionId, "answer", option, request),
    hint: (questionId) => call(questionId, "hint"),
    complete: () => call(null, "complete"),
  };
}

const responses = async (db, attempt) => (await db.query(
  "select * from public.m6_comprehension_responses where attempt_id = $1 order by question_id", [attempt])).rows;

test("proposed M6 single-attempt rule on real PostgreSQL", { timeout: 180000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));

  // A question left open by the old two-try rule, saved before the migration.
  const legacy = await newAttempt(db);
  assert.deepEqual(await actions(db, legacy).answer(Q[0], 0), { correct: false, resolved: false });
  const before = await responses(db, legacy);

  await db.exec(sqlFile(PROPOSED));

  await t.test("the migration changes no rows", async () => {
    assert.deepEqual(await responses(db, legacy), before);
  });

  await t.test("a correct first answer is final and earns its point", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    assert.deepEqual(await act.answer(Q[0], 1), { correct: true, resolved: true });
    await assert.rejects(act.answer(Q[0], 2), /already has a final answer/);
    const [saved] = await responses(db, attempt);
    assert.deepEqual([saved.first_option_index, saved.first_answer_correct, saved.resolved, saved.answer_history.length], [1, true, true, 1]);
  });

  await t.test("an incorrect first answer is final: no second attempt, zero for that question", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    assert.deepEqual(await act.answer(Q[1], 0), { correct: false, resolved: true });
    // Even the correct option cannot replace it.
    await assert.rejects(act.answer(Q[1], 2), /already has a final answer/);
    const [saved] = await responses(db, attempt);
    assert.deepEqual([saved.first_option_index, saved.first_answer_correct, saved.resolved, saved.answer_history.length], [0, false, true, 1]);
  });

  await t.test("a repeated request returns the saved result once; a reused request ID cannot change it", async () => {
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    const request = id(7199);
    assert.deepEqual(await act.answer(Q[2], 0, request), { correct: false, resolved: true });
    assert.deepEqual(await act.answer(Q[2], 0, request), { correct: false, resolved: true });
    await assert.rejects(act.answer(Q[2], 3, request), /Request ID already used/);
    assert.equal((await responses(db, attempt))[0].answer_history.length, 1);
  });

  await t.test("the hint action is gone", async () => {
    const attempt = await newAttempt(db);
    await assert.rejects(actions(db, attempt).hint(Q[0]), /Invalid activity action/);
    assert.deepEqual(await responses(db, attempt), []);
  });

  await t.test("a legacy open question is refused a new answer and keeps its saved first answer", async () => {
    await assert.rejects(actions(db, legacy).answer(Q[0], 1), /already has a final answer/);
    assert.deepEqual(await responses(db, legacy), before);
  });

  await t.test("completion scores first answers; M8 XP is granted once", async () => {
    await verifiedDiagnostic(db, USERS.general, "en", "Independent", id(7301));
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    await act.answer(Q[0], 1); // correct
    await act.answer(Q[1], 0); // incorrect, final
    await assert.rejects(act.complete(), /Finish every question/);
    await act.answer(Q[2], 3); // correct
    assert.deepEqual(await act.complete(), { completed: true });
    assert.deepEqual(await act.complete(), { completed: true }, "a repeated completion is harmless");
    await assert.rejects(act.answer(Q[1], 2), /already has a final answer|already completed/);

    const summary = summarizeComprehension(SNAPSHOT, await responses(db, attempt));
    assert.deepEqual([summary.firstCorrect, summary.totalQuestions, summary.firstAttemptPercentage, summary.allResolved, summary.hintsUsed],
      [2, 3, 67, true, 0]);
    const xp = (await db.query(`select xp_earned from public.m8_xp_events where user_id = $1 and source_type = 'module'
      and source_id = $2`, [USERS.general, MODULE.enEasy])).rows;
    assert.equal(xp.length, 1, "one module XP event, however often completion is sent");
  });

  await t.test("the guard refuses a drifted definition and the rollback restores the two-try rule", async () => {
    await assert.rejects(db.exec(sqlFile(PROPOSED)), /differs from the expected current/);
    await db.exec("rollback"); // the refused migration leaves its transaction aborted
    await db.exec(sqlFile(ROLLBACK));
    const attempt = await newAttempt(db);
    const act = actions(db, attempt);
    assert.deepEqual(await act.answer(Q[1], 0), { correct: false, resolved: false });
    await assert.rejects(db.exec(sqlFile(ROLLBACK)), /differs from the expected single-attempt/);
    await db.exec("rollback");
    await db.exec(sqlFile(PROPOSED));
  });
});
