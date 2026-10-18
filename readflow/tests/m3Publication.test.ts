import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('publication retains authoritative readiness, propagates errors and returns published status', async () => {
  let issues: string[] = [];
  let rpcError: object | null = null;
  let updateError: object | null = null;
  let missing = false;
  const writes: unknown[] = [];
  const client = {
    async rpc(name: string, args: unknown) {
      assert.equal(name, 'm3_collection_publish_issues');
      assert.deepEqual(args, { target_id: 'module' });
      return { data: issues, error: rpcError };
    },
    from(table: string) {
      assert.equal(table, 'modules');
      const query = {
        update(value: unknown) { writes.push(value); return query; },
        eq(key: string, value: string) { assert.equal(key, 'id'); assert.equal(value, 'module'); return query; },
        select() { return query; },
        async maybeSingle() { return { error: updateError, data: missing ? null : {
          id: 'module', title: 'Story', status: 'published', passage: 'Legacy text', difficulty: 'Easy',
          path_id: 'path', created_at: '2026-10-07', published_at: '2026-10-07', comprehension_questions: [{count:6}],
          learning_paths: {id:'path',path_name:'English',language:'en',reading_level:'Independent',difficulty_tier:'Easy'},
        } }; },
      }; return query;
    },
  };
  const globals = globalThis as typeof globalThis & { __m3PublishClient?: typeof client };
  globals.__m3PublishClient = client;
  const url = new URL('../src/modules/module3/services/moduleService.ts', import.meta.url).href;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === url) {
      if (specifier.endsWith('/supabaseClient')) return {url:'data:text/javascript,export const supabase=globalThis.__m3PublishClient',shortCircuit:true};
      if (specifier === './moduleModel') return {url:new URL('../src/modules/module3/services/moduleModel.ts',import.meta.url).href,shortCircuit:true};
    }
    return next(specifier, context);
  } });
  try {
    const {publishModule} = await import(url);
    for (const issue of ['Passage 1 has questions that need review', 'At least one passage is required',
      'Passage 1 requires exactly two literal questions', 'Passage 1 requires exactly two inferential questions',
      'Passage 1 requires exactly two critical questions', 'Passage 1 has missing or invalid answer keys']) {
      issues = [issue]; await assert.rejects(publishModule('module'), {message:issue});
    }
    assert.deepEqual(writes, []);
    issues = []; rpcError = {message:'validation denied'};
    await assert.rejects(publishModule('module'), (e: Error & {causeValue?:unknown}) => e.causeValue === rpcError);
    assert.deepEqual(writes, []); rpcError = null;
    updateError = {message:'database rejected publication'};
    await assert.rejects(publishModule('module'), (e: Error & {causeValue?:unknown}) => e.causeValue === updateError && /Unable to publish/.test(e.message));
    updateError = null; missing = true;
    await assert.rejects(publishModule('module'), /Unable to publish/);
    missing = false;
    const result = await publishModule('module');
    assert.equal(result.status, 'published'); assert.equal(result.passage, 'Legacy text');
    assert.deepEqual(writes[writes.length - 1], {status:'published'});
  } finally { hooks.deregister(); delete globals.__m3PublishClient; }
});

test('rollout retirement keeps validation, legacy checks, data and RLS intact', async () => {
  const sql = await readFile(new URL('../../supabase/m3_enable_collection_publication.sql',import.meta.url),'utf8');
  assert.match(sql, /drop trigger if exists modules_pending_collection_publish on public.modules/);
  assert.match(sql, /issues:=public.m3_collection_publish_issues\(new.id\)/);
  assert.match(sql, /if cardinality\(issues\)>0 then raise exception/);
  assert.match(sql, /if nullif\(pg_catalog.btrim\(new.passage\), ''\) is null/);
  assert.match(sql, /order by p.display_order limit 1/);
  assert.doesNotMatch(sql, /drop (table|function|constraint)|disable trigger|delete from|grant |alter policy/i);
});
