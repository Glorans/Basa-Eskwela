// Real M6 React page in Chrome, with service fixtures; no external API calls.
// Run from readflow: node tests/browser/m6StoryDrawer.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const passage = 'The original saved story.\n\nA second paragraph with the complete passage.\n' + 'Students read together. '.repeat(500);
const filipinoPassage = 'Ang naka-save na kuwento.\n\nNagbasa si Ana kasama ang kaniyang mga kaibigan.\n' + 'Masaya silang nagbabasa. '.repeat(500);
const fixture = {
  id: 'saved-attempt', passageTitle: 'Original saved title', passageText: passage, language: 'en',
  status: 'in_progress', questions: ['literal', 'inferential', 'critical'].map((type, i) => ({
    id: `q${i}`, type, questionText: `Question ${i + 1}?`, options: ['One', 'Two', 'Three', 'Four'],
    firstOptionIndex: 0, firstAnswerCorrect: false, answerHistory: [{ optionIndex: 0, correct: false }],
    hintUsed: true, hint: 'An existing hint', resolved: false, correctOptionIndex: null,
  })), summary: { allResolved: false, firstCorrect: 0, hintsUsed: 1, totalQuestions: 3,
    byType: Object.fromEntries(['literal', 'inferential', 'critical'].map(t => [t, { total: 1, firstCorrect: 0 }])) },
};
const vite = await createServer({ root, configFile: false, plugins: [react(), {
  name: 'm6-story-fixtures', enforce: 'pre',
  resolveId(id) { if (id === '/m6-fixture.tsx') return '\0m6-fixture.tsx'; },
  load(id) { if (id === '\0m6-fixture.tsx') return `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import Page from '/src/modules/module6/pages/ComprehensionPage.tsx';
    import '/src/index.css';
    const params = new URLSearchParams(location.search);
    window.calls = []; window.attempt = ${JSON.stringify(fixture)};
    const index = Number(params.get('index') || 0);
    window.attempt.questions.forEach((q,i) => q.resolved = i < index);
    if(params.get('language') === 'fil') Object.assign(window.attempt, {language:'fil',passageTitle:'Ang Orihinal na Kuwento',passageText:${JSON.stringify(filipinoPassage)}});
    if(params.has('missing')) window.attempt.passageText = null;
    if(params.has('assigned')) Object.assign(window.attempt, {materialId:'assigned-material',roomId:'room',activityAssignmentId:'assignment'});
    const h = React.createElement;
    createRoot(document.getElementById('root')).render(h(MemoryRouter,{initialEntries:['/assessment/saved-attempt']},h(Routes,null,h(Route,{path:'/assessment/:attemptId',element:h('div',{className:'basa-page'},h('div',{className:'basa-main-shell'},h('main',{className:'basa-content'},h(Page,{role:params.has('independent')?'general_user':'student'}))))}))));
    import '/src/components/basa/BasaLayout.css';
  `; },
  transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/module6/services/comprehensionService.ts')) return {
    code: `export async function getComprehension(id) { window.calls.push(['get', id]); return structuredClone(window.attempt); }
      export async function startComprehension() { window.calls.push(['start']); throw Error('Unexpected start'); }
      export async function sendComprehensionAction() { window.calls.push(['action']); throw Error('Unexpected action'); }`, map: null,
  }; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url.startsWith('/fixture')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/m6-fixture.tsx"></script></body></html>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'm6-story-'));
let chrome, ws;
const pause = ms => new Promise(r => setTimeout(r, ms));
try {
  await vite.listen();
  const port = vite.httpServer.address().port;
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let startupError; chrome.on('error', e => startupError = e);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile) && !startupError; i++) await pause(100);
  if (startupError) throw startupError;
  const chromePort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (!m.id) return; const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(50); } throw Error('Timeout: ' + expression); };
  let checks = 0;
  for (const width of [390, 1366]) for (const language of ['en', 'fil']) for (const source of ['assigned', 'module', 'independent']) for (const index of [0, 1, 2]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/fixture?language=${language}&${source}=1&index=${index}` });
    await until(`!!document.querySelector('.m6-story-trigger')`);
    await evaluate(`document.querySelectorAll('input[type=radio]')[1].click()`);
    const before = await evaluate(`JSON.stringify({question:document.querySelector('.m6-question-card').innerHTML,calls:window.calls,attempt:window.attempt,scroll:document.querySelector('.basa-content').scrollTop})`);
    await evaluate(`document.querySelector('.m6-story-trigger').click()`);
    await until(`document.querySelector('dialog').open`);
    await pause(220);
    assert.equal(await evaluate(`document.querySelector('.m6-story-passage').textContent`), language === 'fil' ? filipinoPassage : passage);
    assert.equal(await evaluate(`document.activeElement.classList.contains('m6-story-close')`), true);
    assert.equal(await evaluate(`document.querySelector('dialog').contains(document.activeElement)`), true);
    for (let i = 0; i < 4; i++) await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate(`document.querySelector('dialog').contains(document.activeElement)`), true, 'Focus stays in modal');
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    assert.equal(await evaluate(`document.querySelector('.m6-story-body').scrollHeight > document.querySelector('.m6-story-body').clientHeight`), true);
    assert.equal(await evaluate(`Math.round(document.querySelector('dialog').getBoundingClientRect().width)`), Math.min(width, 560));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(`!document.querySelector('dialog').open`);
    await until(`document.activeElement.classList.contains('m6-story-trigger')`);
    assert.equal(await evaluate(`JSON.stringify({question:document.querySelector('.m6-question-card').innerHTML,calls:window.calls,attempt:window.attempt,scroll:document.querySelector('.basa-content').scrollTop})`), before);
    await evaluate(`document.querySelector('.m6-story-trigger').click(); document.querySelector('.m6-story-close').click()`);
    await until(`!document.querySelector('dialog').open`);
    assert.deepEqual(await evaluate(`window.calls`), [['get', 'saved-attempt']]);
    checks++;
  }
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/fixture?missing=1` });
  await until(`!!document.querySelector('.m6-story-trigger')`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`document.querySelector('.m6-story-trigger').click()`);
  assert.equal(await evaluate(`document.querySelector('.m6-story-body').textContent.includes('saved story is unavailable')`), true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('dialog')).animationName`), 'none');
  assert.deepEqual(await evaluate(`window.calls`), [['get', 'saved-attempt']]);
  console.log(`PASS: ${checks} desktop/mobile × language × source × question-level scenarios; missing passage and reduced motion. No assessment mutations.`);
} finally {
  ws?.close(); chrome?.kill(); await vite.close();
}
