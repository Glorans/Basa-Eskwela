// Teacher M3 entry points in headless Chrome: the real M3Layout sidebar and the real Reading Modules catalog, with
// stubbed sign-in and content (no network, no accounts). Checks that a Teacher sees "My Reading Modules" and
// "Create Module" in the sidebar (exactly one item active per page), the catalog's Create Module button, and that an
// Independent Learner's catalog has no authoring buttons. Desktop, tablet and phone sizes.
// Usage: node tests/browser/module3/teacherEntryPoints.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const profileDir = await mkdtemp(join(tmpdir(), 'readflow-m3-entry-'));
const server = await createServer({ root, configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5193, strictPort: true }, plugins: [{
    name: 'm3-entry-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === '/m3-entry-fixture.tsx') return '\0m3-entry-fixture';
      if (id.endsWith('/hooks/useAuthenticatedProfile')) return '\0profile-stub';
      if (id.endsWith('/services/authService')) return '\0auth-service-stub';
      if (id.endsWith('/context/M3ContentContext')) return '\0m3-content-stub';
    },
    load(id) {
      if (id === '\0profile-stub') return `export default function useAuthenticatedProfile(){
        return {profile:{id:'t1',role:window.role,full_name:'Tess Teacher',nickname:'Tess',teacher_status:'approved'},loading:false};}`;
      if (id === '\0auth-service-stub') return `export const logout=async()=>true;`;
      if (id === '\0m3-content-stub') return `export function useM3Content(){return {sharedModules:[],modules:[],studentModules:[],
        modulesLoading:false,modulesError:'',refreshModules:async()=>{}};}`;
      if (id === '\0m3-entry-fixture') return `
        import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';
        import M3Layout from '/src/modules/module3/components/M3Layout.tsx';
        import ModuleCatalogPage from '/src/modules/module3/pages/ModuleCatalogPage.tsx';
        import '/src/index.css';
        const q=new URLSearchParams(location.search);window.role=q.get('role');const start=q.get('path');
        const ws=window.role==='teacher'?'teacher':'general';
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:[start]},
          React.createElement(Routes,null,React.createElement(Route,{path:'/m3/'+ws,element:React.createElement(M3Layout,{role:window.role})},
            React.createElement(Route,{path:'modules',element:React.createElement(ModuleCatalogPage,{role:window.role})}),
            React.createElement(Route,{path:'content',element:React.createElement('p',{id:'page'},'My Reading Modules page')}),
            React.createElement(Route,{path:'content/new',element:React.createElement('p',{id:'page'},'Create Module page')}),
            React.createElement(Route,{path:'*',element:React.createElement('p',{id:'page'},'other')})))));`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/?')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/m3-entry-fixture.tsx"></script></body></html>'));
      });
    },
  }, react()],
});
await server.listen();
const chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9243', `--user-data-dir=${profileDir}`, 'about:blank'],
  { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { target = (await (await fetch('http://127.0.0.1:9243/json')).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
}
assert.ok(target, 'Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const open = async (role, path) => {
  await send('Page.navigate', { url: `http://127.0.0.1:5193/?role=${role}&path=${encodeURIComponent(path)}` });
  for (let i = 0; i < 80; i++) { if (await evaluate('!!document.getElementById("page") || !!document.querySelector("h1")').catch(() => false)) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('page did not render');
};
const nav = () => evaluate(`[...document.querySelectorAll('.m3-sidebar-nav a')].map(a=>({label:a.getAttribute('aria-label'),href:a.getAttribute('href'),active:a.classList.contains('m3-nav-item--active')}))`);
let passed = 0;
try {
  await send('Runtime.enable');
  for (const [w, h] of [[1366, 768], [820, 1180], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    // Teacher: sidebar entry points and exactly one active item on each page.
    for (const [path, activeLabel] of [['/m3/teacher/content', 'My Reading Modules'], ['/m3/teacher/content/new', 'Create Module'], ['/m3/teacher/modules', 'Reading Modules']]) {
      await open('teacher', path);
      const items = await nav();
      const labels = items.map((i) => i.label);
      assert.ok(labels.includes('My Reading Modules') && labels.includes('Create Module'), `${w}: Teacher sidebar has both entry points`);
      assert.equal(labels.indexOf('Create Module'), labels.indexOf('My Reading Modules') + 1, 'Create Module follows My Reading Modules');
      assert.equal(items.find((i) => i.label === 'Create Module').href, '/m3/teacher/content/new');
      assert.deepEqual(items.filter((i) => i.active).map((i) => i.label), [activeLabel], `${w} ${path}: exactly one active item`);
    }
    // Teacher catalog: Create Module + My Reading Modules buttons, visible and inside the viewport width.
    await open('teacher', '/m3/teacher/modules');
    const buttons = await evaluate(`[...document.querySelectorAll('.m3-page-actions a')].map(a=>{const r=a.getBoundingClientRect();return {text:a.textContent.trim(),href:a.getAttribute('href'),visible:r.width>0&&r.height>0&&r.right<=innerWidth+0.5&&r.left>=-0.5}})`);
    assert.deepEqual(buttons.map((b) => [b.text, b.href]), [['My Reading Modules', '/m3/teacher/content'], ['Create Module', '/m3/teacher/content/new']]);
    assert.ok(buttons.every((b) => b.visible), `${w}: catalog buttons fully visible`);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${w}: no horizontal overflow`);
    await evaluate(`document.querySelector('.m3-page-actions a:last-child').click()`);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await evaluate('document.getElementById("page")?.textContent'), 'Create Module page', 'Create Module opens the Teacher editor route');
    // Independent Learner: same catalog, no authoring buttons, no authoring sidebar items.
    await open('general_user', '/m3/general/modules');
    assert.equal(await evaluate('document.querySelectorAll(".m3-page-actions a").length'), 0, 'Independent Learner catalog has no Create button');
    const learnerLabels = (await nav()).map((i) => i.label);
    assert.ok(!learnerLabels.includes('Create Module') && !learnerLabels.includes('My Reading Modules'), 'no authoring items for Independent Learners');
    passed++;
    console.log(`PASS ${w}x${h}: Teacher sidebar + catalog entry points, single active item, Create opens the editor; Independent Learner unchanged`);
  }
} finally {
  ws.close(); chrome.kill(); await server.close();
}
console.log(`\nteacher entry points: ${passed}/3 sizes pass`);
