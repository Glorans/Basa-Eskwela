// Local saved-response fixtures. All non-local traffic is blocked; no account or database needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import * as fixture from '../fixtures/m7Performance.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const captures = path.resolve(root, '../.tmp/m7-selection-review');
fs.mkdirSync(captures, { recursive: true });
const vite = await createServer({ root, configFile: false, plugins: [react(), {
  name: 'm7-saved-response-fixtures', enforce: 'pre',
  resolveId(id) { if (id === '/m7-fixture.tsx') return '\0m7-fixture.tsx'; },
  load(id) { if (id === '\0m7-fixture.tsx') return `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import Teacher from '/src/modules/module7/TeacherAnalyticsPage.tsx';
    import AdminSystem from '/src/modules/module7/AdminAnalyticsPage.tsx';
    import AdminStudents from '/src/modules/module7/AdminStudentPerformancePage.tsx';
    import '/src/index.css';
    const p = new URLSearchParams(location.search), page = p.get('page'), scenario = p.get('scenario');
    window.f = ${JSON.stringify(fixture)};
    window.calls = [];
    window.respond = async (key, value) => {
      window.calls.push(key);
      if (scenario === 'error') throw Error('Fixture unavailable');
      if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 600));
      return structuredClone(value);
    };
    if (scenario === 'empty') {
      window.f.teacherCompletion = { ...window.f.teacherCompletion, classrooms: [], students: [] };
      window.f.classPerformance = { ...window.f.classPerformance, classrooms: [], totalClassrooms: 0, totalEnrolledStudents: 0 };
      window.f.studentPerformance = { totalStudents: 0, students: [] };
      window.f.adminStudents = [];
      window.f.adminSystem.details.classroomOptions = [];
      window.f.adminSystem.details.classroomComparisons = [];
    }
    const Page = page === 'system' ? AdminSystem : page === 'students' ? AdminStudents : Teacher;
    document.body.style.background = '#173f3b';
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, null, React.createElement(Page)));
  `; },
  transform(code, id) {
    const file = id.replaceAll('\\', '/');
    if (file.endsWith('/module7/WeeklyReportSection.tsx')) return { code: 'export default function Reports(){return null}', map: null };
    if (file.endsWith('/module7/services/teacherQuizService.ts')) return { code: `export const getTeacherQuizAttempts = () => window.respond('teacher-quizzes', []);`, map: null };
    if (file.endsWith('/module7/services/teacherAnalyticsService.ts')) return { code: `
      export const getTeacherAnalytics = async loadQuizzes => { await loadQuizzes(); return window.respond('teacher-analytics', window.f.teacherAnalytics); };
      export const getTeacherCompletionAnalytics = () => window.respond('teacher-completion', window.f.teacherCompletion);`, map: null };
    if (file.endsWith('/module7/services/classPerformanceService.ts')) return { code: `export const getClassPerformance = (q,c,scope) => window.respond('classes', {...window.f.classPerformance, classrooms:window.f.classPerformance.classrooms.filter(r=>!scope.roomId||r.roomId===scope.roomId)});`, map: null };
    if (file.endsWith('/module7/services/studentPerformanceService.ts')) return { code: `export const getStudentPerformance = () => window.respond('students', window.f.studentPerformance);`, map: null };
    if (file.endsWith('/module7/services/quizScoreService.ts')) return { code: `export const getQuizScores = () => window.respond('quizzes', window.f.quizzes);`, map: null };
    if (file.endsWith('/module4/services/classroomService.ts')) return { code: `export const getRoomEnrollments = id => window.respond('enrollment:'+id, (window.f.memberships[id] || []).map(student_id=>({student_id})));`, map: null };
    if (file.endsWith('/module7/services/m7Service.ts')) return { code: `export const m7Request = (url,method='GET') => {
      if (method !== 'GET') throw Error('Mutations forbidden in fixture');
      if (url.startsWith('/system')) {
        const data=structuredClone(window.f.adminSystem), roomId=new URLSearchParams(url.split('?')[1]).get('roomId');
        if(roomId){data.details.filters.roomId=roomId;data.details.classroomComparisons=data.details.classroomComparisons.filter(r=>r.id===roomId);}
        return window.respond(url, data);
      }
      if (url === '/admin/students') return window.respond(url, window.f.adminStudents);
      const student=window.f.adminStudents.find(s=>url==='/admin/students/'+s.id);
      if (!student) throw Error('Unauthorized fixture request');
      return window.respond(url, {...student, competency:{literal:{total:2,correct:1,score:50}},contexts:[],activities:[],quizzes:[],readings:[],historicalQuizzes:[],interventions:{own:[],others:{total:0,planned:0,inProgress:0,completed:0}}});
    };`, map: null };
  },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url.startsWith('/fixture')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/m7-fixture.tsx"></script></body></html>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-browser-'));
let chrome, ws;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await vite.listen(); const port = vite.httpServer.address().port;
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let startupError; chrome.on('error', error => startupError = error);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile) && !startupError; i++) await pause(100);
  if (startupError) throw startupError;
  const chromePort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (!message.id) return; const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const until = async expression => { for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(50); } throw Error('Timeout: ' + expression); };
  const blocked = [], errors = [];
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    const local = /^http:\/\/127\.0\.0\.1:/.test(request.url) || request.url.startsWith('data:');
    if (!local) blocked.push(request.url);
    void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId } : { requestId, errorReason: 'BlockedByClient' });
  });
  await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const navigate = async (page, scenario = '') => { await send('Page.navigate', { url: `http://127.0.0.1:${port}/fixture?page=${page}&scenario=${scenario}` }); await until('!!document.querySelector(".m7-dashboard")'); };
  const select = async (id, value) => { await evaluate(`(() => { const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(40); };
  const key = async (key, code, keyCode) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }); };
  const panelText = id => evaluate(`document.getElementById('${id}').innerText`);
  const shots = [];
  const snapshot = async (name, selector) => {
    await evaluate(`(() => {const e=document.querySelector('${selector}'); (e.closest('label') || e).scrollIntoView({block:'start'});})()`); await pause(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, `${name}: no page overflow`);
    const labels = await evaluate(`Array.from(document.querySelectorAll('select')).filter(e=>e.getClientRects().length).map(e=>({labels:e.labels.length,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))`);
    assert.ok(labels.every(label => label.labels > 0 && label.width > 0 && label.height >= 44), `${name}: labels and touch targets`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(captures, name + '.png'), Buffer.from(screenshot.data, 'base64')); shots.push(name);
  };
  for (const width of [390, 768, 1366]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate('teacher'); await until('!!document.getElementById("teacher-classroom")');
    await evaluate('document.getElementById("analytics-tab-1").click()');
    await until('!document.getElementById("analytics-panel-1").hidden');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Teacher analytics sections"] button')).map(e=>e.textContent)`), ['Overview', 'Classrooms & Students', 'Assessments']);
    const calls = await evaluate('JSON.stringify(window.calls)');
    assert.deepEqual(await evaluate(`Array.from(document.getElementById('teacher-classroom').options).slice(0,2).map(e=>e.textContent.trim())`), ['Grade 5 (room-a)', 'Grade 5 (room-b)']);
    await select('teacher-classroom', 'room-b');
    assert.equal(await evaluate(`document.querySelectorAll('#performance-panel-0 h3').length`), 1);
    assert.match(await panelText('performance-panel-0'), /N\/A/);
    await snapshot(`${width}-teacher-class`, '#teacher-classroom');
    await evaluate(`document.getElementById('teacher-classroom').focus()`); await key('ArrowUp', 'ArrowUp', 38);
    await until(`document.getElementById('teacher-classroom').value==='room-a'`);
    await evaluate(`document.getElementById('performance-tab-0').focus()`); await key('ArrowRight', 'ArrowRight', 39);
    await until(`document.activeElement.id==='performance-tab-1' && !document.getElementById('performance-panel-1').hidden`);
    const studentBefore = await evaluate(`document.querySelector('#performance-panel-1 article:has(> div > h3)').innerText`);
    await select('teacher-student-classroom', 'room-b');
    assert.equal(await evaluate(`document.querySelector('#performance-panel-1 article:has(> div > h3)').innerText`), studentBefore);
    await select('teacher-student', 'ben');
    assert.equal(await evaluate(`document.querySelectorAll('#performance-panel-1 article:has(> div > h3)').length`), 1);
    await snapshot(`${width}-teacher-student`, '#teacher-student-classroom');
    await select('teacher-student-classroom', 'room-empty');
    assert.match(await panelText('performance-panel-1'), /No students in this classroom/);
    assert.equal(await evaluate('JSON.stringify(window.calls)'), calls);
    await evaluate(`document.getElementById('performance-tab-1').focus()`); await key('Home', 'Home', 36);
    await until(`document.activeElement.id==='performance-tab-0'`);
    await key('End', 'End', 35); await until(`document.activeElement.id==='performance-tab-1'`);
    await key('ArrowLeft', 'ArrowLeft', 37); await until(`document.activeElement.id==='performance-tab-0'`);

    await navigate('system'); await until(`!!document.getElementById('admin-classroom')`);
    const systemBefore = await evaluate(`document.querySelector('.m7-dashboard-content > .m7-metrics').innerText`);
    await select('admin-classroom', 'room-b');
    assert.equal(await evaluate(`document.querySelector('.m7-dashboard-content > .m7-metrics').innerText`), systemBefore);
    await evaluate(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent==='Compare classrooms').click()`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('details')).find(e=>e.textContent.includes('Compare classrooms')).querySelectorAll('tbody tr').length`), 3);
    await snapshot(`${width}-admin-class`, '#admin-classroom');

    await navigate('students'); await until(`!!document.getElementById('admin-student') && !document.getElementById('admin-student-classroom').disabled`);
    await select('admin-student', 'ana'); await until(`!!document.getElementById('admin-student-detail')`);
    const adminBefore = await evaluate(`document.getElementById('admin-student-detail').closest('section').innerText`);
    await select('admin-student-classroom', 'room-b');
    await until(`document.getElementById('admin-student').options.length===3`);
    assert.deepEqual(await evaluate(`Array.from(document.getElementById('admin-student').options).map(e=>e.value)`), ['', 'ana', 'ben']);
    await select('admin-student', 'ana'); await until(`!!document.getElementById('admin-student-detail')`);
    assert.equal(await evaluate(`document.getElementById('admin-student-detail').closest('section').innerText`), adminBefore);
    await select('admin-student', 'ben'); await until(`document.getElementById('admin-student-detail')?.textContent.includes('Ben')`);
    assert.equal(await evaluate(`document.querySelectorAll('#admin-student-detail').length`), 1);
    await snapshot(`${width}-admin-student`, '#admin-student-classroom');
    await select('admin-student-classroom', 'room-empty');
    await until(`document.body.innerText.includes('No students match these filters')`);
  }
  for (const page of ['teacher', 'system', 'students']) {
    await navigate(page, 'empty');
    await until(`document.body.textContent.includes('${page === 'students' ? 'No Student accounts yet' : 'No classrooms available'}') || document.body.textContent.includes('No classrooms found')`);
    await navigate(page, 'error'); await until(`!!document.querySelector('[role="alert"]')`);
    assert.match(await evaluate('document.body.innerText'), /Fixture unavailable/);
    await navigate(page, 'slow'); assert.match(await evaluate('document.body.innerText'), /Loading/);
    await until(`!document.body.innerText.includes('Loading')`);
  }
  assert.deepEqual(blocked, [], 'No remote access'); assert.deepEqual(errors, [], 'No browser runtime exceptions');
  fs.writeFileSync(path.join(captures, 'results.json'), JSON.stringify({ widths: [390, 768, 1366], shots, blocked, errors }, null, 2));
  console.log(JSON.stringify({ screenshots: shots.length, captures, status: 'passed', blocked, errors }, null, 2));
} finally { ws?.close(); chrome?.kill(); await vite.close(); }
