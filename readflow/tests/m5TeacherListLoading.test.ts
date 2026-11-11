import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadComponentModule } from './helpers/hookRuntime.ts';

// Teacher Reading Results: the list request has a deadline, so a stalled connection ends in an error with a
// working Refresh instead of "Loading reading results..." forever. Stubs only; no network.
const require = createRequire(import.meta.url);
const axios = require('axios');

function service(get: (url: string, config: any) => Promise<any>) {
  return loadComponentModule(new URL('../src/modules/module5/services/oralReadingService.ts', import.meta.url), (id) => {
    if (id === 'axios') return axios;
    if (id.endsWith('/savedAttemptOrder.ts')) return { numberSavedAttempts: (rows: unknown) => rows };
    if (id.endsWith('/readingDataCache.ts')) return { ReadingDataCache: class { setSession() {} get() {} put() {} } };
    if (id.endsWith('/supabaseClient')) return { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic', user: { id: 't1' } } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } };
    if (id.endsWith('/services/api')) return { default: { get } };
    if (id.endsWith('/teacherComprehension')) return { parseTeacherComprehensionSummary: (value: unknown) => value, parseTeacherComprehensionDetail: (value: unknown) => value };
    throw Error(id);
  });
}

test('the Teacher list request carries the 60 s deadline and returns the summaries', async () => {
  const calls: any[] = [];
  const svc = service(async (url, config) => { calls.push({ url, config }); return { data: { attempts: [{ id: 'r1', comprehension: { status: 'not_started' } }] } }; });
  const rows = await svc.getTeacherOralReadingAttempts();
  assert.equal(rows.length, 1);
  assert.equal(calls[0].url, '/api/oral-reading/teacher/attempts');
  assert.equal(calls[0].config.timeout, 60_000);
  assert.equal(calls[0].config.headers.Authorization, 'Bearer synthetic');
});

test('a stalled or failed list request ends with an understandable message', async () => {
  const timedOut = service(async () => { throw new axios.AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED'); });
  await assert.rejects(timedOut.getTeacherOralReadingAttempts(), /connection is too slow right now/);
  const failed = service(async () => { throw new axios.AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined,
    { status: 500, data: { message: 'Unable to load student oral-reading results.' } } as any); });
  await assert.rejects(failed.getTeacherOralReadingAttempts(), /Unable to load student oral-reading results/);
});

test('the page always leaves the loading state and keeps Refresh usable after an error', () => {
  const page = readFileSync(new URL('../src/modules/module5/pages/TeacherOralReadingResultsPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /catch \(loadError\) \{[\s\S]*?setError\(/, 'a failure sets the error message');
  assert.match(page, /finally \{\s*setLoading\(false\);/, 'loading ends on every outcome');
  assert.match(page, /\{error && <p className="m3-error-message" role="alert">\{error\}<\/p>\}/, 'the error is shown');
  assert.match(page, /disabled=\{loading\} onClick=\{\(\) => void loadAttempts\(\)\}/, 'Refresh works once loading ends');
});
