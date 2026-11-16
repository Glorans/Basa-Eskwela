// Teacher Trash on the real My Reading Modules page (Module3Page workspace="teacher") with the real CSS, in headless
// Chrome. Stubbed sign-in, content and module services (no network, no accounts). At desktop, tablet and phone sizes:
// the Trash section lists the Teacher's trashed modules with Restore and no Delete Permanently; Delete asks for
// confirmation (real dialog) and then calls the Trash, never the hard delete; nothing overflows the screen.
// Usage (dummy offline values; nothing is contacted): VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_PUBLISHABLE_KEY=x VITE_API_URL=http://127.0.0.1:9 node tests/browser/module3/teacherTrash.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const profileDir = await mkdtemp(join(tmpdir(), 'readflow-m3-trash-'));
const MODULE = (id, title, status, publishedAt) => ({ id, title, status, publishedAt, language: 'en', readingLevel: 'Instructional', difficulty: 'Easy',
  difficultyTier: 'Easy', learningPath: 'English Instructional', questionCount: 6, createdAt: '2026-11-10T00:00:00Z', createdBy: 't1' });
const server = await createServer({ root, configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5194, strictPort: true }, plugins: [{
    name: 'm3-trash-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === '/m3-trash-fixture.tsx') return '\0m3-trash-fixture';
      if (id.endsWith('/context/M3ContentContext')) return '\0content-stub';
      if (id.endsWith('/auth/useAuth')) return '\0auth-stub';
      if (id.endsWith('/services/moduleService')) return '\0module-service-stub';
    },
    load(id) {
      if (id === '\0auth-stub') return `export const useAuth=()=>({user:{id:'t1'}});`;
      if (id === '\0content-stub') return `export function useM3Content(){return {modules:window.modules,modulesLoading:false,modulesError:null,
        refreshModules:async()=>{},feedback:null,clearFeedback:()=>{},deleteModule:async(id)=>{window.calls.push('delete:'+id);return {ok:true};},
        archiveModule:async()=>({ok:true}),restoreModule:async()=>({ok:true})};}`;
      if (id === '\0module-service-stub') return `
        export const getTrashedModules=async()=>{window.calls.push('list');return window.trash;};
        export const trashModule=async(id)=>{window.calls.push('trashModule:'+id);return 'trashed';};
        export const restoreTrashedModule=async(id)=>{window.calls.push('restore:'+id);return 'draft';};
        export const purgeTrashedModule=async(id)=>{window.calls.push('purge:'+id);};
        export const republishModule=async(id)=>{window.calls.push('republish:'+id);return 'published';};`;
      if (id === '\0m3-trash-fixture') return `
        import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
        import Module3Page from '/src/modules/module3/pages/Module3Page.tsx';import '/src/index.css';import '/src/modules/module3/styles/module3.css';
        window.calls=[];window.modules=${JSON.stringify([MODULE('m-draft', 'My Draft Story', 'draft', null), MODULE('m-pub', 'My Published Story', 'published', '2026-11-12T00:00:00Z'), MODULE('m-arch', 'My Restored Story', 'archived', '2026-11-12T00:00:00Z')])};
        window.trash=[{id:'t-draft',title:'Trashed Draft',statusBefore:'draft',trashedAt:'2026-11-17T01:00:00Z',trashedByName:'Tess',everPublished:false,hasHistory:false},
                      {id:'t-pub',title:'Trashed Published Story With A Longer Title',statusBefore:'published',trashedAt:'2026-11-17T02:00:00Z',trashedByName:'Tess',everPublished:true,hasHistory:true}];
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,
          React.createElement('div',{className:'m3-content'},React.createElement(Module3Page,{workspace:'teacher'}))));`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/' && !req.url.startsWith('/?')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/m3-trash-fixture.tsx"></script></body></html>'));
      });
    },
  }, react()],
});
await server.listen();
const chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9244', `--user-data-dir=${profileDir}`, 'about:blank'],
  { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { target = (await (await fetch('http://127.0.0.1:9244/json')).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
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
const until = async (expression, label) => {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression).catch(() => false)) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('Timed out: ' + label + ' | ' + await evaluate('document.body.innerText.slice(0, 600)'));
};
let passed = 0;
try {
  await send('Runtime.enable');
  for (const [w, h] of [[1366, 768], [820, 1180], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await send('Page.navigate', { url: 'http://127.0.0.1:5194/' });
    await until('!!document.querySelector(".m3-trash") && document.querySelectorAll(".m3-trash .m3-record-card").length === 2', 'Trash rendered');
    const info = await evaluate(`(() => {
      const trash = document.querySelector('.m3-trash');
      const btns = [...trash.querySelectorAll('button')].map(b => ({ label: b.getAttribute('aria-label'), r: b.getBoundingClientRect() }));
      return { heading: trash.querySelector('h2').textContent, text: trash.innerText, labels: btns.map(b => b.label),
        fit: btns.every(b => b.r.width > 0 && b.r.left >= -0.5 && b.r.right <= innerWidth + 0.5),
        overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert.equal(info.heading, 'Trash');
    assert.deepEqual(info.labels, ['Restore Trashed Draft from the Trash', 'Restore Trashed Published Story With A Longer Title from the Trash']);
    assert.ok(!/permanently/i.test(info.labels.join(' ')), 'no Delete Permanently for Teachers');
    assert.match(info.text, /Modules you deleted stay here/);
    assert.ok(info.fit, `${w}: Restore buttons fully on screen`);
    assert.ok(!info.overflow, `${w}: no horizontal overflow`);
    // Delete -> real confirmation dialog -> confirm -> Trash call, success message.
    await evaluate(`document.querySelector('button[aria-label="Delete My Published Story"]').click()`);
    await until('!!document.querySelector("[role=dialog], dialog[open], .readflow-dialog")', 'confirmation dialog');
    const dialogText = await evaluate('(document.querySelector("[role=dialog]") || document.querySelector("dialog[open]") || document.querySelector(".readflow-dialog")).innerText');
    assert.match(dialogText, /moves to the Trash/);
    assert.match(dialogText, /until you choose Publish Again/);
    await evaluate(`(() => { const d = document.querySelector("[role=dialog]") || document.querySelector("dialog[open]") || document.querySelector(".readflow-dialog");
      const ok = [...d.querySelectorAll('button')].find(b => /^(OK|Confirm|Continue|Yes|Delete)$/i.test(b.textContent.trim())) || [...d.querySelectorAll('button')].pop(); ok.click(); })()`);
    await until('window.calls.includes("trashModule:m-pub")', 'trash call');
    await until('document.body.innerText.includes("My Published Story was moved to the Trash.")', 'success message');
    assert.ok(!(await evaluate('window.calls.some(c => c.startsWith("delete:") || c.startsWith("purge:"))')), 'never the hard delete or purge');
    // Publish Again: explicit button on the restored (archived) module -> real confirmation -> validated database call.
    assert.ok(!(await evaluate('window.calls.some(c => c.startsWith("republish:"))')), 'nothing republished automatically');
    const pa = await evaluate(`(() => { const b = document.querySelector('button[aria-label="Publish My Restored Story again"]'); if (!b) return null;
      const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), fits: r.width > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5 }; })()`);
    assert.deepEqual(pa, { text: 'Publish Again', fits: true }, `${w}: Publish Again button on the archived module, on screen`);
    await evaluate(`document.querySelector('button[aria-label="Publish My Restored Story again"]').click()`);
    await until('!!document.querySelector("[role=dialog], dialog[open], .readflow-dialog")', 'Publish Again confirmation');
    assert.match(await evaluate('(document.querySelector("[role=dialog]") || document.querySelector("dialog[open]") || document.querySelector(".readflow-dialog")).innerText'),
      /Publish "My Restored Story" again\?[\s\S]*checked again before it is published/);
    await evaluate(`(() => { const d = document.querySelector("[role=dialog]") || document.querySelector("dialog[open]") || document.querySelector(".readflow-dialog");
      const ok = [...d.querySelectorAll('button')].find(b => /^(OK|Confirm|Continue|Yes|Publish)/i.test(b.textContent.trim())) || [...d.querySelectorAll('button')].pop(); ok.click(); })()`);
    await until('window.calls.includes("republish:m-arch")', 'republish call');
    await until('document.body.innerText.includes("My Restored Story was published again.")', 'republish success message');
    passed++;
    console.log(`PASS ${w}x${h}: Teacher Trash list (Restore only), Delete -> confirm -> Trash, Publish Again -> confirm -> republish, layout fits`);
  }
} finally {
  ws.close(); chrome.kill(); await server.close();
}
console.log(`\nteacher trash: ${passed}/3 sizes pass`);
