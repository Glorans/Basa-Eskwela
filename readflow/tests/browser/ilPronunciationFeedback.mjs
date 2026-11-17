// Local browser check: Independent Learner Reading Result -> Pronunciation Feedback (English) and the Filipino feedback.
// Real ReadingResultPage, real M5 services and the real /api/oral-reading routes (check, saved check, recording links),
// with a fake Azure (fixed scores after a delay), the in-memory checks table and a generated tone as the "recording".
// No Supabase, Azure, microphone or learner data. MODE=before runs the page with GitHub main's oralReadingService to
// compare how many times the recording links are requested.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
const MODE = process.env.MODE === 'before' ? 'before' : 'after';

const OWNER = '00000000-0000-4000-8000-000000000002'; // the fixture session (tests/browser/personalMaterialsAuth.ts)
const EN = '00000000-0000-4000-8000-0000000000b1', FIL = '00000000-0000-4000-8000-0000000000b2';
const STORY_EN = 'Every Saturday morning, Lina walks to the orchard.';
const STORY_FIL = 'Tuwing Sabado ng umaga, naglalakad si Lina sa halamanan.';
const attempt = (id, language, story) => ({ id, userId: OWNER, moduleId: '00000000-0000-4000-8000-0000000000c1', materialId: null, passageId: null,
  roomId: null, assignmentId: null, activityAssignmentId: null, practiceContext: 'personal', readAloudOnly: false, readAloudCompleted: false,
  moduleTitle: language === 'en' ? 'Lina' : 'Si Lina', passageTitle: language === 'en' ? 'Lina' : 'Si Lina', language, passageSnapshot: story,
  transcript: story, durationSeconds: 3, readingSpeedWpm: 160, pronunciationAccuracy: 100, expectedWordCount: story.split(' ').length,
  detectedErrorCount: 0, wordMetrics: story.split(' ').map((word) => ({ type: 'match', expected: word, actual: word })), sttConfidence: 0.9,
  scoringVersion: 2, completedAt: new Date().toISOString() });
const attempts = { [EN]: attempt(EN, 'en', STORY_EN), [FIL]: attempt(FIL, 'fil', STORY_FIL) };

// A 3 s, 16 kHz mono tone as the saved recording (WAV), served with CORS like a storage link.
const rate = 16000, seconds = 3, samples = rate * seconds, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 8000), 44 + i * 2);

const counts = { recordingLinks: 0, audioDownloads: 0, checks: 0 };
const { createOralReadingRouter } = require('../../../server/routes/oralReading');
const { createRequestLimiter } = require('../../../server/services/speechAccess');
const { createPronunciationChecksTable } = require('../../../server/tests/fixtures/pronunciationChecksTable');
const table = createPronunciationChecksTable();
const express = require('../../../server/node_modules/express');
const app = express();
let apiUrl = '';
app.get('/fixture-audio/:name', (req, res) => { counts.audioDownloads++; res.set({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'audio/wav' }); res.end(wav); });
app.use('/api/oral-reading', createOralReadingRouter({
  authorizeOralReadingPracticeRequest: async () => ({ user: { id: OWNER }, profile: { id: OWNER, role: 'general_user' } }),
  getOralReadingAttempt: async (requester, id) => { if (!attempts[id] || attempts[id].userId !== requester.user.id) throw Object.assign(new Error('no'), { statusCode: 404 }); return attempts[id]; },
  listOwnOralReadingAttempts: async () => Object.values(attempts).map((a) => ({ id: a.id, moduleId: a.moduleId, language: a.language, completedAt: a.completedAt })),
  getOralReadingRecording: async (requester, id) => { counts.recordingLinks++; return { available: true, segments: [`${apiUrl}/fixture-audio/${id}.wav`], expiresIn: 300 }; },
  assessPronunciation: async () => { counts.checks++; await new Promise((r) => setTimeout(r, 2500)); return {
    provider: 'azure', locale: 'en-US', scale: '0-100', complete: true, durationSeconds: 3, assessmentMs: 2500,
    utterances: [{ text: STORY_EN, accuracy: 86, fluency: 82, words: [{ word: 'Every', accuracy: 95, errorType: 'None' }, { word: 'orchard.', accuracy: 40, errorType: 'Mispronunciation' }] }] }; },
  pronunciationLimiter: createRequestLimiter({ limit: 60, windowMs: 60000 }), pronunciationTiming: () => {},
  getSupabaseAdmin: () => table.client, isRoomArchived: async () => false,
}));
const api = app.listen(0, '127.0.0.1'); await new Promise((r) => api.once('listening', r));
apiUrl = `http://127.0.0.1:${api.address().port}`;

