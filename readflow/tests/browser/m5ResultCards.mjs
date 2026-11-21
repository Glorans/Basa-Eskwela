// Local browser check: the five M5 result cards (value + caption, equal heights, values aligned at the bottom) on the
// real ReadingResultPage with the real M5 services and the real /api/oral-reading routes, a fake Azure (fixed scores
// after a delay), the in-memory checks table and a generated tone as the "recording". No Supabase, Azure, microphone
// or learner data. Run from the repository root: node readflow/tests/browser/m5ResultCards.mjs
// Screenshots go to $M5_CARDS_OUT (default: the OS temp folder), never into the repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);

const OWNER = '00000000-0000-4000-8000-000000000002'; // the fixture session (tests/browser/personalMaterialsAuth.ts)
const EN = '00000000-0000-4000-8000-0000000000b1', FIL = '00000000-0000-4000-8000-0000000000b2';
const STORY_EN = 'Every Saturday morning, Lina walks to the orchard with her little brother and their grandmother.';
const HEARD_EN = 'Every Saturday morning Lina walks to the orchard with her brother and grandmother';
const STORY_FIL = 'Tuwing Sabado ng umaga, naglalakad si Lina sa halamanan kasama ang kanyang lola.';
const HEARD_FIL = 'Tuwing Sabado ng umaga naglalakad si Lina sa halaman kasama kanyang lola';
const metrics = (story, heard) => {
  const s = story.replace(/[.,]/g, '').split(' '), h = heard.split(' ');
  return s.map((word, i) => (h.includes(word) ? { type: 'match', expected: word, actual: word } : { type: 'omission', expected: word, actual: null })).slice(0, s.length)
    .map((m, i) => (i === 9 && m.type === 'match' ? { type: 'substitution', expected: m.expected, actual: 'halaman' } : m));
};
const attempt = (id, language, story, heard) => {
  const wordMetrics = metrics(story, heard);
  const matched = wordMetrics.filter((m) => m.type === 'match').length;
  return { id, userId: OWNER, moduleId: '00000000-0000-4000-8000-0000000000c1', materialId: null, passageId: null,
    roomId: null, assignmentId: null, activityAssignmentId: null, practiceContext: 'personal', readAloudOnly: false, readAloudCompleted: false,
    moduleTitle: language === 'en' ? 'Lina' : 'Si Lina', passageTitle: language === 'en' ? 'Lina' : 'Si Lina', language, passageSnapshot: story,
    transcript: heard, durationSeconds: 8, readingSpeedWpm: 95, pronunciationAccuracy: Math.round((matched / wordMetrics.length) * 100),
    expectedWordCount: wordMetrics.length, detectedErrorCount: wordMetrics.length - matched, wordMetrics, sttConfidence: 0.9,
    scoringVersion: 2, completedAt: new Date().toISOString() };
};
const attempts = { [EN]: attempt(EN, 'en', STORY_EN, HEARD_EN), [FIL]: attempt(FIL, 'fil', STORY_FIL, HEARD_FIL) };

const rate = 16000, seconds = 3, samples = rate * seconds, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 8000), 44 + i * 2);

const counts = { checks: 0 };
const { createOralReadingRouter } = require('../../../server/routes/oralReading');
const { createRequestLimiter } = require('../../../server/services/speechAccess');
const { createPronunciationChecksTable } = require('../../../server/tests/fixtures/pronunciationChecksTable');
const table = createPronunciationChecksTable();
const express = require('../../../server/node_modules/express');
const app = express();
let apiUrl = '';
const flagged = ['Saturday', 'orchard', 'little', 'brother', 'their', 'grandmother'];
app.get('/fixture-audio/:name', (req, res) => { res.set({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'audio/wav' }); res.end(wav); });
app.use('/api/oral-reading', createOralReadingRouter({
  authorizeOralReadingPracticeRequest: async () => ({ user: { id: OWNER }, profile: { id: OWNER, role: 'general_user' } }),
  getOralReadingAttempt: async (requester, id) => { if (!attempts[id] || attempts[id].userId !== requester.user.id) throw Object.assign(new Error('no'), { statusCode: 404 }); return attempts[id]; },
  listOwnOralReadingAttempts: async () => Object.values(attempts).map((a) => ({ id: a.id, moduleId: a.moduleId, language: a.language, completedAt: a.completedAt })),
  getOralReadingRecording: async (requester, id) => ({ available: true, segments: [`${apiUrl}/fixture-audio/${id}.wav`], expiresIn: 300 }),
  assessPronunciation: async () => { counts.checks++; await new Promise((r) => setTimeout(r, 2500)); return {
    provider: 'azure', locale: 'en-US', scale: '0-100', complete: true, durationSeconds: 3, assessmentMs: 2500,
    utterances: [{ text: STORY_EN, accuracy: 95, fluency: 82, words: STORY_EN.split(' ').map((word) => ({
      word, accuracy: flagged.some((f) => word.startsWith(f)) ? 40 : 96, errorType: 'None' })) }] }; },
  pronunciationLimiter: createRequestLimiter({ limit: 60, windowMs: 60000 }), pronunciationTiming: () => {},
  getSupabaseAdmin: () => table.client, isRoomArchived: async () => false,
}));
const api = app.listen(0, '127.0.0.1'); await new Promise((r) => api.once('listening', r));
apiUrl = `http://127.0.0.1:${api.address().port}`;

