const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./fixtures/materialDatabase');

test('story reads use only the owned attempt snapshot, including old and missing passages', async t => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const saved = { id, user_id: 'owner', passage_title: 'Original title',
    passage_text: 'Original paragraph.\n\nSecond paragraph.', language: 'en', status: 'in_progress',
    question_snapshot: [{ id: 'q', type: 'literal', questionText: 'Question?', options: ['A','B'], correctOptionIndex: 0 }] };
  const db = createDatabase({ m6_comprehension_attempts: [saved], m6_comprehension_responses: [] });
  const tables = [];
  const from = db.from.bind(db);
  db.from = name => { tables.push(name); return from(name); };
  db.rpc = () => { throw Error('Reading the story must not mutate an attempt'); };
  t.mock.method(require('../services/supabaseAdmin'), 'getSupabaseAdmin', () => db);
  const { getComprehensionAttempt } = require('../services/comprehensionAttemptService');
  for (const text of ['Original paragraph.\n\nSecond paragraph.', 'Nagbasa si Ana.\n\nMasaya siya.', null]) {
    db.tables.m6_comprehension_attempts[0].passage_text = text;
    const result = await getComprehensionAttempt({ user: { id: 'owner' } }, id);
    assert.equal(result.passageText, text);
    assert.equal(result.passageTitle, 'Original title');
    assert.equal(result.questions[0].correctOptionIndex, null);
    assert.equal(result.summary.answered, 0);
  }
  await assert.rejects(getComprehensionAttempt({ user: { id: 'another-user' } }, id), { statusCode: 404 });
  assert.ok(tables.every(name => ['m6_comprehension_attempts', 'm6_comprehension_responses'].includes(name)),
    'Never fetch current, unpublished, or unrelated source materials');
});
