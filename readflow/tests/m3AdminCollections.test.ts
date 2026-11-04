import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { getCollectionPublishIssues } from '../src/modules/module3/services/modulePassageModel.ts';
import type { AdminCollection } from '../src/modules/module3/services/adminCollectionService';

test('Admin persistence sends stable IDs, explicit removals and revision to a single atomic RPC', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let failure: object | null = null;
  const globals = globalThis as typeof globalThis & { __collectionClient?: unknown; __collectionApi?: unknown };
  const requests: unknown[][] = [];
  let apiFailure: unknown;
  globals.__collectionApi = { get: async () => ({ data: { state: 'failed' } }), defaults: { baseURL: 'http://localhost:5000' }, post: async (...args: unknown[]) => {
    requests.push(args);
    if (apiFailure) throw apiFailure;
  } };
  globals.__collectionClient = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: 9, error: failure }; } };
  const url = new URL('../src/modules/module3/services/adminCollectionService.ts', import.meta.url).href;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === url) {
      if (specifier.endsWith('/supabaseClient')) return { url: 'data:text/javascript,export const supabase=globalThis.__collectionClient', shortCircuit: true };
      if (specifier === './materialService') return { url: 'data:text/javascript,export const getMaterialAuthHeaders=async()=>({})', shortCircuit: true };
      if (specifier.endsWith('/services/api')) return { url: 'data:text/javascript,export default globalThis.__collectionApi', shortCircuit: true };
      if (specifier === './modulePassageService' || specifier === './moduleModel' || specifier === '../state/questionState') return { url: new URL(specifier + '.ts', url).href, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  try {
    const { saveCollection, saveBank, generateBank, collectionError, loadCollection, getPassageBankSizes, reviseModule } = await import(url) as typeof import('../src/modules/module3/services/adminCollectionService');
    const collection: AdminCollection = { id: 'module', revision: 8, status: 'draft', publishedAt: null, language: 'en', title: 'Set', learningPathId: 'path', difficulty: 'Easy', passages: [
      { id: 'first', title: '', passageText: '', sourceMaterialId: null, displayOrder: 1, questions: [] },
      { id: 'second', title: 'Other', passageText: 'Preserve this', sourceMaterialId: 'real-source', displayOrder: 2, questions: [] },
    ] };
    assert.equal(await saveCollection(collection, ['removed']), 9);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'm3_save_collection');
    assert.equal(calls[0].args.expected_revision, 8);
    assert.deepEqual(calls[0].args.removed_ids, ['removed']);
    assert.deepEqual(calls[0].args.passage_drafts, collection.passages.map(({ id, title, passageText, sourceMaterialId }) => ({ id, title, passageText, sourceMaterialId })));
    await saveBank(collection, collection.passages[0], 'delete');
    assert.equal(calls[1].args.target_passage, 'first');
    assert.equal(calls[1].args.target_id, 'module');
    assert.deepEqual(calls[1].args.bank, []);
    await assert.rejects(saveBank(collection, collection.passages[0], 'review'), /question/);
    assert.equal(calls.length, 2, 'invalid review never writes');
    assert.equal(await reviseModule('source-module'), '9');
    assert.deepEqual(calls.at(-1), { name: 'm3_revise_module', args: { source_id: 'source-module' } });
    failure = { message: 'Revision conflict' };
    await assert.rejects(saveCollection(collection, []), { message: 'Revision conflict' });
    await generateBank(collection, 'second');
    assert.deepEqual(requests[0], ['/api/admin/modules/module/passages/second/generate', { revision: 8, questionCount: 6 }, { headers: {}, timeout: 90_000 }]);
    (globals.__collectionClient as { rpc: unknown }).rpc = async () => ({ data: collection });
    apiFailure = { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' };
    await assert.rejects(generateBank(collection, 'second'), /No new questions were saved/);
    apiFailure = { isAxiosError: true, code: 'ECONNABORTED' };
    await assert.rejects(generateBank(collection, 'second'), /longer than expected.*no new questions were saved/);
    apiFailure = { isAxiosError: true, response: { data: { message: 'Gemini returned an invalid question set. Please try again.' } } };
    await assert.rejects(generateBank(collection, 'second'), error => {
      assert.notEqual(error, apiFailure);
      assert.doesNotMatch(collectionError(error), /Gemini|API|localhost/);
      assert.match(collectionError(error), /No new questions were saved/);
      return true;
    });
    // A lost response with a newly saved bank is recovered without another POST.
    const fresh = { ...collection, revision: 9, passages: collection.passages.map(p => p.id !== 'second' ? p : {
      ...p, questions: Array.from({ length: 6 }, (_, i) => ({ id: `saved-${i}` })),
    }) };
    (globals.__collectionClient as { rpc: unknown }).rpc = async () => ({ data: fresh });
    const requestCount = requests.length;
    await generateBank(collection, 'second');
    assert.equal(requests.length, requestCount + 1);
    // Unknown status must remain blocked, including a repeated click/retry.
    (globals.__collectionClient as { rpc: unknown }).rpc = async () => ({ data: collection });
    (globals.__collectionApi as any).get = async () => ({ data: { state: 'unknown' } });
    await assert.rejects(generateBank(collection, 'second'), /cannot yet confirm/);
    const afterUncertain = requests.length;
    await assert.rejects(generateBank(collection, 'second'), /cannot yet confirm/);
    assert.equal(requests.length, afterUncertain, 'checking cannot send a second billable POST');
    (globals.__collectionApi as any).get = async () => ({ data: { state: 'failed' } });
    await assert.rejects(generateBank(collection, 'second'), /No new questions were saved/);
    // 6/9/12: the requested size is posted, and recovery only accepts a new bank of that size.
    (globals.__collectionClient as { rpc: unknown }).rpc = async () => ({ data: collection });
    apiFailure = undefined;
    await generateBank({ ...collection, revision: 20 }, 'second', undefined, 9);
    assert.deepEqual(requests.at(-1)?.[1], { revision: 20, questionCount: 9 });
    apiFailure = { isAxiosError: true, code: 'ECONNABORTED' };
    (globals.__collectionApi as any).get = async () => ({ data: { state: 'unknown' } });
    const sized = (n: number) => ({ ...collection, revision: 31, passages: collection.passages.map(p => p.id !== 'second' ? p : {
      ...p, questions: Array.from({ length: n }, (_, i) => ({ id: `nine-${n}-${i}` })) }) });
    (globals.__collectionClient as { rpc: unknown }).rpc = async () => ({ data: sized(6) });
    await assert.rejects(generateBank({ ...collection, revision: 30 }, 'second', undefined, 12), /cannot yet confirm/, 'a six-question bank does not confirm a twelve-question request');
    (globals.__collectionClient as { rpc: unknown }).rpc = async () => ({ data: sized(12) });
    const beforeRecovery = requests.length;
    await generateBank({ ...collection, revision: 30 }, 'second', undefined, 12);
    assert.equal(requests.length, beforeRecovery, 'recovery reads only, never re-posts');
    apiFailure = undefined;
    // The capability gate: six only unless the database function answers with supported sizes.
    const client = globals.__collectionClient as { rpc: unknown };
    client.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.m3_passage_bank_sizes' } });
    assert.deepEqual(await getPassageBankSizes(), [6]);
    client.rpc = async () => { throw new Error('network'); };
    assert.deepEqual(await getPassageBankSizes(), [6]);
    client.rpc = async (name: string) => ({ data: name === 'm3_passage_bank_sizes' ? [6, 9, 12] : null, error: null });
    assert.deepEqual(await getPassageBankSizes(), [6, 9, 12]);
    for (const [language, expected] of [['English', 'en'], ['Filipino', 'fil'], ['english', 'en'], ['filipino', 'fil'], ['en', 'en'], ['fil', 'fil']]) {
      const client = globals.__collectionClient as { rpc: unknown };
      client.rpc = async () => ({ data: { ...collection, language } });
      assert.equal((await loadCollection('module')).language, expected);
    }
  } finally { hooks.deregister(); delete globals.__collectionClient; delete globals.__collectionApi; }
});

test('frontend readiness agrees with exact six-question category policy', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const draft = { title: 'Set', learningPathId: 'path', difficulty: 'Easy' as const, passages: [{ id, title: 'Text', passageText: 'Story', sourceMaterialId: null }] };
  const questions = (['literal', 'literal', 'inferential', 'inferential', 'critical', 'critical'] as const).map((type, i) => ({ id: String(i), passageId: id, type, questionText: 'Question?', options: ['A','B','C','D'] as [string,string,string,string], scaffoldingHint: 'Read', displayOrder: i+1, reviewStatus: 'reviewed' as const }));
  assert.deepEqual(getCollectionPublishIssues(draft, questions, ['path']), []);
  assert.ok(getCollectionPublishIssues(draft, [...questions, { ...questions[0], id: 'extra', displayOrder: 7 }], ['path']).some(i => i.includes('exactly 2 literal')));
});
