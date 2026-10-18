const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAdminModulePassagesRouter } = require('../routes/adminModulePassages');
const { SupabaseAuthenticationError } = require('../services/supabaseAdmin');
const { generateComprehensionQuestions } = require('../services/questionGenerationService');

const collection = { id: 'module', revision: 7, status: 'draft', publishedAt: null, language: 'fil', passages: [
  { id: 'first', passageText: 'Trusted first text' }, { id: 'second', passageText: 'Trusted selected text' },
] };

for (const [language, expected] of [['English', 'en'], ['Filipino', 'fil'], ['english', 'en'], ['filipino', 'fil'], ['en', 'en'], ['fil', 'fil']]) {
  test(`saved learning-path language ${language} reaches generation as ${expected}`, async t => {
    let received;
    const { response } = await request(t, {
      client: { rpc: async name => ({ data: name === 'm3_admin_collection' ? { ...collection, language } : 8 }) },
      generate: async input => { received = input.language; return []; },
    });
    assert.equal(response.status, 200);
    assert.equal(received, expected);
  });
}
for (const language of ['', null, undefined, 'Spanish']) {
  test(`invalid saved language ${String(language)} does not reach generation or persistence`, async t => {
    const names = [];
    const { response } = await request(t, {
      client: { rpc: async name => { names.push(name); return { data: { ...collection, language } }; } },
      generate: async () => { assert.fail('Invalid language must not reach Gemini'); },
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /learning path.*language/);
    assert.deepEqual(names, ['m3_admin_collection']);
  });
}
async function request(t, overrides = {}, body = { revision: 7 }, passage = 'second') {
  const calls = [];
  const app = express(); app.use(express.json());
  app.use('/modules', createAdminModulePassagesRouter({
    authenticate: async () => ({ id: 'admin' }),
    client: { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'm3_admin_collection' ? collection : 8 }; } },
    generate: async input => { calls.push({ input }); return ['validated bank']; }, ...overrides,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/modules/module/passages/${passage}/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { response, calls };
}
test('generates only trusted selected passage and saves against captured revision', async t => {
  const { response, calls } = await request(t, {}, { revision: 7, contentText: 'Injected text', language: 'en' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[1].input, { contentText: 'Trusted selected text', language: 'fil' });
  assert.equal(calls[2].args.target_passage, 'second');
  assert.equal(calls[2].args.expected_revision, 7);
  assert.equal(calls[2].args.bank_action, 'generate');
});
test('unauthenticated requests never reach a database or generator', async t => {
  const { response, calls } = await request(t, { authenticate: async () => { throw new SupabaseAuthenticationError(); } });
  assert.equal(response.status, 401); assert.deepEqual(calls, []);
});
test('Admin RPC denial prevents generation for nonadmins', async t => {
  const { response, calls } = await request(t, { client: { rpc: async () => ({ error: { message: 'Admin access required' } }) } });
  assert.equal(response.status, 403); assert.deepEqual(calls, []);
});
test('cross-module passage and stale revision never generate', async t => {
  let result = await request(t, {}, { revision: 7 }, 'foreign');
  assert.equal(result.response.status, 404); assert.equal(result.calls.length, 1);
  result = await request(t, {}, { revision: 6 });
  assert.equal(result.response.status, 409); assert.equal(result.calls.length, 1);
});
test('historical module cannot regenerate', async t => {
  const { response } = await request(t, { client: { rpc: async () => ({ data: { ...collection, publishedAt: '2026-01-01' } }) } });
  assert.equal(response.status, 409);
});
test('concurrent edit during generation returns conflict instead of stale success', async t => {
  const { response } = await request(t, { client: { rpc: async name => name === 'm3_admin_collection' ? { data: collection } : { error: { message: 'Revision conflict' } } } });
  assert.equal(response.status, 409);
});
test('blank saved text rejects generation', async t => {
  const { response } = await request(t, { client: { rpc: async () => ({ data: { ...collection, passages: [{ id: 'second', passageText: '' }] } }) } });
  assert.equal(response.status, 400);
});

test('invalid Gemini output is rejected before passage-bank persistence', async t => {
  const { response, calls } = await request(t, {
    generate: input => generateComprehensionQuestions(input, {
      generateContent: async () => ({ text: JSON.stringify({ questions: [] }) }),
    }),
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /invalid question set/);
  assert.deepEqual(calls.map(call => call.name), ['m3_admin_collection']);
});

test('validated Gemini output is saved as six questions with the existing passage RPC', async t => {
  const questions = ['literal', 'literal', 'inferential', 'inferential', 'critical', 'critical'].map((type, i) => ({
    type, questionText: `Tanong ${i + 1}?`, options: ['Una', 'Ikalawa', 'Ikatlo', 'Ikaapat'],
    correctAnswer: 'Una', scaffoldingHint: 'Basahin ang teksto.',
    answerExplanation: 'Sinusuportahan ng napiling teksto ang unang sagot.',
    supportingEvidence: 'Trusted selected text',
  }));
  const { response, calls } = await request(t, {
    generate: input => generateComprehensionQuestions(input, {
      generateContent: async parameters => {
        assert.match(parameters.contents, /Filipino/);
        assert.match(parameters.contents, /Trusted selected text/);
        return { text: JSON.stringify({ questions }) };
      },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls[1].name, 'm3_save_passage_bank');
  assert.equal(calls[1].args.bank.length, 6);
  assert.deepEqual(calls[1].args.bank.map(q => q.type), questions.map(q => q.type));
  assert.ok(calls[1].args.bank.every(q => q.options.length === 4 && q.options.includes(q.correctAnswer)));
  assert.ok(calls[1].args.bank.every(q => q.answerExplanation && q.supportingEvidence === 'Trusted selected text'));
});