const root = path.resolve('readflow'), output = path.resolve(`.tmp/il-pronunciation-browser-${MODE}`); fs.mkdirSync(output, { recursive: true });
const services = path.join(root, 'src/modules/module5/services');
const beforeCopy = path.join(services, 'oralReadingService.before-main.tmp.ts');
if (MODE === 'before') fs.writeFileSync(beforeCopy, execFileSync('git', ['show', 'origin/main:readflow/src/modules/module5/services/oralReadingService.ts'], { cwd: root }));
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
const vite = await createServer({ root, configFile: false, envFile: false, plugins: [{ name: 'il-pronunciation-fixture', enforce: 'pre', async resolveId(name, importer) {
  if (name.endsWith('/lib/supabaseClient')) return path.join(root, 'tests/browser/personalMaterialsAuth.ts').replaceAll('\\', '/');
  if (name.endsWith('/hooks/useAuthenticatedProfile')) return profileStub;
  if (MODE === 'before' && /services\/oralReadingService(\.ts)?$/.test(name) && !importer?.includes('before-main')) return beforeCopy.replaceAll('\\', '/');
}, configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url?.startsWith('/m3/')) { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${harness}"></script></body></html>`)); } else next(); }); } }, react()],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:5198') },
  server: { host: '127.0.0.1', port: 5198, strictPort: true, fs: { allow: [root, output] }, proxy: { '/api': apiUrl } } });
await vite.listen();
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=9248', '--user-data-dir=' + path.join(output, 'chrome-profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms)); let target;
for (let i = 0; i < 100; i++) { try { target = await (await fetch('http://127.0.0.1:9248/json/new?about:blank', { method: 'PUT' })).json(); break; } catch { await pause(100); } }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let serial = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++serial; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function until(expression, tries = 200) { for (let i = 0; i < tries; i++) { if (await evaluate(`(() => { try { return ${expression}; } catch { return false; } })()`)) return; await pause(75); } throw Error('Timeout: ' + expression + ' ' + errors.join(' | ') + ' TEXT: ' + await evaluate('document.body.innerText')); }
const shot = async (name) => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
const openCard = (title) => evaluate(`(() => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(title)})); if (!e) throw Error('no card ' + ${JSON.stringify(title)}); e.click(); })()`);
const audioReady = `[...document.querySelectorAll(':is(dialog[open],[role="dialog"]) audio')].length > 0 && [...document.querySelectorAll(':is(dialog[open],[role="dialog"]) audio')].every((a) => a.readyState >= 1 && a.duration > 2.5)`;
const report = { mode: MODE };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });
  // English: open Pronunciation Feedback -> step messages -> playback ready -> feedback text.
  await send('Page.navigate', { url: `http://127.0.0.1:5198/m3/general/read-aloud/results/${EN}` });
  await until(`document.body.innerText.includes('Reading Complete')`);
  const t0 = Date.now();
  await openCard('Pronunciation Feedback');
  if (MODE === 'after') {
    await until(`document.body.innerText.includes('Checking your pronunciation… This can take about half as long as your reading. Step 4 of 4. You can listen to your recording below while you wait.')`);
    assert.equal(await evaluate(`document.querySelector(':is(dialog[open],[role="dialog"]) [aria-busy="true"]') !== null`), true, 'busy status while checking');
    await shot('en-checking');
  }
  await until(audioReady); // playback works while the check runs
  report.playbackReadyMs = Date.now() - t0;
  const saved = async () => (await table.client.from('oral_reading_pronunciation_checks').select('status').eq('attempt_id', EN).maybeSingle()).data?.status === 'completed';
  for (let i = 0; i < 200 && !(await saved()); i++) await pause(75);
  await until(`!document.body.innerText.includes('This can take about half as long') && !document.body.innerText.includes('Loading your pronunciation feedback')`);
  report.feedbackReadyMs = Date.now() - t0;
  await shot('en-feedback');
  report.enRecordingLinkRequests = counts.recordingLinks;
  report.enAudioDownloads = counts.audioDownloads;
  report.enChecks = counts.checks;
  assert.equal(counts.checks, 1, 'one assessment');
  assert.equal((await table.client.from('oral_reading_pronunciation_checks').select('status').eq('attempt_id', EN).maybeSingle()).data?.status, 'completed', 'the check was saved');
  // Reopening the result reuses the saved check (no new assessment).
  await send('Page.navigate', { url: `http://127.0.0.1:5198/m3/general/read-aloud/results/${EN}` });
  await until(`document.body.innerText.includes('Reading Complete')`);
  await openCard('Pronunciation Feedback');
  await until(`!document.body.innerText.includes('This can take about half as long') && !document.body.innerText.includes('Loading your pronunciation feedback') && document.body.innerText.includes('Your Pronunciation')`);
  assert.equal(counts.checks, 1, 'reopened: no second assessment');
  // Filipino: its own feedback panel and the same recording player; never a pronunciation (Azure) check.
  const before = { ...counts };
  await send('Page.navigate', { url: `http://127.0.0.1:5198/m3/general/read-aloud/results/${FIL}` });
  await until(`document.body.innerText.includes('Si Lina')`);
  await openCard('Puna sa Pagbasa'); // "Reading Feedback": Filipino results are transcript-based, never a pronunciation check
  await until(`!!document.querySelector(':is(dialog[open],[role="dialog"])')`);
  await until(audioReady);
  await shot('fil-feedback');
  report.filRecordingLinkRequests = counts.recordingLinks - before.recordingLinks;
  assert.equal(counts.checks, before.checks, 'Filipino: no pronunciation check');
  // Layout with the dialog open.
  for (const [width, height] of [[820, 1180], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: `http://127.0.0.1:5198/m3/general/read-aloud/results/${EN}` });
    await until(`document.body.innerText.includes('Reading Complete')`);
    await openCard('Pronunciation Feedback');
    await until(audioReady);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `no horizontal scroll at ${width}`);
    await shot(`en-${width}`);
  }
  assert.deepEqual(errors, []);
  console.log('RESULT ' + JSON.stringify(report));
} finally {
  ws.close(); chrome.kill(); await vite.close(); api.close();
  if (fs.existsSync(beforeCopy)) fs.rmSync(beforeCopy);
}
