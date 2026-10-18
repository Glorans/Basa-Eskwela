import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../../', import.meta.url));
process.chdir(root);
const output = path.join(os.tmpdir(), 'readflow-activity-language');
fs.mkdirSync(output, { recursive: true });
const fixture = path.join(root, 'tests/browser/readingActivities/fixture.tsx').replaceAll('\\', '/');
const boundaries = ['/services/classroomService', '/services/oralReadingService', '/services/comprehensionService',
  '/hooks/useAudioRecorder', '/useVoiceFollowStoryScroll', '/services/diagnosticAudio', '/services/diagnosticTts',
  '/hooks/useAuthenticatedProfile', '/services/authService'];
const vite = await createServer({ root, configFile: false, envFile: false,
  optimizeDeps: { entries: ['tests/browser/readingActivities/fixture.tsx'] },
  plugins: [{ name: 'reading-activity-fixture', enforce: 'pre',
    resolveId(id) { if (boundaries.some(suffix => id.endsWith(suffix) || id.endsWith(suffix + '.ts'))) return fixture; },
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/dashboard/')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/tests/browser/readingActivities/fixture.tsx"></script></body></html>'));
    }); },
  }, react()], server: { host: '127.0.0.1', port: 5193, strictPort: true } });
await vite.listen();
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=9247',
  '--user-data-dir=' + path.join(output, 'chrome-profile'), 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let target;
