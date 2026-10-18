const test = require('node:test');
const assert = require('node:assert/strict');
const { generateComprehensionQuestions } = require('../services/questionGenerationService');
const { generateMaterialQuestionSet } = require('../services/materialQuestionSetService');
const { createDatabase, dependencies, material, requester, generatedQuestions, MATERIAL_A, MATERIAL_B, TEACHER_A } = require('./fixtures/materialDatabase');
const teacher = requester(TEACHER_A, 'teacher');
function bank(count = 6) {
  return Array.from({ length: count }, (_, i) => ({ ...generatedQuestions()[i % 6],
    type: ['literal', 'inferential', 'critical'][Math.floor(i / (count / 3))], questionText: `Question ${i}?`,
    answerExplanation: 'The source supports the selected answer.', supportingEvidence: 'Source' }));
}
for (const count of [3, 6, 9, 12]) test(`generates ${count} balanced questions with only a language audit`, async () => {
  let calls = 0;
  const questions = await generateComprehensionQuestions({ contentText: 'Source', language: 'fil', previousQuestions: [], questionCount: count }, {
    generateContent: async request => {
      calls++;
      if (calls === 1) {
        assert.equal(request.config.responseJsonSchema.properties.questions.minItems, count);
        assert.equal(request.config.responseJsonSchema.properties.questions.maxItems, count);
        assert.match(request.contents, /similar ideas are allowed/);
        assert.match(request.contents, /in Filipino/);
        return { text: JSON.stringify({ questions: bank(count) }) };
      }
      assert.match(request.contents, /Check only language/);
      return { text: JSON.stringify({ correctLanguage: true }) };
    },
  });
  assert.equal(calls, 2); assert.equal(questions.length, count);
  for (const type of ['literal', 'inferential', 'critical']) assert.equal(questions.filter(q => q.type === type).length, count / 3);
});
test('similar ideas are accepted; normalized exact repeats are rejected after one retry', async () => {
  const prior = 'What animals take a bath in the river after plowing?';
  const questions = bank(); questions[0].questionText = 'What animals bathe in the river after plowing?';
  let calls = 0;
  const input = { contentText: 'Source', language: 'en', previousQuestions: [{ questionText: prior }] };
  const result = await generateComprehensionQuestions(input, { generateContent: async () => ({ text: JSON.stringify(calls++ === 0 ? { questions } : { correctLanguage: true }) }) });
  assert.equal(result.length, 6); assert.equal(calls, 2);
  questions[0].questionText = prior.toUpperCase(); calls = 0;
  await assert.rejects(generateComprehensionQuestions(input, { generateContent: async () => { calls++; return { text: JSON.stringify({ questions }) }; } }), { code: 'DUPLICATE_QUESTION' });
  assert.equal(calls, 2);
});
test('rejects invalid counts and wrong language without a semantic audit', async () => {
  for (const questionCount of [0, 5, 7, '6', null]) await assert.rejects(generateComprehensionQuestions({ contentText: 'Source', language: 'en', questionCount }, { generateContent: () => assert.fail() }), { code: 'INVALID_QUESTION_COUNT' });
  let calls = 0;
  await assert.rejects(generateComprehensionQuestions({ contentText: 'Source', language: 'fil', previousQuestions: [] }, {
    generateContent: async () => ({ text: JSON.stringify(calls++ % 2 === 0 ? { questions: bank() } : { correctLanguage: false }) }),
  }), { code: 'QUESTION_LANGUAGE_MISMATCH' });
  assert.equal(calls, 4);
});
test('loads all history only for the authorized material and rejects missing saved language', async () => {
  const db = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A)],
    comprehension_questions: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), material_id: MATERIAL_A, question_text: `Saved ${i}`, question_type: 'literal' })) });
  db.tables.comprehension_questions.push({ material_id: MATERIAL_B, question_text: 'Other material' });
  const captured = new Error('Stop before write');
  await assert.rejects(generateMaterialQuestionSet(teacher, MATERIAL_A, null, null, async input => {
    assert.equal(input.previousQuestions.length, 1001); assert.equal(input.questionCount, 9); assert.equal(input.language, 'en'); throw captured;
  }, dependencies(db), 9), error => error === captured);
  db.tables.uploaded_materials[0].language = null;
  await assert.rejects(generateMaterialQuestionSet(teacher, MATERIAL_A, null, null, () => assert.fail(), dependencies(db)), /saved material language/);
});
