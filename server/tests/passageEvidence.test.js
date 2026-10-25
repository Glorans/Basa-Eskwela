const assert = require("node:assert/strict");
const test = require("node:test");
const { checkEvidence, completeEvidence, displayEvidence } = require("../services/passageEvidence");
const { validateGeneratedQuestions } = require("../services/questionGenerationService");
const { saveMaterialQuestionSet, reviewMaterialQuestionSet } = require("../services/materialQuestionSetService");
const { createDatabase, dependencies, requester, material, generatedQuestions, TEACHER_A, MATERIAL_A } = require("./fixtures/materialDatabase");

// The saved passage keeps the PDF's hard line breaks, which is where the
// reported quote stopped: "...an elderly neighbor who" + newline + "lived alone."
const STORY = `A Helping Hand
Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who
lived alone. Her hands were weak, so carrying groceries was difficult for
her. Ben would buy her vegetables at the market.

In return, Mrs. Santos told him wonderful stories. "Thank you!" she said. The market was 1.5 km away.`;
const KUWENTO = `Ang Mabait na Bata
Tuwing Sabado, binibisita ni Ben si Gng. Santos, isang matandang
kapitbahay na nakatira nang mag-isa. Mahina na ang kanyang mga kamay.`;
const collapse = (text) => text.replace(/\s+/g, " ").trim();

test("a quote cut at a line break is completed to the passage's own sentence", () => {
  assert.equal(displayEvidence(STORY, "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who"),
    "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who lived alone.");
  assert.equal(displayEvidence(STORY, "carrying groceries was difficult for"),
    "Her hands were weak, so carrying groceries was difficult for her.");
  // A quote spanning two sentences keeps both, whole.
  assert.equal(displayEvidence(STORY, "lived alone. Her hands"),
    "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who lived alone. Her hands were weak, so carrying groceries was difficult for her.");
});

test("abbreviations, initials, decimals and quoted speech do not end a sentence early", () => {
  assert.equal(displayEvidence(STORY, "Ben visited Mrs."), "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who lived alone.");
  assert.equal(displayEvidence(STORY, "she said"), "\"Thank you!\" she said.");
  assert.equal(displayEvidence(STORY, "The market was 1.5"), "The market was 1.5 km away.");
  assert.equal(displayEvidence("J. Rizal wrote it. Then he left.", "Rizal wrote"), "J. Rizal wrote it.");
});

test("Filipino passages use the same rules, including Gng.", () => {
  assert.equal(displayEvidence(KUWENTO, "binibisita ni Ben si Gng. Santos, isang matandang"),
    "Tuwing Sabado, binibisita ni Ben si Gng. Santos, isang matandang kapitbahay na nakatira nang mag-isa.");
  assert.equal(displayEvidence(KUWENTO, "Mahina na ang kanyang mga kamay."), "Mahina na ang kanyang mga kamay.");
});

test("a title line above the story is never merged into the first sentence", () => {
  assert.equal(displayEvidence(STORY, "Every Saturday"), "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who lived alone.");
  assert.equal(displayEvidence(KUWENTO, "Tuwing Sabado"),
    "Tuwing Sabado, binibisita ni Ben si Gng. Santos, isang matandang kapitbahay na nakatira nang mag-isa.");
});

test("an unreliable match keeps the stored evidence exactly; nothing is invented", () => {
  // "Mrs. Santos" appears twice: which sentence is meant cannot be known.
  assert.deepEqual(completeEvidence(STORY, "Mrs. Santos"), { text: "Mrs. Santos", reliable: false, changed: false });
  assert.equal(displayEvidence(STORY, "Mrs. Santos"), "Mrs. Santos");
  // Not in the passage, or crossing paragraphs: unchanged.
  assert.equal(displayEvidence(STORY, "Ben ate an apple"), "Ben ate an apple");
  assert.equal(displayEvidence(STORY, "at the market. In return"), "at the market. In return");
  // Every completed quote is text from the passage itself.
  for (const quote of ["an elderly neighbor who", "difficult for", "she said", "In return,"]) {
    assert.ok(collapse(STORY).includes(displayEvidence(STORY, quote)), quote);
  }
  // A sentence with no ending punctuation for too long is not completed.
  const long = `${"word ".repeat(400)}end`;
  assert.equal(completeEvidence(long, "word word").reliable, false);
});

test("future generations: fragments are completed from the passage or rejected", () => {
  const questions = generatedQuestions().map((question, index) => ({
    ...question, answerExplanation: "Because the story says so.",
    supportingEvidence: index === 0 ? "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who" : "Ben would buy her vegetables at the market.",
  }));
  const valid = validateGeneratedQuestions({ questions }, 6, STORY);
  assert.equal(valid[0].supportingEvidence, "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who lived alone.");
  assert.equal(valid[1].supportingEvidence, "Ben would buy her vegetables at the market.");
  // An ambiguous fragment cannot be completed, so the set is sent back for repair.
  questions[2] = { ...questions[2], supportingEvidence: "Mrs. Santos" };
  // The reason is passed back to Gemini as repair feedback.
  assert.throws(() => validateGeneratedQuestions({ questions }, 6, STORY),
    (error) => error.code === "INVALID_GEMINI_RESPONSE" && /Question 3 quotes an incomplete sentence/.test(error.cause.message));
  assert.deepEqual(checkEvidence(STORY, "Mrs. Santos"), { evidence: "Mrs. Santos", changed: false, incomplete: true });
});

