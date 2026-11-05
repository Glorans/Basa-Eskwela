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
  '/hooks/useAuthenticatedProfile', '/services/authService', '/services/authHeaders',
  '/services/oralReadingTranscription'];
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
// M6: the mascot is a pop-up callout shown only with a message: in the green margin to the right of
// the centered question column when it fits, otherwise above the card. It must never overlap the question, answers, feedback, prompts or buttons, and M6
// has no audio controls.
const mascotText = `document.querySelector('.m6-mascot-area .reading-mascot-bubble p')?.textContent`;
async function mascotFeedback(check, expected) {
  await until(`(${mascotText} ?? '').${check}(${JSON.stringify(expected)})`);
  await pause(80);
  const state = await evaluate(`(()=>{const area=document.querySelector('.m6-mascot-area').getBoundingClientRect();
    const content=[...document.querySelectorAll('.m6-question-card, .m6-question-card *, .m6-page--questions > .m6-stage > .m6-card, .m6-page--results > .m6-stage > .m6-card *')]
      .filter(e=>!e.closest('details:not([open])')||e.closest('summary')).map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
    const overlaps=content.filter(r=>area.left<r.right-1&&area.right>r.left+1&&area.top<r.bottom-1&&area.bottom>r.top+1).length;
    const dock=document.querySelector('.m6-mascot-area .reading-mascot-dock');
    // In page flow (static), or sticky at the lower left on desktop; never fixed or absolute over content.
    return {overlaps,position:['static','sticky'].includes(getComputedStyle(dock).position),inBody:dock.parentElement===document.body,
      audio:document.querySelectorAll('.m6-page .feedback-speech,.m6-page audio').length,
      close:!!document.querySelector('.m6-mascot-area .reading-mascot-close'),
      image:!!document.querySelector('.m6-mascot-area .reading-mascot-image')};})()`);
  if (state.overlaps) await screenshot(`mascot-overlap-${await evaluate('innerWidth')}`);
  assert.deepEqual(state, { overlaps: 0, position: true, inBody: false, audio: 0, close: true, image: true });
}
async function dismissMascot() {
  await evaluate(`document.querySelector('.m6-mascot-area .reading-mascot-close').click()`);
  // The callout disappears completely: no mascot standing idle beside the card.
  await until(`!document.querySelector('.m6-mascot-area .reading-mascot-dock')`);
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
          // Single attempt: no Help me; one Submit answer; the submitted answer is final.
          assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>/Help me|Tulungan ako|second answer|ikalawang sagot/.test(b.textContent))`), false);
          await evaluate(`document.querySelectorAll('input[type=radio]')[${question === 0 ? 1 : 0}].click()`);
          await click(filipino ? 'Ipasa ang sagot' : 'Submit answer');
          if (question === 0) {
            // F2: the question's clue in the mascot bubble; closing removes the mascot entirely (no reopen button).
            await mascotFeedback('startsWith', (filipino ? 'Pag-isipan Ito: ' : 'Think about it: ') + 'Teacher hint: remember the garden.');
            await evaluate(`document.querySelector('.m6-mascot-area .reading-mascot-close').click()`);
            await until(`!document.querySelector('.m6-mascot-area .reading-mascot-dock')`);
            assert.equal(await evaluate(`!document.querySelector('.reading-mascot-reopen') && !/Show the clue again|Ipakita muli ang pahiwatig/.test(document.body.innerText)`), true);
            await layout(filipino);
            // F3 feedback unchanged; the clue is not repeated in the card; no way to answer again.
            assert.match(await evaluate(`document.querySelector('.m6-submitted-feedback--incorrect h3').textContent`), filipino ? /Hindi tama/ : /Incorrect/);
            assert.match(await evaluate(`document.querySelector('.m6-submitted-feedback').textContent`), /Teacher explanation/);
            assert.equal(await evaluate(`!document.querySelector('.m6-scaffolding-prompt') && !document.querySelector('.m6-question-card').textContent.includes('Teacher hint')`), true);
            assert.equal(await evaluate(`document.querySelector('.m6-question-card fieldset').disabled`), true);
            assert.equal(await evaluate(`[...document.querySelectorAll('.m6-actions button')].map(b=>b.textContent.trim()).join('|')`), filipino ? 'Susunod na Tanong' : 'Next Question');
            if (filipino && mode === 'questions') await screenshot(`${width}-incorrect`);
          } else if (question < 5) {
            await mascotFeedback('startsWith', filipino ? 'Ang galing! Magpatuloy' : 'Great job!');
            assert.equal(await evaluate(`!document.querySelector('.m6-mascot-area .reading-mascot-reopen') && !document.body.textContent.includes('Teacher hint')`), true);
          }
          if (question < 5) {
            await layout(filipino);
            // The flow moves forward only; Previous Question was removed on purpose.
            assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>/Previous Question|Nakaraang Tanong/.test(b.textContent))`), false);
            if (question === 2 && filipino && mode === 'questions') await screenshot(`${width}-questions`);
            await click(filipino ? 'Susunod na Tanong' : 'Next Question');
            await until(`document.querySelector('.m6-question-progress').textContent.includes(${JSON.stringify((filipino ? 'Tanong ' : 'Question ') + (question + 2))})`);
          } else await until(`!!document.querySelector('.m6-score')`);
        }
        await until(`!!document.querySelector('.m6-score')`);
        // M6 never requested speech: no listen controls, no TTS calls.
        assert.equal(await evaluate(`activityFixture.events.filter(e=>e[0]==='tts').length`), 0);
        // Results focus on comprehension; the reading result stays in M5 (no link back from M6 results).
        await mascotFeedback('startsWith', filipino ? 'Ang galing! Natapos mo' : 'Great work finishing');
        await layout(filipino);
        assert.equal(await evaluate(`document.querySelector('.m6-score strong').textContent.trim()`), '83%');
        assert.equal(await evaluate(`activityFixture.comprehension.get(${JSON.stringify(id)}).summary.hintsUsed`), 0);
        assert.equal(await evaluate(`activityFixture.comprehension.get(${JSON.stringify(id)}).questions.every(q=>q.answerHistory.length===1)`), true);
        assert.doesNotMatch(await evaluate(`document.querySelector('.m6-page').innerText`), /First-answer|Second answer|second attempt|Ikalawang sagot|unang sagot/i);
        assert.equal(await evaluate(`activityFixture.comprehension.get(${JSON.stringify(id)}).questions.every((q,i)=>q.id==='reviewed-'+i&&q.correctOptionIndex===0&&q.options[0]==='In the garden')`), true);
        if (filipino && mode === 'questions') await screenshot(`${width}-results`);
        await evaluate(`fixtureNavigate('/dashboard/read-aloud/results/${id}', {state:{readingActivityLanguage:${JSON.stringify(filipino ? 'fil' : 'en')}}})`);
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
  await click('Ipasa ang sagot');
  await until(`!!document.querySelector('.m6-error')`); await layout(true);
  await click('Subukang i-save muli');
  await mascotFeedback('startsWith', 'Ang galing! Magpatuloy');
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
  console.log('PASS aliases, missing/unsupported fallback, source switching, unchanged teacher text/IDs/options, single-attempt scores');
  console.log('Screenshots: ' + output);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.race([send('Browser.close').catch(() => {}), pause(1000)]);
  ws.close(); chrome.kill(); await Promise.race([vite.close(), pause(1000)]);
}
