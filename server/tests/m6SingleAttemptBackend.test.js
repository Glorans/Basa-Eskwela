// M6 single attempt enforced by the backend while the database still runs the
// current two-try m6_apply_action (emulated in memory below). No Supabase, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("./fixtures/materialDatabase");
const { summarizeComprehension } = require("../services/comprehensionScoring");

const ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OWNER = { user: { id: "owner" } };
const ids = ["1", "2", "3"].map((n) => `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${n}`);
const request = (n) => `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(n).padStart(2, "0")}`;
const questions = ids.map((id, index) => ({
  id, type: ["literal", "inferential", "critical"][index], questionText: `Question ${index + 1}?`,
  options: ["A", "B", "C", "D"], correctOptionIndex: index,
  scaffoldingHint: index === 2 ? "The passage supports this answer." : "Look at what Maya did first.",
  answerExplanation: "The passage supports this answer.", supportingEvidence: "Saved passage",
}));

/** The current (two-try) database function, as in 20261026_m8_trusted_xp.sql. */
function currentRpc(db, calls) {
  return async (name, args) => {
    calls.push(args.action_name);
    const attempt = db.tables.m6_comprehension_attempts.find((row) => row.id === args.target_attempt);
    const rows = db.tables.m6_comprehension_responses;
    if (args.action_name === "complete") {
      if (attempt.status === "completed") return { data: { completed: true } };
      const open = questions.some((q) => !rows.some((r) => r.attempt_id === attempt.id && r.question_id === q.id && r.resolved));
      if (open) return { error: { code: "22023", message: "Finish every question before completing" } };
      attempt.status = "completed";
      return { data: { completed: true } };
    }
    if (args.action_name === "hint") return { data: { hint: "x", resolved: false } };
    let row = rows.find((r) => r.attempt_id === attempt.id && r.question_id === args.target_question);
    const previous = row?.answer_history.find((h) => h.requestId === args.request_id);
    if (previous) return { data: { correct: previous.correct, resolved: row.resolved } };
    if (!row) {
      row = { id: `r${rows.length}`, attempt_id: attempt.id, question_id: args.target_question, first_option_index: null,
        first_answer_correct: null, answer_history: [], hint_used: false, resolved: false };
      rows.push(row);
    }
    if (row.resolved) return { error: { code: "22023", message: "This question is already finished" } };
    const correct = args.selected_option === questions.find((q) => q.id === args.target_question).correctOptionIndex;
    row.answer_history = [...row.answer_history, { requestId: args.request_id, optionIndex: args.selected_option, correct }];
    row.first_option_index ??= args.selected_option;
    row.first_answer_correct ??= correct;
    row.resolved = correct || row.answer_history.length >= 2;
    return { data: { correct, resolved: row.resolved } };
  };
}

function setup(t, responses = []) {
  const db = createDatabase({
    m6_comprehension_attempts: [{ id: ATTEMPT, user_id: "owner", question_snapshot: questions,
      status: "in_progress", passage_text: "Saved passage", language: "en" }],
    m6_comprehension_responses: responses,
  });
  const calls = [];
  db.rpc = currentRpc(db, calls);
  t.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => db);
  // Fresh service instances bound to this test's in-memory database.
  for (const service of ["comprehensionActionService", "comprehensionAttemptService"]) {
    delete require.cache[require.resolve(`../services/${service}`)];
  }
  const { applyComprehensionAction } = require("../services/comprehensionActionService");
  const { getComprehensionAttempt } = require("../services/comprehensionAttemptService");
  const answer = (questionIndex, optionIndex, n) => applyComprehensionAction(OWNER, ATTEMPT,
    { action: "answer", questionId: ids[questionIndex], optionIndex, requestId: request(n) });
  return { db, calls, answer, applyComprehensionAction, getComprehensionAttempt };
}

test("a correct first answer is final and shows Correct feedback without a scaffolding prompt", async (t) => {
  const { db, answer } = setup(t);
  const result = await answer(0, 0, 1);
  assert.deepEqual(result.outcome, { correct: true, resolved: true, final: true });
  const question = result.attempt.questions[0];
  assert.deepEqual([question.resolved, question.firstOptionIndex, question.firstAnswerCorrect, question.correctOptionIndex],
    [true, 0, true, 0]);
  assert.equal(question.answerExplanation, "The passage supports this answer.");
  assert.equal(question.scaffoldingPrompt, null);
  assert.equal(db.tables.m6_comprehension_responses[0].resolved, true);
});

