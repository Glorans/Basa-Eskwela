import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentPerformanceRequests, type StudentPerformanceFetch } from '../src/modules/module7/services/studentPerformanceRequests.ts';
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
const path = '/admin/students/ana';

test('concurrent identical GETs share one request, then reuse the unchanged result for 30 seconds', async () => {
  let calls = 0, now = 100;
  const payload = { id: 'ana', score: null };
  const cache = createStudentPerformanceRequests((async () => { calls++; return payload; }) as StudentPerformanceFetch, () => now);
  const a = cache.request(path), b = cache.request(path);
  assert.equal(a,b); assert.equal(await a,payload); assert.equal(calls,1);
  assert.equal(await cache.request(path),payload); assert.equal(calls,1);
  now += 30_001; await cache.request(path); assert.equal(calls,2);
  cache.clear();
});

test('Strict Mode cleanup/re-subscription reuses the same in-flight student and suggestions', async () => {
  const signals: AbortSignal[] = [];
  const cache = createStudentPerformanceRequests((async (_path, signal) => { signals.push(signal); await pause(); return {}; }) as StudentPerformanceFetch);
  cache.retain();
  const detail = cache.request(path), suggestions = cache.request(`${path}/suggestions`);
  cache.cancelStudent('ana'); cache.release();
  cache.retain();
  assert.equal(cache.request(path),detail); assert.equal(cache.request(`${path}/suggestions`),suggestions);
  await Promise.all([detail,suggestions]);
  assert.equal(signals.length,2); assert.ok(signals.every(s=>!s.aborted));
  cache.clear();
});

test('obsolete requests are aborted and cannot populate the cache even if the transport ignores abort', async () => {
  let finish!: (value: unknown) => void; let signal!: AbortSignal;
  const cache = createStudentPerformanceRequests((async (_path,s) => { signal=s; return new Promise<unknown>(resolve=>{finish=resolve;}); }) as StudentPerformanceFetch);
  const pending = cache.request(path); const rejected = assert.rejects(pending,/no longer active/);
  await Promise.resolve(); cache.cancelStudent('ana'); await pause(); assert.equal(signal.aborted,true);
  finish({id:'ana'}); await rejected;
  cache.clear();
});

test('switching cancels only pending work, retaining completed snapshots for quick return', async () => {
  let calls=0;
  const cache=createStudentPerformanceRequests((async()=>{calls++;return {id:'ana'};}) as StudentPerformanceFetch);
  await cache.request(path);cache.cancelStudent('ana');await pause();await cache.request(path);assert.equal(calls,1);
  cache.release();await pause();await cache.request(path);assert.equal(calls,2,'unmount clears records');cache.clear();
});

test('authorization-scoped cache instances never share records, and failures are retryable', async () => {
  let calls=0;
  const fetcher=(async()=>{calls++;if(calls===1)throw Error('Forbidden');return {request:calls};}) as StudentPerformanceFetch;
  const first=createStudentPerformanceRequests(fetcher), second=createStudentPerformanceRequests(fetcher);
  assert.notEqual(first.scope,second.scope);
  await assert.rejects(first.request(path),/Forbidden/);await first.request(path);await second.request(path);assert.equal(calls,3);
  first.invalidate(path);await first.request(path);assert.equal(calls,4);
  await assert.rejects(first.request('/students/ana/interventions'),/Unsupported/);
  first.clear();second.clear();
});

test('memory cache is bounded, with no persistent student record storage', async () => {
  let calls=0;const cache=createStudentPerformanceRequests((async()=>{calls++;return {};}) as StudentPerformanceFetch);
  for(let i=0;i<25;i++) await cache.request(`/admin/students/${i}`);
  await cache.request('/admin/students/0');assert.equal(calls,26);cache.clear();
});

test('analytics transport forwards optional cancellation without changing existing callers', async () => {
  const { loadComponentModule } = await import('./helpers/hookRuntime.ts');
  const configs: Record<string, unknown>[]=[];
  const service=loadComponentModule(new URL('../src/modules/module7/services/m7Service.ts',import.meta.url),id=>{
    if(id==='axios')return {default:{isAxiosError:()=>false}};
    if(id.endsWith('/api'))return {default:{request:async(config:Record<string,unknown>)=>{configs.push(config);return {data:{data:{id:'ana'}}};}}};
    if(id.endsWith('/authHeaders'))return {getSessionAuthHeaders:async()=>({Authorization:'test-only'})};
    throw Error(id);
  },{Error});
  const controller=new AbortController();
  await service.m7Request('/admin/students/ana','GET',undefined,{signal:controller.signal,timeoutMs:60_000});
  assert.equal(configs[0].signal,controller.signal);assert.equal(configs[0].timeout,60_000);
  await service.m7Request('/teacher');assert.equal('signal' in configs[1],false);assert.equal('timeout' in configs[1],false);
});
