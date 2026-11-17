// Local browser check (stubbed data, no network): the Independent Learner Global Leaderboard shows the viewer's own
// nickname as "Nickname (You)" and keeps every other learner's anonymous "Reader XXXXXX", at desktop, tablet and phone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve('readflow'), output = path.resolve('.tmp/il-leaderboard-browser'); fs.mkdirSync(output, { recursive: true });
const stub = path.join(output, 'stub.ts').replaceAll('\\', '/');
fs.writeFileSync(stub, `
// ?named=1: rows that arrive with long full names, to check the phone layout (names wrap, no horizontal scroll).
const named = new URLSearchParams(location.search).get('named') === '1';
const rows = named ? [
  { entry_id: 'a', display_name: 'Maria Santos', xp: 300, is_me: false },
  { entry_id: 'b', display_name: 'You', xp: 250, is_me: true },
  { entry_id: 'c', display_name: 'Juan Dela Cruz Bartolome Jr', xp: 160, is_me: false },
  { entry_id: 'd', display_name: 'Reader E7A61B', xp: 120, is_me: false },
] : [
  { entry_id: 'a', display_name: 'Reader 51B382', xp: 300, is_me: false },
  { entry_id: 'b', display_name: 'You', xp: 250, is_me: true },
  { entry_id: 'c', display_name: 'Reader E7A61B', xp: 120, is_me: false },
];
export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }),
    getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  rpc: async (name: string) => name === 'm8_independent_rankings' ? { data: rows, error: null } : { data: null, error: { code: '42883' } },
};
const nickname = new URLSearchParams(location.search).get('nickname');
const state = { profile: { id: 'me', role: 'general_user', nickname }, loading: false, failed: false };
export default function useAuthenticatedProfile() { return state; }
`);
const harness = path.join(output, 'harness.tsx').replaceAll('\\', '/');
fs.writeFileSync(harness, `
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import IndependentLeaderboard from '${path.join(root, 'src/pages/IndependentLeaderboard.tsx').replaceAll('\\', '/')}';
import '${path.join(root, 'src/index.css').replaceAll('\\', '/')}';
createRoot(document.getElementById('root')!).render(<BrowserRouter><main style={{ maxWidth: 1100, margin: '24px auto', padding: 16 }}><IndependentLeaderboard /></main></BrowserRouter>);
`);
const vite = await createServer({ root, configFile: false, envFile: false, plugins: [{ name: 'il-leaderboard-fixture', enforce: 'pre', resolveId(name) {
  if (name.endsWith('/lib/supabaseClient') || name.endsWith('/hooks/useAuthenticatedProfile')) return stub;
}, configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url?.startsWith('/leaderboard')) { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${harness}"></script></body></html>`)); } else next(); }); } }, react()],
  server: { host: '127.0.0.1', port: 5197, strictPort: true, fs: { allow: [root, output] } } });
await vite.listen();
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=9247', '--user-data-dir=' + path.join(output, 'chrome-profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = (ms) => new Promise((r) => setTimeout(r, ms)); let target;
for (let i = 0; i < 100; i++) { try { target = await (await fetch('http://127.0.0.1:9247/json/new?about:blank', { method: 'PUT' })).json(); break; } catch { await pause(100); } }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let serial = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++serial; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function until(expression) { for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await pause(75); } throw Error('Timeout: ' + expression + ' ' + errors.join(' | ') + ' ' + await evaluate('document.body.innerText')); }
const names = () => evaluate(`[...document.querySelectorAll('li strong')].map(e => e.textContent.trim())`);
const shot = async (name) => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
try {
  await send('Page.enable'); await send('Runtime.enable');
  for (const [width, height, mobile] of [[1366, 900, false], [820, 1180, true], [390, 844, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await send('Page.navigate', { url: 'http://127.0.0.1:5197/leaderboard?nickname=Ana%20Cruz' });
    await until(`document.querySelectorAll('li strong').length === 3`);
    assert.deepEqual(await names(), ['Reader 51B382', 'Ana Cruz (You)', 'Reader E7A61B'], `labels at ${width}`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `no horizontal scroll at ${width}`);
    await shot(`leaderboard-${width}`);
  }
  await send('Page.navigate', { url: 'http://127.0.0.1:5197/leaderboard' });
  await until(`document.querySelectorAll('li strong').length === 3`);
  assert.deepEqual(await names(), ['Reader 51B382', 'You', 'Reader E7A61B'], 'no nickname keeps "You"');
  // Approved adults by name (database change), the viewer as "Name (You)", others still anonymous; same order and XP.
  for (const [width, height, mobile] of [[1366, 900, false], [820, 1180, true], [390, 844, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await send('Page.navigate', { url: 'http://127.0.0.1:5197/leaderboard?named=1&nickname=Ana%20Cruz' });
    await until(`document.querySelectorAll('li strong').length === 4`);
    assert.deepEqual(await names(), ['Maria Santos', 'Ana Cruz (You)', 'Juan Dela Cruz Bartolome Jr', 'Reader E7A61B'], `named at ${width}`);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('li')].map(li => (li.innerText.match(/([0-9]+)[ \\n]*XP/) || [])[1])`), ['300', '250', '160', '120']);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `no horizontal scroll (named) at ${width}`);
    await shot(`leaderboard-named-${width}`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS browser: own row "Nickname (You)", others stay "Reader XXXXXX", no nickname keeps "You"; with the database change approved adults show by name with unchanged order/XP; 1366/820/390 without horizontal scroll');
} finally { ws.close(); chrome.kill(); await vite.close(); }
