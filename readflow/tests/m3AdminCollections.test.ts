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
  globals.__collectionApi = { defaults: { baseURL: 'http://localhost:5000' }, post: async (...args: unknown[]) => {
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
    const { saveCollection, saveBank, generateBank, collectionError, loadCollection } = await import(url) as typeof import('../src/modules/module3/services/adminCollectionService');
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
    failure = { message: 'Revision conflict' };
    await assert.rejects(saveCollection(collection, []), { message: 'Revision conflict' });
    await generateBank(collection, 'second');
    assert.deepEqual(requests[0], ['/api/admin/modules/module/passages/second/generate', { revision: 8 }, { headers: {}, timeout: 60_000 }]);
    apiFailure = { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' };
    await assert.rejects(generateBank(collection, 'second'), /Cannot reach.*localhost:5000.*Express.*VITE_API_URL/);
    apiFailure = { isAxiosError: true, code: 'ECONNABORTED' };
    await assert.rejects(generateBank(collection, 'second'), /timed out.*Reload the module/);
    apiFailure = { isAxiosError: true, response: { data: { message: 'Gemini returned an invalid question set. Please try again.' } } };
    await assert.rejects(generateBank(collection, 'second'), error => {
      assert.equal(error, apiFailure);
      assert.equal(collectionError(error), 'Gemini returned an invalid question set. Please try again.');
      return true;
    });
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