const root = path.resolve('readflow');
const output = path.resolve(process.env.M5_CARDS_OUT ?? path.join(os.tmpdir(), 'basa-m5-result-cards')); fs.mkdirSync(output, { recursive: true });
const harness = path.join(output, 'harness.tsx').replaceAll('\\', '/');
fs.writeFileSync(harness, `
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ReadingResultPage from '${path.join(root, 'src/pages/reading-activity/ReadingResultPage.tsx').replaceAll('\\', '/')}';
import '${path.join(root, 'src/index.css').replaceAll('\\', '/')}';
createRoot(document.getElementById('root')!).render(<BrowserRouter><Routes>
  <Route path="/m3/general/read-aloud/results/:attemptId" element={<ReadingResultPage role="general_user" />} />
</Routes></BrowserRouter>);
`);
const profileStub = path.join(output, 'profile.ts').replaceAll('\\', '/');
fs.writeFileSync(profileStub, `const state = { profile: { id: '${OWNER}', role: 'general_user', nickname: 'Ana' }, loading: false, failed: false };
export default function useAuthenticatedProfile() { return state; }`);
const vite = await createServer({ root, configFile: false, envFile: false, plugins: [{ name: 'm5-cards-fixture', enforce: 'pre', async resolveId(name) {
  if (name.endsWith('/lib/supabaseClient')) return path.join(root, 'tests/browser/personalMaterialsAuth.ts').replaceAll('\\', '/');
  if (name.endsWith('/hooks/useAuthenticatedProfile')) return profileStub;
}, configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url?.startsWith('/m3/')) { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${harness}"></script></body></html>`)); } else next(); }); } }, react()],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:5199') },
  server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [root, output, fs.realpathSync(path.join(root, 'node_modules')), path.resolve(root, '../../../../OneDrive/Documents/Python/ReadFlow/Basa-Eskwela/readflow/node_modules')] }, proxy: { '/api': apiUrl } } });
await vite.listen();
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=9249', '--user-data-dir=' + path.join(output, 'chrome-profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms)); let target;
for (let i = 0; i < 100; i++) { try { target = await (await fetch('http://127.0.0.1:9249/json/new?about:blank', { method: 'PUT' })).json(); break; } catch { await pause(100); } }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let serial = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++serial; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function until(expression, tries = 400) { for (let i = 0; i < tries; i++) { if (await evaluate(`(() => { try { return ${expression}; } catch { return false; } })()`)) return; await pause(75); } throw Error('Timeout: ' + expression + ' ' + errors.join(' | ') + ' TEXT: ' + (await evaluate('document.body.innerText')).slice(0, 400)); }
const shot = async (name) => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));

