// Real Landing Page with the real global CSS (index.css) in headless Chrome. No network, no accounts.
// At desktop, tablet and phone sizes: no visible scrollbar on the landing page, the page still scrolls when its
// content is taller than the screen, nothing is cut off, and no horizontal overflow.
// Usage: node tests/browser/landingScroll.mjs [--report]  (--report prints measurements without asserting)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const REPORT = process.argv.includes('--report');
const root = fileURLToPath(new URL('../../', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'readflow-landing-'));
const server = await createServer({ root, configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5191, strictPort: true }, plugins: [{
    name: 'landing-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/landing-fixture.tsx') return '\0landing-fixture'; },
    load(id) {
      if (id === '\0landing-fixture') return `
        import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
        import LandingPage from '/src/pages/LandingPage.tsx';import '/src/index.css';
        // Control: any other page (no .landing-page) with tall content keeps the shared scrollbar.
        const control = new URLSearchParams(location.search).has('control');
        createRoot(document.getElementById('root')).render(control
          ? React.createElement('div',{id:'control',style:{height:'3000px'}},'Other page')
          : React.createElement(MemoryRouter,null,React.createElement(LandingPage)));`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/' && !req.url.startsWith('/?')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/landing-fixture.tsx"></script></body></html>'));
      });
    },
  }, react()],
});
await server.listen();

const chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9241',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { target = (await (await fetch('http://127.0.0.1:9241/json')).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
}
assert.ok(target, 'Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

const MEASURE = `(() => {
  const els = { html: document.documentElement, body: document.body, root: document.getElementById('root'), page: document.querySelector('.landing-page') };
  const out = {};
  for (const [k, el] of Object.entries(els)) {
    const cs = getComputedStyle(el);
    out[k] = { overflowY: cs.overflowY, scrollH: el.scrollHeight, clientH: el.clientHeight,
      gutter: el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) };
  }
  out.viewport = { w: innerWidth, h: innerHeight, htmlClientW: document.documentElement.clientWidth };
  // A visible vertical scrollbar takes width from the viewport (classic scrollbars in headless Chrome).
  out.visibleScrollbar = document.documentElement.clientWidth < innerWidth || out.root.gutter > 0 || out.page.gutter > 0 || out.body.gutter > 0;
  out.horizontalOverflow = document.documentElement.scrollWidth > innerWidth;
  const actions = [...document.querySelectorAll('.landing-actions a')];
  out.actions = actions.map((a) => a.textContent.trim());
  // Scroll the real scrolling element to the bottom; every action must then be fully inside the viewport.
  const scroller = document.scrollingElement;
  scroller.scrollTop = scroller.scrollHeight;
  for (const el of [els.body, els.root, els.page]) el.scrollTop = el.scrollHeight;
  out.actionsReachable = actions.every((a) => { const r = a.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height > 0; });
  out.canScroll = scroller.scrollHeight > scroller.clientHeight;
  scroller.scrollTop = 0;
  out.titleVisible = document.querySelector('.landing-title').getBoundingClientRect().height > 0;
  return out;
})()`;

const SIZES = [[1440, 900], [1366, 768], [1280, 600], [1024, 768], [820, 1180], [768, 1024], [390, 844], [360, 640], [320, 480]];
const failures = [];
try {
  await send('Runtime.enable');
  for (const [width, height] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:5191/' });
    for (let i = 0; i < 50 && !(await evaluate('!!document.querySelector(".landing-title")').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    await evaluate('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
    const m = await evaluate(MEASURE);
    const tag = `${width}x${height}`;
    if (REPORT) { console.log(tag, JSON.stringify(m)); continue; }
    const check = (ok, label) => { if (!ok) failures.push(`${tag}: ${label}`); };
    check(!m.visibleScrollbar, 'no visible vertical scrollbar');
    check(!m.horizontalOverflow, 'no horizontal overflow');
    check(m.actions.join('|') === 'Get Started|Log In', 'both actions rendered');
    check(m.actionsReachable, 'actions fully reachable (not cut off) after scrolling');
    check(m.titleVisible, 'title rendered');
    console.log(`${failures.some((f) => f.startsWith(tag + ':')) ? 'FAIL' : 'PASS'} ${tag}: scrollbar ${m.visibleScrollbar ? 'VISIBLE' : 'hidden'}, ` +
      `page ${m.canScroll ? 'scrolls (content taller than screen)' : 'fits'}, actions reachable ${m.actionsReachable}`);
  }
  if (!REPORT) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 600, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:5191/?control' });
    for (let i = 0; i < 50 && !(await evaluate('!!document.getElementById("control")').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    const visible = await evaluate('document.documentElement.clientWidth < innerWidth');
    if (!visible) failures.push('control: a non-landing page lost its scrollbar');
    console.log(`${visible ? 'PASS' : 'FAIL'} control (non-landing page, 1280x600, tall content): shared scrollbar still visible`);
  }
} finally {
  ws.close(); chrome.kill(); await server.close();
}
if (!REPORT) {
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log(`\nlanding page: ${SIZES.length}/${SIZES.length} sizes pass`);
}
