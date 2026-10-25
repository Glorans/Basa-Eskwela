// Mascot popup checks against real M6 pages and the shared M5 completion presentation.
// Run from readflow: node tests/browser/mascotPopup.mjs
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
    firstOptionIndex: null, firstAnswerCorrect: null, answerHistory: [],
    hintUsed: false, hint: 'An existing hint', resolved: false, correctOptionIndex: null,
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
    import Mascot from '/src/components/reading-feedback/ReadingMascot.tsx';
    import '/src/index.css';
    const params = new URLSearchParams(location.search);
    window.calls = []; window.attempt = ${JSON.stringify(fixture)};
    const index = Number(params.get('index') || 0);
    window.attempt.questions.forEach((q,i) => q.resolved = i < index);
    if(params.get('language') === 'fil') Object.assign(window.attempt, {language:'fil',passageTitle:'Ang Orihinal na Kuwento',passageText:${JSON.stringify(filipinoPassage)}});
    if(params.has('missing')) window.attempt.passageText = null;
    if(params.has('assigned')) Object.assign(window.attempt, {materialId:'assigned-material',roomId:'room',activityAssignmentId:'assignment'});
    const h = React.createElement;
    createRoot(document.getElementById('root')).render(h(MemoryRouter,{initialEntries:['/assessment/saved-attempt']},h(Routes,null,h(Route,{path:'/assessment/:attemptId',element:h('div',{className:'basa-page'},h('div',{className:'basa-main-shell'},h('main',{className:'basa-content'},params.has('reading') ? h(Mascot,{mood:'celebrate',message:'Your reading is saved.',language:'en',eventId:'reading:complete',live:true}) : h(Page,{role:params.has('independent')?'general_user':'student'}))))}))));
    import '/src/components/basa/BasaLayout.css';
  `; },
  transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/module6/services/comprehensionService.ts')) return {
    code: `export async function getComprehension(id) { window.calls.push(['get', id]); return structuredClone(window.attempt); }
      export async function startComprehension() { window.calls.push(['start']); throw Error('Unexpected start'); }
      export async function sendComprehensionAction(id,action) {
        window.calls.push(['action',action]);
        const a=window.attempt; const q=a.questions.find(q=>q.id===action.questionId);
        let outcome={};
        if(action.action==='hint') { q.hintUsed=true; q.hint='Read the beginning of the story.'; }
        if(action.action==='answer') {
          const correct=action.optionIndex===0;
          q.answerHistory.push({optionIndex:action.optionIndex,correct});
          if(q.firstOptionIndex===null) {q.firstOptionIndex=action.optionIndex;q.firstAnswerCorrect=correct;}
          q.resolved=correct || q.answerHistory.length===2;
          q.correctOptionIndex=q.resolved?0:null;
          outcome={correct,resolved:q.resolved};
          a.summary.allResolved=a.questions.every(q=>q.resolved);
        }
        if(action.action==='complete') a.status='completed';
        return {attempt:structuredClone(a),outcome};
      }`, map: null,
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
  await send('Network.enable');
  const audioRequests=[];
  ws.addEventListener('message', e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent' && m.params.type !== 'Script' && /tts|text-to-speech|speech\/synth|\.mp3|\.wav/i.test(m.params.request.url)) audioRequests.push(m.params.request.url);});
  const close = async () => {
    await evaluate(`document.querySelector('.reading-mascot-close').click()`);
    await until(`!document.querySelector('.reading-mascot-dock')`);
  };
  const verify = async mood => {
    await until(`!!document.querySelector('.reading-mascot--${mood}')`);
    assert.equal(await evaluate(`document.querySelectorAll('.reading-mascot button').length`),1);
    assert.equal(await evaluate(`document.querySelectorAll('.reading-mascot audio,.reading-mascot .feedback-speech').length`),0);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true);
    const overlay = await evaluate(`document.querySelector('.reading-mascot-dock').classList.contains('reading-mascot-dock--overlay')`);
    if (overlay) {
      await pause(80);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.reading-mascot-dock')).visibility === 'visible'`), true, 'Feedback appears automatically and remains visible');
      // Phones (<= 480px): a compact popup inside the viewport, clear of the action buttons and hint.
      // Larger screens: the large popup at the panel's lower-left.
      assert.equal(await evaluate(`(()=>{const dock=document.querySelector('.reading-mascot-dock');const p=dock.getBoundingClientRect();const c=document.querySelector('.basa-content').getBoundingClientRect();
        if(dock.classList.contains('reading-mascot-dock--compact')){
          const clear=[...document.querySelectorAll('.m6-actions button,.m6-question-card > aside')].every(b=>{const r=b.getBoundingClientRect();return r.bottom<=p.top||r.top>=p.bottom||r.right<=p.left||r.left>=p.right;});
          return innerWidth<=480 && p.left>=0 && p.top>=0 && p.right<=innerWidth && p.bottom<=innerHeight && clear;}
        return innerWidth>480 && Math.abs(p.left-c.left-12)<1 && p.right<=innerWidth && Math.abs(p.bottom-Math.min(innerHeight-12,c.bottom-12))<1})()`),true);
      const layout=await evaluate(`JSON.stringify([...document.querySelectorAll('.basa-content,.m6-page,.m6-card,.m6-actions,.m6-page h1')].map(e=>e.getBoundingClientRect().toJSON()))`);
      await evaluate(`document.querySelector('.reading-mascot-dock').style.display='none'`);
      assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('.basa-content,.m6-page,.m6-card,.m6-actions,.m6-page h1')].map(e=>e.getBoundingClientRect().toJSON()))`),layout,'Popup has zero layout footprint');
      await evaluate(`document.querySelector('.reading-mascot-dock').style.display=''`);
    }

    const image=await evaluate(`document.querySelector('.reading-mascot-image').src`);
    assert.match(image, /mascot-(thumbsup|classroom)/);
    assert.equal(image.includes('thumbsup'),['correct','celebrate'].includes(mood));
  };
  let checks=0;
  for(const width of [320,390,480,1366]) for(const independent of [false,true]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/fixture?${independent?'independent=1':''}`});
    await until(`!!document.querySelector('input[type=radio]')`);
    assert.equal(await evaluate(`!!document.querySelector('.reading-mascot-dock')`),false);
    await evaluate(`document.querySelector('.m6-button--hint').click()`);
    await verify('hint');
    await evaluate(`document.querySelector('.basa-content').scrollTop=150`);
    await verify('hint');
    await evaluate(`document.querySelector('.basa-content').scrollTop=0`);
    const before=await evaluate(`JSON.stringify(window.attempt)`);
    await close();
    assert.equal(await evaluate(`JSON.stringify(window.attempt)`),before);
    await evaluate(`document.querySelectorAll('input[type=radio]')[1].click()`);
    assert.equal(await evaluate(`!!document.querySelector('.reading-mascot-dock')`),false,'Draft changes do not reopen dismissed hint');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>['Submit','Check answer'].includes(b.textContent)).click()`);
    await verify('tryAgain');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await until(`!document.querySelector('.reading-mascot-dock')`);
    await evaluate(`document.querySelectorAll('input[type=radio]')[0].click()`);
    assert.equal(await evaluate(`!!document.querySelector('.reading-mascot-dock')`),false);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Check second answer').click()`);
    await verify('correct');
    for(let i=0;i<2;i++) {
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Next Question').click()`);
      await until(`!document.querySelector('.reading-mascot-dock')`);
      await evaluate(`document.querySelectorAll('input[type=radio]')[0].click()`);
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>['Submit','Check answer'].includes(b.textContent)).click()`);
      await verify('correct');
    }
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>/Finish|Complete|See.*[Rr]esult|View.*[Rr]esult/.test(b.textContent)).click()`);
    await verify('celebrate');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.reading-mascot-image')).animationName`),'none');
    await until(`getComputedStyle(document.querySelector('.reading-mascot-dock')).visibility === 'visible'`);
    const shot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(os.tmpdir(),`mascot-popup-${width}.png`),Buffer.from(shot.data,'base64'));
    await evaluate(`document.querySelector('.reading-mascot-dock').style.visibility='hidden'`);
    const baseline=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(os.tmpdir(),`mascot-baseline-${width}.png`),Buffer.from(baseline.data,'base64'));
    await evaluate(`document.querySelector('.reading-mascot-dock').style.visibility='visible'`);
    await close();
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/fixture?reading=1`});
    await verify('celebrate');
    assert.equal(await evaluate(`document.querySelector('.reading-mascot-bubble p').textContent`),'Your reading is saved.');
    await evaluate(`document.querySelector('.reading-mascot-close').focus()`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
    await until(`!document.querySelector('.reading-mascot-dock')`);
    checks++;
  }
  assert.deepEqual(audioRequests,[]);
  console.log(`PASS: ${checks} viewport/role scenarios: hint, wrong, correct, repeated correct, M5/M6 completion, dismissal, reduced motion, no audio requests, automatic persistent lower-left overlays, and zero layout shifts.`);
} finally {
  ws?.close(); chrome?.kill(); await vite.close();
}
