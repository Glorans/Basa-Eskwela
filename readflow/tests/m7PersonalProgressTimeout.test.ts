import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHookRuntime, findAll, loadComponentModule, tick } from './helpers/hookRuntime.ts';
import * as dates from '../src/modules/module7/services/dateDisplay.ts';
import * as scores from '../src/modules/module7/services/scoreDisplay.ts';
import * as classification from '../src/modules/module7/services/studentSupportClassification.ts';

// Progress & Result (Students and Independent Learners): a stalled request ends with a clear error and Retry
// instead of "Loading analytics…" forever. No result is shown until a request succeeds, and requests never
// overlap, so an older response cannot replace a newer one. Other M7 requests keep no time limit.
const require = createRequire(import.meta.url);
const TIMEOUT = 60_000;
const summary = { readingAttempts: 2, completedQuizzes: 1, pronunciationAccuracy: 80, readingSpeedWpm: 90, comprehensionScore: 75, invalidCompletedQuizzes: 0 };
const personal = { summary, readings: [], quizzes: [], historicalQuizzes: [], activities: [] };

function loadService(request: (config: Record<string, unknown>) => Promise<unknown>) {
  return loadComponentModule(new URL('../src/modules/module7/services/m7Service.ts', import.meta.url), (id) => {
    if (id === 'axios') return { default: { isAxiosError: (e: { isAxiosError?: boolean }) => e?.isAxiosError === true } };
    if (id.endsWith('/services/api')) return { default: { request } };
    if (id.endsWith('/authHeaders')) return { getSessionAuthHeaders: async () => ({ Authorization: 'Bearer synthetic' }) };
    throw Error(id);
  }, { Error });
}
const timeoutError = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded' };

test('the progress timeout is opt-in and a timed-out request explains what to do', async () => {
  const configs: Record<string, unknown>[] = [];
  const service = loadService(async (config) => { configs.push(config); throw timeoutError; });
  assert.equal(service.PERSONAL_PROGRESS_TIMEOUT_MS, TIMEOUT);
  await assert.rejects(service.m7Request('/personal', 'GET', undefined, { timeoutMs: TIMEOUT }), { message: service.ANALYTICS_TIMEOUT_MESSAGE });
  assert.equal(configs[0].timeout, TIMEOUT);
  assert.equal(configs[0].url, '/api/analytics/personal');
  // Without the option nothing changes: no time limit and the existing message.
  await assert.rejects(service.m7Request('/teacher'), { message: 'Unable to connect to analytics. Please retry.' });
  assert.equal('timeout' in configs[1], false);
});

test('server messages and successful responses are unchanged when a timeout is set', async () => {
  const ok = loadService(async () => ({ data: { data: personal } }));
  assert.deepEqual(await ok.m7Request('/personal', 'GET', undefined, { timeoutMs: TIMEOUT }), personal);
  const refused = loadService(async () => { throw { isAxiosError: true, response: { data: { message: 'Learner access is required.' } } }; });
  await assert.rejects(refused.m7Request('/personal', 'GET', undefined, { timeoutMs: TIMEOUT }), { message: 'Learner access is required.' });
});

