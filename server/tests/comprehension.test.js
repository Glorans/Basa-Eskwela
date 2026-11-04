const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAnswer, summarizeComprehension } = require("../services/comprehensionScoring");
const { createDatabase } = require("./fixtures/materialDatabase");

const ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const QUESTION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const questions = ["literal", "inferential", "critical"].map((type, index) => ({
  id: index === 0 ? QUESTION : `${QUESTION.slice(0, -1)}${index}`,
  type, questionText: `Question ${index + 1}?`, options: ["A", "B", "C", "D"],
  correctOptionIndex: index, scaffoldingHint: "Read the passage again.",
  answerExplanation: "The passage supports this answer.", supportingEvidence: "Saved passage",
}));

test("comprehension scores protected first answers independently of retries and hints", () => {
  const responses = [
    { question_id: questions[0].id, first_option_index: 0, first_answer_correct: false, resolved: true },
    { question_id: questions[1].id, first_option_index: 0, first_answer_correct: true,
      resolved: true, hint_used: true, answer_history: [{ optionIndex: 1, correct: true }] },
  ];
  const summary = summarizeComprehension(questions, responses);
  assert.equal(summary.firstCorrect, 1);
  assert.equal(summary.firstAttemptPercentage, 33);
  assert.equal(summary.answered, 2);
  assert.equal(summary.resolved, 2);
  assert.equal(summary.hintsUsed, 1);
  assert.equal(summary.allResolved, false);
  assert.equal(summary.byType.literal.firstAttemptPercentage, 100);
  assert.equal(summary.byType.inferential.firstAttemptPercentage, 0);
  assert.equal(summary.byType.critical.answered, 0);
  assert.equal(summarizeComprehension(questions, [
    ...responses, { question_id: questions[2].id, first_option_index: 2, resolved: true },
  ]).allResolved, true);
});

test("comprehension rejects invalid selections, answer keys, and duplicate or foreign responses", () => {
  assert.equal(checkAnswer(questions[0], 0), true);
  assert.equal(checkAnswer(questions[0], 1), false);
  for (const value of [-1, 4, 0.5, "0", null]) {
    assert.throws(() => checkAnswer(questions[0], value), /valid answer/);
  }
  assert.throws(() => checkAnswer({ ...questions[0], correctOptionIndex: 4 }, 0), /Invalid saved question/);
  assert.throws(() => summarizeComprehension([], []), /no questions/);
  assert.throws(() => summarizeComprehension([questions[0], questions[0]], []), /question bank/);
  assert.throws(() => summarizeComprehension(questions, [{ question_id: "foreign" }]), /question response/);
  assert.throws(() => summarizeComprehension(questions, [
    { question_id: QUESTION }, { question_id: QUESTION },
  ]), /duplicate question response/);
});

test("comprehension ownership, feedback disclosure, and action RPC boundaries", async t => {
  const db = createDatabase({
    m6_comprehension_attempts: [{ id: ATTEMPT, user_id: "owner", question_snapshot: questions,
      status: "in_progress", passage_text: "Saved passage" }],
    m6_comprehension_responses: [{ attempt_id: ATTEMPT, question_id: QUESTION,
      first_option_index: 0, first_answer_correct: true, resolved: true, hint_used: false }],
  });
  const calls = [];
  db.rpc = async (name, args) => { calls.push({ name, args }); return { data: { correct: true, resolved: true } }; };
  // Load the actual services against an in-memory database; never connect to Supabase.
  t.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => db);
  const { getComprehensionAttempt, startComprehensionAttempt } = require("../services/comprehensionAttemptService");
  const { applyComprehensionAction } = require("../services/comprehensionActionService");
  const owner = { user: { id: "owner" } };
  const foreign = { user: { id: "other" } };
  const attempt = await getComprehensionAttempt(owner, ATTEMPT);
  assert.equal(attempt.questions[0].correctOptionIndex, 0);
  assert.equal(attempt.questions[0].answerExplanation, questions[0].answerExplanation);
  assert.equal(attempt.questions[0].supportingEvidence, "Saved passage");
  for (const question of attempt.questions.slice(1)) {
    assert.equal(question.correctOptionIndex, null);
    assert.equal(question.answerExplanation, null);
    assert.equal(question.supportingEvidence, null);
    assert.equal(question.hint, null);
  }
  assert.equal("question_snapshot" in attempt, false);
  assert.equal("scaffoldingHint" in attempt.questions[1], false);
  await assert.rejects(getComprehensionAttempt(foreign, ATTEMPT), { statusCode: 404 });
  await assert.rejects(applyComprehensionAction(foreign, ATTEMPT, { action: "complete" }), { statusCode: 404 });
  assert.equal(calls.length, 0);
  for (const body of [null, { action: "delete" }, { action: "answer", questionId: QUESTION, requestId: REQUEST, optionIndex: 4 }]) {
    await assert.rejects(applyComprehensionAction(owner, ATTEMPT, body), { statusCode: 400 });
  }
  // The answered question already has its final answer: no second answer reaches the database.
  await assert.rejects(applyComprehensionAction(owner, ATTEMPT, {
    action: "answer", questionId: QUESTION, requestId: REQUEST, optionIndex: 1,
  }), { statusCode: 409 });
  assert.equal(calls.length, 0);
  await applyComprehensionAction(owner, ATTEMPT, {
    action: "answer", questionId: questions[1].id, requestId: REQUEST, optionIndex: 0,
    userId: "forged", firstAnswerCorrect: false,
  });
  assert.deepEqual(calls, [{ name: "m6_apply_action", args: {
    target_attempt: ATTEMPT, target_user: "owner", target_question: questions[1].id,
    action_name: "answer", selected_option: 0, request_id: REQUEST,
  } }]);
  // Legacy saved questions remain usable without newly generated feedback.
  db.tables.m6_comprehension_attempts[0].question_snapshot = questions.map(question => ({
    ...question, answerExplanation: null, supportingEvidence: null,
  }));
  assert.equal((await getComprehensionAttempt(owner, ATTEMPT)).questions[0].answerExplanation, null);
  await assert.rejects(startComprehensionAttempt(owner, { moduleId: "invalid" }), { statusCode: 400 });
});