for (let i = 0; i < 100; i++) {
  try { target = await (await fetch('http://127.0.0.1:9247/json/new?about:blank', { method: 'PUT' })).json(); break; }
  catch { await pause(100); }
}
assert.ok(target, 'Headless Chrome must start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
async function until(expression) {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(25); }
  throw Error(`Timed out: ${expression}\n${errors.join('\n')}\n${await evaluate('JSON.stringify({text:document.querySelector(".basa-content")?.innerText,events:window.activityFixture?.events})')}`);
}
async function click(text) {
  await evaluate(`(()=>{ const el=[...document.querySelectorAll('.basa-content button,.basa-content a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}); if(!el||el.disabled) throw Error('Unavailable control: '+${JSON.stringify(text)}); el.click(); })()`);
}
async function room() {
  await evaluate(`fixtureNavigate('/dashboard/learning-rooms/room')`);
  await until(`document.querySelectorAll('article').length===18`);
}
async function open(id, filipino) {
  const index = await evaluate(`activityFixture.sources.findIndex(s=>s.id===${JSON.stringify(id)})`);
  await evaluate(`document.querySelectorAll('article')[${index}].querySelector('button').click()`);
  await until(`!!document.querySelector('.read-aloud-record-button')`);
  assert.equal(await evaluate(`history.state.usr.readingActivityLanguage`), filipino ? 'fil' : 'en');
  assert.equal(await evaluate(`document.querySelector('.read-aloud-story-text').textContent.trim()`), 'Si Maya ay may hardin. Masaya siyang nagtanim ng mga bulaklak.');
}
async function layout(filipino) {
  const data = await evaluate(`(()=>{const el=document.querySelector('.activity-page-shell,.m6-page');return {lang:el.lang,
    overflow:document.documentElement.scrollWidth-innerWidth, contentOverflow:document.querySelector('.basa-content').scrollWidth-document.querySelector('.basa-content').clientWidth,
    text:el.innerText, buttons:[...el.querySelectorAll('button,a')].filter(e=>getComputedStyle(e).display!=='none').map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,client:e.clientWidth,scroll:e.scrollWidth}))};})()`);
  assert.equal(data.lang, filipino ? 'fil' : 'en');
  assert.ok(data.overflow <= 1 && data.contentOverflow <= 1, JSON.stringify(data));
  for (const button of data.buttons) assert.ok(button.scroll <= button.client + 1, `Clipped control: ${JSON.stringify(button)}`);
  if (filipino) assert.doesNotMatch(data.text, /Start Recording|Stop Recording|Choose one answer|Next Question|Previous Question|Continue to Questions|First-answer score|Words to Practice|Pronunciation Accuracy|Back to Learning Room|Please wait|Your first answer|correct on the first answer|What to practice next|Read-aloud activity completed/);
}
async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:5193/dashboard/learning-rooms/room' });
  await until(`document.querySelectorAll('article').length===18`);
  for (const [width, height] of [[1366, 768], [390, 844], [320, 568]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const lang of ['Filipino', 'en']) for (const mode of ['questions', 'oral', 'legacy']) {
      await room();
      await evaluate(`activityFixture.oral.clear();activityFixture.comprehension.clear();activityFixture.events.length=0;`);
      const filipino = lang !== 'en', id = `${lang}-${mode}`;
      await open(id, filipino); await layout(filipino);
      if (filipino && mode === 'questions') await screenshot(`${width}-reading`);
      await click(filipino ? 'Simulan ang Pagre-record' : 'Start Recording');
      await until(`document.querySelector('.read-aloud-record-button').textContent.includes(${JSON.stringify(filipino ? 'Ihinto' : 'Stop')})`);
      await layout(filipino);
      await click(filipino ? 'Ihinto ang Pagre-record' : 'Stop Recording');
      await until(`!!document.querySelector('.result-feedback-score')`);
      await layout(filipino);
      assert.equal(await evaluate(`document.querySelector('.result-feedback-score-value').textContent`), '85%');
      assert.match(await evaluate(`document.querySelector('.result-feedback-summary').textContent`), /61/);
      assert.deepEqual(await evaluate(`activityFixture.events.filter(e=>e[0]==='transcribe').map(e=>e[1])`), [filipino ? 'fil' : 'en']);
      if (mode === 'oral') {
        assert.equal(await evaluate(`document.querySelector('a[href*="/comprehension"]')===null`), true);
        assert.match(await evaluate(`document.querySelector('.result-feedback [role=status]').textContent`), filipino ? /Tapos na/ : /completed/);
        assert.deepEqual(await evaluate(`activityFixture.events.filter(e=>e[0]==='status').map(e=>e.slice(1))`), [[id, 'completed']]);
      } else {
        await click(filipino ? 'Magpatuloy sa mga Tanong' : 'Continue to Questions');
        await until(`document.querySelectorAll('.m6-option').length===4`);
        for (let question = 0; question < 6; question++) {
          await layout(filipino);
          const expectedType = ['Literal', filipino ? 'Inferensyal' : 'Inferential', filipino ? 'Kritikal' : 'Critical'][Math.floor(question / 2)];
          assert.equal(await evaluate(`document.querySelector('.m6-question-progress').textContent.trim()`), `${filipino ? 'Tanong' : 'Question'} ${question + 1} ${filipino ? 'sa' : 'of'} 6 · ${expectedType}`);
          assert.equal(await evaluate(`document.querySelector('.m6-question-card h2').textContent`), `Teacher reviewed question ${question + 1}: Where did Maya plant the flowers?`);
          if (question === 0) {
            await click(filipino ? 'Tulungan ako' : 'Help me');
            await until(`document.querySelector('.m6-question-card aside')?.textContent.includes('Teacher hint:')`);
            await evaluate(`document.querySelectorAll('input[type=radio]')[1].click()`);
            await click(filipino ? 'Suriin ang sagot' : 'Check answer');
            await until(`document.querySelector('.m6-feedback')?.textContent.includes(${JSON.stringify(filipino ? 'Hindi pa tama' : 'Not quite')})`);
          }
          await evaluate(`document.querySelector('input[type=radio]').click()`);
          await click(question === 0 ? (filipino ? 'Suriin ang ikalawang sagot' : 'Check second answer') : question === 5 ? (filipino ? 'Ipasa' : 'Submit') : (filipino ? 'Suriin ang sagot' : 'Check answer'));
          if (question < 5) {
            await until(`document.querySelector('.m6-feedback')?.textContent.startsWith(${JSON.stringify(filipino ? 'Tama!' : 'Correct!')})`);
            await layout(filipino);
            if (question === 1) {
              await click(filipino ? 'Nakaraang Tanong' : 'Previous Question');
              assert.equal(await evaluate(`document.querySelector('input[type=radio]').checked`), true);
              await click(filipino ? 'Susunod na Tanong' : 'Next Question');
            }
            if (question === 2 && filipino && mode === 'questions') await screenshot(`${width}-questions`);
            await click(filipino ? 'Susunod na Tanong' : 'Next Question');
            await until(`document.querySelector('.m6-question-progress').textContent.includes(${JSON.stringify((filipino ? 'Tanong ' : 'Question ') + (question + 2))})`);
          } else await until(`!!document.querySelector('.m6-score')`);
        }
        await until(`document.querySelector('.m6-page a[href*="read-aloud/results"]')!==null`);
        await layout(filipino);
        assert.equal(await evaluate(`document.querySelector('.m6-score strong').textContent.trim()`), '83%');
        assert.equal(await evaluate(`activityFixture.comprehension.get(${JSON.stringify(id)}).summary.hintsUsed`), 1);
        assert.equal(await evaluate(`activityFixture.comprehension.get(${JSON.stringify(id)}).questions.every((q,i)=>q.id==='reviewed-'+i&&q.correctOptionIndex===0&&q.options[0]==='In the garden')`), true);
        if (filipino && mode === 'questions') await screenshot(`${width}-results`);
        await click(filipino ? 'Tingnan ang puna sa aking pagbasa' : 'See my reading feedback');
        await until(`!!document.querySelector('.result-feedback-score')`); await layout(filipino);
      }
      console.log(`PASS ${width}x${height} ${lang} ${mode}: M4 → M5 → results${mode === 'oral' ? '' : ' → M6 → results → M5'}`);
    }
  }
  // Uncertain saves retain their submission/request IDs and localized recovery UI.
  await room();
  await evaluate(`activityFixture.oral.clear();activityFixture.comprehension.clear();activityFixture.events.length=0;activityFixture.failures.save=1`);
  await open('Filipino-questions', true);
  await click('Simulan ang Pagre-record'); await click('Ihinto ang Pagre-record');
  await until(`document.querySelector('.read-aloud-status')?.textContent.includes('Hindi ma-save')`);
  await layout(true);
  await click('Subukang I-save Muli');
  await until(`!!document.querySelector('.result-feedback-score')`);
  assert.equal(await evaluate(`activityFixture.events.filter(e=>e[0]==='transcribe').length`), 1);
  assert.equal(await evaluate(`(()=>{const saves=activityFixture.events.filter(e=>e[0]==='save');return JSON.stringify(saves[0][1])===JSON.stringify(saves[1][1])})()`), true);
  await evaluate(`activityFixture.failures.start=1`);
  await click('Magpatuloy sa mga Tanong');
  await until(`!!document.querySelector('.m6-error')`); await layout(true);
  assert.doesNotMatch(await evaluate(`document.querySelector('.m6-error').innerText`), /Network response lost/);
  await click('Subukang muli ang pag-unawa');
  await until(`document.querySelectorAll('.m6-option').length===4`);
  await evaluate(`activityFixture.failures.action=1;document.querySelector('input[type=radio]').click()`);
  await click('Suriin ang sagot');
  await until(`!!document.querySelector('.m6-error')`); await layout(true);
  await click('Subukang i-save muli');
  await until(`document.querySelector('.m6-feedback')?.textContent.startsWith('Tama!')`);
  assert.equal(await evaluate(`(()=>{const actions=activityFixture.events.filter(e=>e[0]==='action');return actions[0][2].requestId===actions[1][2].requestId})()`), true);
  assert.equal(await evaluate(`(()=>{const starts=activityFixture.events.filter(e=>e[0]==='start');return starts[0][1].submissionId===starts[1][1].submissionId})()`), true);
  await click('Bumalik sa gawain sa pagbasa');
  await until(`!!document.querySelector('.read-aloud-continue')`); await layout(true);
  await click('Magpatuloy sa Pag-unawa');
  await until(`document.querySelectorAll('.m6-option').length===4`);
  await evaluate(`fixtureNavigate('/dashboard/read-aloud/results/Filipino-questions', {state:{readingActivityLanguage:'fil'}})`);
  await until(`!!document.querySelector('.result-feedback-score')`); await layout(true);
  await evaluate(`document.querySelector('.result-feedback-listen').click()`);
  await until(`document.querySelector('[role=alert]')?.textContent.includes('Hindi magagamit ngayon')`);
  await layout(true);
  console.log('PASS Filipino save/start/answer/TTS errors, exact retries, and back-to-reading navigation');

  // Same mounted page changes source: metadata, rather than last activity/account/browser, wins.
  await room();
  for (const id of ['fil-PH-questions', 'tl-questions', 'en-questions', 'missing-questions', 'unsupported-questions']) {
    const filipino = id.startsWith('fil-') || id.startsWith('tl-');
    await evaluate(`fixtureNavigate('/dashboard/reading-materials/${id}/read-aloud?roomId=room&activityAssignmentId=${id}&recordAgain=1', {state:{readingActivityLanguage:'fil'}})`);
    await until(`document.querySelector('.activity-page-shell')?.lang===${JSON.stringify(filipino ? 'fil' : 'en')} && !!document.querySelector('.read-aloud-record-button') && !document.querySelector('.read-aloud-record-button').disabled`);
    await layout(filipino);
  }
  assert.deepEqual(errors, []);
  console.log('PASS aliases, missing/unsupported fallback, source switching, unchanged teacher text/IDs/options, hint and second-answer scores');
  console.log('Screenshots: ' + output);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.race([send('Browser.close').catch(() => {}), pause(1000)]);
  ws.close(); chrome.kill(); await Promise.race([vite.close(), pause(1000)]);
}