function mountPage(page: 'StudentProgressPage' | 'TeacherSupportPage', props: Record<string, unknown> = {}) {
  const runtime = createHookRuntime(require('react'));
  const requests: { path: string; options?: { timeoutMs?: number }; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const module = loadComponentModule(new URL('../src/modules/module7/M7Pages.tsx', import.meta.url), (id) => {
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react-router-dom') return { Link: 'link' };
    if (id.endsWith('.css') || id.endsWith('/comprehensionNavigation')) return { comprehensionResultTarget: () => '#', readingResultTarget: () => '#' };
    if (id.endsWith('/SuggestedInterventions')) return { SuggestedInterventions: 'suggested-interventions' };
    if (id.endsWith('/M7Tabs')) return { default: 'm7-tabs' };
    if (id.endsWith('/M7Charts')) return { BarChart: 'bar-chart', LineChart: 'line-chart', DonutChart: 'donut-chart', M7_COLORS: { forest: '#17483C', green: '#79BD62', yellow: '#FFCA59', coral: '#F46F62', muted: '#54736A', soft: '#B9D8AE', blue: '#356A91' } };
    if (id.endsWith('/LearnerSuggestions')) return { LearnerSuggestions: 'learner-suggestions' };
    if (id.endsWith('/AdminAnalyticsPage')) return { default: 'admin' };
    if (id.endsWith('/dateDisplay')) return dates;
    if (id.endsWith('/scoreDisplay')) return scores;
    if (id.endsWith('/studentSupportClassification')) return classification;
    if (id.endsWith('/m7Service')) {
      return { PERSONAL_PROGRESS_TIMEOUT_MS: TIMEOUT, m7Request: (path: string, _method?: string, _data?: unknown, options?: { timeoutMs?: number }) =>
        new Promise((resolve, reject) => { requests.push({ path, options, resolve, reject }); }) };
    }
    throw Error(id);
  }, { setInterval: () => 1, clearInterval: () => {}, document: { visibilityState: 'visible', getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {} } });
  const render = () => runtime.render(module[page], props);
  const state = () => findAll(render(), (n) => n.props && 'retry' in n.props)[0].props as { error: string; loading: boolean; retry: () => void };
  const metrics = () => findAll(render(), (n) => n.props?.data?.readingAttempts !== undefined);
  return { requests, render, state, metrics };
}
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

for (const role of ['student', 'general_user']) {
  test(`${role}: a stalled progress request ends in an error with Retry, never in results`, async () => {
    const page = mountPage('StudentProgressPage', { role });
    page.render(); await settle();
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].path, '/personal');
    assert.equal(page.requests[0].options?.timeoutMs, TIMEOUT);
    assert.equal(page.state().loading, true);
    page.requests[0].reject(new Error('Loading is taking too long.')); await settle();
    assert.equal(page.state().error, 'Loading is taking too long.');
    assert.equal(page.state().loading, false);
    assert.equal(page.metrics().length, 0, 'no results while nothing has loaded');

    page.state().retry(); await settle();
    assert.equal(page.state().error, '', 'Retry replaces the old error with the loading state');
    assert.equal(page.state().loading, true);
    assert.equal(page.metrics().length, 0);
    page.requests[1].resolve(personal); await settle();
    assert.equal(page.state().error, '');
    assert.equal(page.state().loading, false);
    assert.equal(page.metrics().length, 1);
  });
}

test('Retry pressed during a running request is queued, so the latest response is the one shown', async () => {
  const page = mountPage('StudentProgressPage', { role: 'student' });
  page.render(); await settle();
  page.requests[0].reject(new Error('offline')); await settle();
  page.state().retry(); await settle();
  page.state().retry(); page.state().retry(); await settle();
  assert.equal(page.requests.length, 2, 'never two requests at once');
  page.requests[1].reject(new Error('still offline')); await settle();
  assert.equal(page.requests.length, 3, 'the queued Retry runs after the running request');
  page.requests[2].resolve(personal); await settle();
  assert.equal(page.state().error, '');
  assert.equal(page.metrics().length, 1);
});

test('Teacher Student Support keeps no time limit', async () => {
  const page = mountPage('TeacherSupportPage');
  page.render(); await settle();
  assert.equal(page.requests[0].path, '/teacher');
  assert.equal(page.requests[0].options?.timeoutMs, undefined);
});

test('the learner dashboards use the same progress timeout', async () => {
  const calls: unknown[][] = [];
  const sections = loadComponentModule(new URL('../src/pages/dashboard/LearnerSections.tsx', import.meta.url), (id) => {
    if (id.endsWith('/m7Service')) return { PERSONAL_PROGRESS_TIMEOUT_MS: TIMEOUT, m7Request: async (...args: unknown[]) => { calls.push(args); return personal; } };
    if (id === 'react/jsx-runtime') return require(id);
    return {};
  });
  assert.deepEqual(await sections.loadPersonal(), personal);
  // The module runs in its own VM realm, so its objects are compared by content.
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['/personal', 'GET', null, { timeoutMs: TIMEOUT }]));
  assert.equal(calls[0][2], undefined);
});