test("an incorrect first answer is final: zero for the question, feedback and a separate guiding prompt", async (t) => {
  const { db, calls, answer } = setup(t);
  const result = await answer(1, 0, 2);
  assert.deepEqual(result.outcome, { correct: false, resolved: true, final: true });
  // The backend closed the question the current database function would have left open.
  assert.equal(db.tables.m6_comprehension_responses[0].resolved, true);
  const question = result.attempt.questions[1];
  assert.deepEqual([question.resolved, question.firstAnswerCorrect, question.correctOptionIndex], [true, false, 1]);
  assert.equal(question.answerExplanation, "The passage supports this answer.");
  assert.equal(question.supportingEvidence, "Saved passage");
  assert.equal(question.scaffoldingPrompt, "Look at what Maya did first.");
  assert.equal(result.attempt.summary.firstCorrect, 0);
  assert.equal(result.attempt.summary.byType.inferential.firstCorrect, 0);

  // No second attempt: even the correct option is refused before the database is called.
  await assert.rejects(answer(1, 1, 3), { statusCode: 409, message: "This question already has a final answer." });
  assert.deepEqual(calls, ["answer"]);
  assert.equal(db.tables.m6_comprehension_responses[0].answer_history.length, 1);
  assert.equal(db.tables.m6_comprehension_responses[0].first_option_index, 0);
});

test("a duplicate request is treated as already submitted; refresh does not unlock the answer", async (t) => {
  const { db, calls, answer, applyComprehensionAction, getComprehensionAttempt } = setup(t);
  await answer(2, 3, 4);
  const again = await answer(2, 3, 4); // the same request after an uncertain network save
  assert.deepEqual(again.outcome, { correct: false, resolved: true, final: true });
  assert.deepEqual(calls, ["answer"], "the retry never reaches the database again");
  await assert.rejects(answer(2, 1, 4), /Request ID already used for another answer/);
  // A refresh (new page load) sees the same locked answer.
  const reloaded = await getComprehensionAttempt(OWNER, ATTEMPT);
  assert.deepEqual([reloaded.questions[2].resolved, reloaded.questions[2].firstOptionIndex], [true, 3]);
  await assert.rejects(answer(2, 2, 5), { statusCode: 409 });
  // The scaffolding prompt is left out when it would only repeat the explanation.
  assert.equal(reloaded.questions[2].scaffoldingPrompt, null);
  // There is no separate hint action any more.
  await assert.rejects(applyComprehensionAction(OWNER, ATTEMPT, { action: "hint", questionId: ids[0] }), { statusCode: 400 });
  assert.equal(db.tables.m6_comprehension_responses.length, 1);
});

test("completion closes questions left open by the old rule and keeps first-answer scores", async (t) => {
  // Saved under the two-try rule: a wrong first answer still open, mid-activity.
  const { db, calls, answer, applyComprehensionAction } = setup(t, [{ id: "legacy", attempt_id: ATTEMPT, question_id: ids[0],
    first_option_index: 2, first_answer_correct: false, answer_history: [{ requestId: request(9), optionIndex: 2, correct: false }],
    hint_used: true, resolved: false }]);
  await assert.rejects(answer(0, 0, 10), { statusCode: 409 }, "the legacy open question gets no second attempt");
  await answer(1, 1, 11); // correct
  await answer(2, 0, 12); // incorrect
  const done = await applyComprehensionAction(OWNER, ATTEMPT, { action: "complete" });
  assert.deepEqual(done.outcome, { completed: true });
  assert.equal(db.tables.m6_comprehension_attempts[0].status, "completed");
  assert.deepEqual(await applyComprehensionAction(OWNER, ATTEMPT, { action: "complete" }).then((r) => r.outcome), { completed: true });
  assert.deepEqual(calls, ["answer", "answer", "complete", "complete"]);

  // What M7 reads: every question answered and finished, scored by the saved first answer.
  const rows = db.tables.m6_comprehension_responses;
  assert.deepEqual(rows.map((row) => row.answer_history.length), [1, 1, 1], "no second answers were stored");
  const summary = summarizeComprehension(questions, rows);
  assert.deepEqual([summary.answered, summary.allResolved, summary.firstCorrect, summary.firstAttemptPercentage, summary.hintsUsed],
    [3, true, 1, 33, 1]);
  assert.equal(rows[0].first_option_index, 2, "the historical answer is unchanged");
  assert.equal(done.attempt.summary.firstCorrect, 1);
});
