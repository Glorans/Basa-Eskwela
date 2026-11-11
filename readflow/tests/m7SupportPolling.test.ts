import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHookRuntime, findAll, loadComponentModule, tick } from './helpers/hookRuntime.ts';
import { teacherSupport } from './fixtures/m7Support.ts';
import * as dates from '../src/modules/module7/services/dateDisplay.ts';
import * as scores from '../src/modules/module7/services/scoreDisplay.ts';
import * as classification from '../src/modules/module7/services/studentSupportClassification.ts';

// Student Support polls the Teacher analytics every 30 s. Performance rules checked here: never two requests
// at once, no polling while the tab is hidden, and a refresh asked for during a request still runs after it.
const require = createRequire(import.meta.url);
function setup() {
  const runtime = createHookRuntime(require('react'));
  const requests: { path: string; resolve: (value: unknown) => void }[] = [];
  const timers: (() => void)[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const fakeDocument = {
    visibilityState: 'visible',
    getElementById: () => null,
    addEventListener: (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type: string, fn: () => void) => { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
  };
  const module = loadComponentModule(new URL('../src/modules/module7/M7Pages.tsx', import.meta.url), (id) => {
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react-router-dom') return { Link: 'link' };
    if (id.endsWith('.css') || id.endsWith('/comprehensionNavigation')) return {};
    if (id.endsWith('/AdminAnalyticsPage')) return { default: 'admin' };
    if (id.endsWith('/dateDisplay')) return dates;
    if (id.endsWith('/scoreDisplay')) return scores;
    if (id.endsWith('/studentSupportClassification')) return classification;
    if (id.endsWith('/m7Service')) return { m7Request: (path: string) => new Promise((resolve) => { requests.push({ path, resolve }); }) };
    throw Error(id);
  }, { setInterval: (fn: () => void) => { timers.push(fn); return timers.length; }, clearInterval: () => {}, document: fakeDocument });
  const render = () => runtime.render(module.TeacherSupportPage, {});
  return { requests, timers, listeners, fakeDocument, render };
}
const finish = async (app: ReturnType<typeof setup>, index: number) => { app.requests[index].resolve(teacherSupport); await tick(); };

test('a poll never starts a second request while one is running', async () => {
  const app = setup();
  app.render(); await tick();
  assert.equal(app.requests.length, 1, 'initial load');
  app.timers[0](); app.timers[0](); await tick();
  assert.equal(app.requests.length, 1, 'polls during the request are skipped');
  await finish(app, 0);
  app.timers[0](); await tick();
  assert.equal(app.requests.length, 2, 'the next poll runs once the request finished');
});

test('a hidden tab is not polled; returning refreshes stale data once', async () => {
  const app = setup();
  app.render(); await tick(); await finish(app, 0);
  app.fakeDocument.visibilityState = 'hidden';
  app.timers[0](); app.timers[0](); await tick();
  assert.equal(app.requests.length, 1, 'no polling while hidden');
  app.fakeDocument.visibilityState = 'visible';
  app.listeners.visibilitychange.forEach((fn) => fn()); await tick();
  assert.equal(app.requests.length, 1, 'data younger than 30 s is kept');
});

test('a refresh asked for during a request (for example after saving) runs again afterwards', async () => {
  const app = setup();
  app.render(); await tick();
  const tree = app.render();
  const retry = findAll(tree, (n: any) => typeof n.props?.retry === 'function')[0];
  assert.ok(retry, 'the Retry handler is wired');
  retry.props.retry(); await tick();
  assert.equal(app.requests.length, 1, 'still one request at a time');
  await finish(app, 0); await tick();
  assert.equal(app.requests.length, 2, 'the asked-for refresh ran after the first request, so no stale data is kept');
  await finish(app, 1);
});