function setDatabase(content, evidence) {
  const SET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const questions = generatedQuestions();
  const db = createDatabase({
    uploaded_materials: [{ ...material(MATERIAL_A, TEACHER_A), content_text: content }],
    material_question_sets: [{ id: SET, material_id: MATERIAL_A, name: "Question Set 1", sequence_number: 1, revision: 1 }],
    comprehension_questions: questions.map((question, index) => ({ id: question.id, material_id: MATERIAL_A, question_set_id: SET,
      question_type: question.type, question_text: question.questionText, options: question.options,
      scaffolding_hint: question.scaffoldingHint, review_status: "generated", display_order: index + 1 })),
    comprehension_question_answers: questions.map((question, index) => ({ question_id: question.id, correct_answer: question.correctAnswer,
      answer_explanation: null, supporting_evidence: index === 0 ? evidence : null })),
  });
  return { db, SET, questions };
}

test("teacher saves store complete sentences; approval refuses fragments that cannot be completed", async () => {
  const teacher = requester(TEACHER_A, "teacher");
  const fragment = setDatabase(STORY, "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who");
  let sent;
  fragment.db.rpc = async (_name, args) => { sent = args; return { data: fragment.SET }; };
  await saveMaterialQuestionSet(teacher, MATERIAL_A, fragment.SET, 1, fragment.questions.map((question, index) => ({
    ...question, supportingEvidence: index === 0 ? "Her hands were weak" : undefined })), dependencies(fragment.db));
  assert.equal(sent.bank[0].supportingEvidence, "Her hands were weak, so carrying groceries was difficult for her.");
  await assert.rejects(saveMaterialQuestionSet(teacher, MATERIAL_A, fragment.SET, 1, fragment.questions.map((question, index) => ({
    ...question, supportingEvidence: index === 0 ? "Mrs. Santos" : undefined })), dependencies(fragment.db)), /incomplete sentence/);

  // Approval never edits: a fragment that can be completed for display may be approved...
  const completable = setDatabase(STORY, "an elderly neighbor who");
  completable.db.rpc = async () => ({ data: completable.SET });
  await reviewMaterialQuestionSet(teacher, MATERIAL_A, completable.SET, 1, dependencies(completable.db));
  assert.equal(completable.db.tables.comprehension_question_answers[0].supporting_evidence, "an elderly neighbor who");
  // ...but an incomplete fragment that cannot be completed reliably is refused before any write.
  const ambiguous = setDatabase(STORY, "Mrs. Santos");
  let wrote = false;
  ambiguous.db.rpc = async () => { wrote = true; return { data: ambiguous.SET }; };
  await assert.rejects(reviewMaterialQuestionSet(teacher, MATERIAL_A, ambiguous.SET, 1, dependencies(ambiguous.db)), /incomplete sentence/);
  assert.equal(wrote, false);
});

test("an existing approved question set shows complete evidence without changing saved records", async (t) => {
  const { createDatabase: createDb } = require("./fixtures/materialDatabase");
  const ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
  const QUESTION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
  const snapshot = [{ id: QUESTION, type: "literal", questionText: "Who did Ben visit?", options: ["A", "Mrs. Santos", "C", "D"],
    correctOptionIndex: 1, scaffoldingHint: "Think about Saturday.", answerExplanation: "The story names her.",
    supportingEvidence: "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who" }];
  const db = createDb({
    m6_comprehension_attempts: [{ id: ATTEMPT, user_id: "owner", question_snapshot: structuredClone(snapshot),
      status: "completed", passage_text: STORY }],
    m6_comprehension_responses: [{ attempt_id: ATTEMPT, question_id: QUESTION, first_option_index: 1,
      first_answer_correct: true, resolved: true, hint_used: false }],
  });
  t.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => db);
  const { getComprehensionAttempt } = require("../services/comprehensionAttemptService");
  const attempt = await getComprehensionAttempt({ user: { id: "owner" } }, ATTEMPT);
  assert.equal(attempt.questions[0].supportingEvidence, "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who lived alone.");
  // The saved snapshot, answer key and score are untouched.
  assert.deepEqual(db.tables.m6_comprehension_attempts[0].question_snapshot, snapshot);
  assert.deepEqual([attempt.questions[0].correctOptionIndex, attempt.summary.firstCorrect, attempt.summary.firstAttemptPercentage], [1, 1, 100]);
});