// What each card shows, and its geometry: rows, heights, where the value block sits, whether a value wraps.
const CARDS = `(() => [...document.querySelectorAll('.result-panel-card')].map((card) => {
  const box = card.getBoundingClientRect(), metric = card.querySelector('.result-panel-card-metric').getBoundingClientRect();
  const value = card.querySelector('.result-panel-card-value, .result-panel-card-status');
  const v = value.getBoundingClientRect(), line = parseFloat(getComputedStyle(value).lineHeight) || parseFloat(getComputedStyle(value).fontSize) * 1.2;
  return { title: card.querySelector('.result-panel-card-title').textContent, value: value.textContent,
    status: value.classList.contains('result-panel-card-status'), caption: card.querySelector('.result-panel-card-caption').textContent,
    top: Math.round(box.top), height: Math.round(box.height), bottomGap: Math.round(box.bottom - v.bottom),
    valueLines: value.classList.contains('result-panel-card-value') ? Math.round(v.height / line) : null };
}))()`;
function rows(cards) {
  const byTop = new Map();
  for (const c of cards) byTop.set(c.top, [...(byTop.get(c.top) ?? []), c]);
  return [...byTop.values()];
}
const report = {};
try {
  await send('Page.enable'); await send('Runtime.enable');
  // 1. English, desktop: the check starts on its own; the cards show Processing, then the values.
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5199/m3/general/read-aloud/results/${EN}` });
  await until(`document.body.innerText.includes('Reading Complete')`);
  await until(`document.querySelectorAll('.result-panel-card-status').length === 3`);
  report.processing = (await evaluate(CARDS)).map((c) => `${c.title}: ${c.value} | ${c.caption}`);
  await shot('en-1366-processing');
  await until(`document.querySelectorAll('.result-panel-card-status').length === 0`);
  assert.equal(counts.checks, 1, 'one automatic assessment, no card opened');
  for (const [name, width, height] of [['desktop-1366', 1366, 900], ['desktop-1280', 1280, 900], ['tablet-1024', 1024, 1366], ['tablet-820', 820, 1180], ['mobile-390', 390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    await send('Page.navigate', { url: `http://127.0.0.1:5199/m3/general/read-aloud/results/${EN}` });
    await until(`document.querySelectorAll('.result-panel-card-value').length === 5`);
    const cards = await evaluate(CARDS), grid = rows(cards);
    report[name] = { perRow: grid.map((r) => r.length), cards: cards.map((c) => `${c.title}: ${c.value} | ${c.caption}`) };
    for (const row of grid) {
      assert.ok(Math.max(...row.map((c) => c.height)) - Math.min(...row.map((c) => c.height)) <= 1, `${name}: equal heights in a row`);
      assert.ok(Math.max(...row.map((c) => c.bottomGap)) - Math.min(...row.map((c) => c.bottomGap)) <= 1, `${name}: the values themselves line up at the bottom ${JSON.stringify(row.map((c) => c.bottomGap))}`);
    }
    assert.ok(cards.every((c) => c.valueLines === 1), `${name}: every value on one line ${JSON.stringify(cards.map((c) => c.valueLines))}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `${name}: no horizontal scroll`);
    await shot(`en-${name}`);
  }
  assert.equal(counts.checks, 1, 'reopening reused the saved result');
  // The detail modals still open from each card.
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5199/m3/general/read-aloud/results/${EN}` });
  await until(`document.querySelectorAll('.result-panel-card-value').length === 5`);
  for (let i = 0; i < 5; i++) {
    await evaluate(`document.querySelectorAll('.result-panel-card')[${i}].click()`);
    await until(`[...document.querySelectorAll('[role="dialog"]')].some((d) => d.checkVisibility())`);
    await evaluate(`document.querySelector('.m5-modal-close').click()`);
    await until(`![...document.querySelectorAll('[role="dialog"]')].some((d) => d.checkVisibility())`);
  }
  report.modals = 'all five cards open and close their detail window';
  // 2. Filipino: transcript-based values only; never a pronunciation score.
  for (const [name, width, height] of [['desktop-1366', 1366, 900], ['mobile-390', 390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    await send('Page.navigate', { url: `http://127.0.0.1:5199/m3/general/read-aloud/results/${FIL}` });
    await until(`document.querySelectorAll('.result-panel-card-value').length === 5`);
    const cards = await evaluate(CARDS);
    report[`fil-${name}`] = cards.map((c) => `${c.title}: ${c.value} | ${c.caption}`);
    for (const row of rows(cards)) {
      assert.ok(Math.max(...row.map((c) => c.height)) - Math.min(...row.map((c) => c.height)) <= 1, `fil ${name}: equal heights in a row`);
      assert.ok(Math.max(...row.map((c) => c.bottomGap)) - Math.min(...row.map((c) => c.bottomGap)) <= 1, `fil ${name}: values line up ${JSON.stringify(row.map((c) => c.bottomGap))}`);
    }
    assert.ok(cards.every((c) => c.valueLines === 1), `fil ${name}: every value on one line`);
    assert.ok(cards.every((c) => !c.value.includes('/100')), 'Filipino: no pronunciation score');
    await shot(`fil-${name}`);
  }
  assert.equal(counts.checks, 1, 'Filipino started no pronunciation check');
  assert.deepEqual(errors, []);
  console.log('RESULT ' + JSON.stringify(report, null, 1));
  console.log('Screenshots: ' + output);
} finally {
  ws.close(); chrome.kill(); await vite.close(); api.close();
}
