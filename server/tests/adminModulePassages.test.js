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
    assert.match((await response.json()).message, /saved passage text.*language/);
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
  assert.deepEqual(calls[1].input, { contentText: 'Trusted selected text', language: 'fil', questionCount: 6 });
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
  const { response } = await request(t, { client: { rpc: async name => name === 'm3_admin_collection' ? { data: collection } : { error: { code: 'P0001', message: 'This module changed. Reload before saving.' } } } });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /changed while the questions were being generated/);
});
for (const [databaseMessage, status, expected] of [
  ['Referenced module content must be preserved', 409, /already used by rooms or learners/],
  ['Only never-published drafts can be edited; preserve historical content', 409, /published/],
  ['Passage belongs to another module', 404, /no longer in the module/],
  ['Exactly two literal questions are required', 502, /did not pass the database checks/],
  ['Supporting evidence must contain 1 to 1000 characters', 502, /did not pass the database checks/],
  // The live staging defect: a database function error is not a stale module.
  ['column reference "question_id" is ambiguous', 500, /database error.*No questions were saved/],
]) {
  test(`bank save refusal "${databaseMessage}" is reported as ${status}`, async t => {
    const { response } = await request(t, { client: { rpc: async name => name === 'm3_admin_collection' ? { data: collection } : { error: { code: '42702', message: databaseMessage } } } });
    assert.equal(response.status, status);
    const { message } = await response.json();
    assert.match(message, expected);
    assert.doesNotMatch(message, /question_id|ambiguous/);
  });
}
test('proposed passage-bank fix qualifies every answer-key delete', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const live = fs.readFileSync(path.join(__dirname, '../../readflow/supabase/m6_comprehension_functions.sql'), 'utf8');
  const proposal = fs.readFileSync(path.join(__dirname, '../../supabase/proposed/m3_save_passage_bank_fix_PROPOSED.sql'), 'utf8');
  const body = sql => sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.m3_save_passage_bank'), sql.indexOf('$function$;', sql.indexOf('CREATE OR REPLACE FUNCTION public.m3_save_passage_bank')));
  // The live definition declares a question_id variable, so an unqualified column is ambiguous.
  assert.match(body(live), /question_id uuid;/);
  assert.equal((body(live).match(/WHERE question_id IN/g) || []).length, 2);
  assert.equal((body(proposal).match(/WHERE question_id IN/g) || []).length, 0);
  assert.equal((body(proposal).match(/WHERE answer\.question_id IN/g) || []).length, 2);
  // Nothing else changes: the six-question 2/2/2 policy and all checks are kept verbatim.
  const normalize = sql => body(sql).replace(/comprehension_question_answers AS answer\s+WHERE answer\.question_id/g, 'comprehension_question_answers WHERE question_id').replace(/\s+/g, ' ');
  assert.equal(normalize(proposal), normalize(live));
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
  assert.match((await response.json()).message, /could not produce a valid question set/);
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

// 6/9/12 question banks: six needs no database support; nine and twelve are only generated
// once m3_passage_bank_sizes() exists, and the check happens before any billable request.
test('a request without questionCount still generates six and never asks for the capability', async t => {
  const { response, calls } = await request(t);
  assert.equal(response.status, 200);
  assert.equal(calls[1].input.questionCount, 6);
  assert.deepEqual(calls.filter(call => call.name).map(call => call.name), ['m3_admin_collection', 'm3_save_passage_bank']);
});
for (const questionCount of [9, 12]) {
  test(`${questionCount} questions are refused before generation while the database lacks support`, async t => {
    const { response, calls } = await request(t, {
      client: { rpc: async name => name === 'm3_admin_collection' ? { data: collection }
        : name === 'm3_passage_bank_sizes' ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
        : assert.fail(`${name} must not run`) },
      generate: async () => assert.fail('No billable generation without database support'),
    }, { revision: 7, questionCount });
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /not available yet.*No questions were generated/);
  });
  test(`${questionCount} questions reach generation and the save RPC once the database supports them`, async t => {
    const names = []; let received;
    const { response } = await request(t, {
      client: { rpc: async name => { names.push(name); return { data: name === 'm3_admin_collection' ? collection
        : name === 'm3_passage_bank_sizes' ? [6, 9, 12] : 8 }; } },
      generate: async input => { received = input.questionCount; return ['validated bank']; },
    }, { revision: 7, questionCount });
    assert.equal(response.status, 200);
    assert.equal(received, questionCount);
    assert.deepEqual(names, ['m3_admin_collection', 'm3_passage_bank_sizes', 'm3_save_passage_bank']);
  });
}
for (const questionCount of [0, 3, 7, 15, '9', 9.5]) {
  test(`questionCount ${JSON.stringify(questionCount)} is rejected before capability, generation or persistence`, async t => {
    const { response, calls } = await request(t, {
      generate: async () => assert.fail('Invalid counts must not reach generation'),
    }, { revision: 7, questionCount });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /Choose 6, 9 or 12 questions/);
    assert.deepEqual(calls.map(call => call.name), ['m3_admin_collection']);
  });
}
for (const refusal of ['Exactly 6, 9 or 12 questions are required', 'Exactly 3 literal questions are required']) {
  test(`database refusal "${refusal}" is reported as failed checks, not a database error`, async t => {
    const { response } = await request(t, {
      client: { rpc: async name => name === 'm3_admin_collection' ? { data: collection }
        : name === 'm3_passage_bank_sizes' ? { data: [6, 9, 12] } : { error: { code: 'P0001', message: refusal } } },
    }, { revision: 7, questionCount: 9 });
    assert.equal(response.status, 502);
    assert.match((await response.json()).message, /did not pass the database checks/);
  });
}
