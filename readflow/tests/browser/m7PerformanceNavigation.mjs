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
import { teacherSupport } from '../fixtures/m7Support.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const captures = path.resolve(root, '../.tmp/m7-function-redesign');
fs.mkdirSync(captures, { recursive: true });
const vite = await createServer({ root, configFile: false, plugins: [react(), {
  name: 'm7-saved-response-fixtures', enforce: 'pre',
  resolveId(id) { if (id === '/m7-fixture.tsx') return '\0m7-fixture.tsx'; },
  load(id) { if (id === '\0m7-fixture.tsx') return `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import { TeacherSupportPage } from '/src/modules/module7/M7Pages.tsx';
    import Reports from '/src/modules/module7/TeacherReportsPage.tsx';
    import Teacher from '/src/modules/module7/TeacherAnalyticsPage.tsx';
    import AdminSystem from '/src/modules/module7/AdminAnalyticsPage.tsx';
    import AdminStudents from '/src/modules/module7/AdminStudentPerformancePage.tsx';
    import '/src/index.css';
    const p = new URLSearchParams(location.search), page = p.get('page'), scenario = p.get('scenario');
    window.f = ${JSON.stringify(fixture)};
    window.support = ${JSON.stringify(teacherSupport)};
    window.supportWrites = [];
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
      window.support.students = [];
      window.f.adminSystem.details.classroomOptions = [];
      window.f.adminSystem.details.classroomComparisons = [];
    }
    const Page = page === 'support' ? TeacherSupportPage : page === 'reports' ? Reports : page === 'system' ? AdminSystem : page === 'students' ? AdminStudents : Teacher;
    document.body.style.background = '#173f3b';
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, null, React.createElement(Page)));
  `; },
  transform(code, id) {
    const file = id.replaceAll('\\', '/');
    if (file.endsWith('/module7/WeeklyReportSection.tsx')) {
      // Replace only the request boundary in this local fixture; real report UI and handlers run.
      const start = code.indexOf('async function requestWeeklyReports(');
      const end = code.indexOf('function downloadWeeklyReportPdf(', start);
      code = code.slice(0, start) + `async function requestWeeklyReports(path = '', options = {}, scope = 'teacher') {
        window.reportRequests ??= [];
        window.reportRequests.push({ path, method: options.method || 'GET', body: options.body, scope });
        const period = options.body ? JSON.parse(options.body).period : { startDate: '2026-11-02', endDate: '2026-11-08' };
        const saved = { id:'local-report', periodStart:period.startDate, periodEnd:period.endDate, createdAt:'2026-11-09T01:00:00Z', report: {
          period, generatedAt:'2026-11-09T01:00:00Z',
          reading:{ totalAttempts:3, studentsWithAttempts:1, averagePronunciationAccuracy:86.49, averageReadingSpeedWpm:100.4, attempts:[] },
          comprehension:{ completedAssessments:2, studentsWithAssessments:1, averageScore:75, assessments:[] },
          currentCompletionSnapshot:window.f.teacherCompletion
        }};
        if (options.method === 'POST' || path.startsWith('/')) return { success:true, report:saved };
        return { success:true, reports:[{...saved, id:path ? 'older-report' : 'local-report'}], nextCursor:path ? null : 'older' };
      }
` + code.slice(end);
      code = code.replace('import { supabase } from "../../lib/supabaseClient";', '')
        .replace('import { getApiUrl } from "../../lib/apiUrl";', 'const getApiUrl = () => "";');
      return { code, map:null };
    }
    if (file.endsWith('/module7/services/teacherQuizService.ts')) return { code: `export const getTeacherQuizAttempts = () => window.respond('teacher-quizzes', []);`, map: null };
    if (file.endsWith('/module7/services/teacherAnalyticsService.ts')) return { code: `
      export const getTeacherAnalytics = async loadQuizzes => { await loadQuizzes(); return window.respond('teacher-analytics', window.f.teacherAnalytics); };
      export const getTeacherCompletionAnalytics = () => window.respond('teacher-completion', window.f.teacherCompletion);
      export const getActiveClassroomScope = () => {
        const rooms = new URLSearchParams(location.search).get('scenario') === 'noactive' ? [] : window.f.rooms.filter(room => !(new URLSearchParams(location.search).get('scenario') === 'archived' && room.id === 'room-empty'));
        return window.respond('active-classrooms', { rooms, roomIds: new Set(rooms.map(room => room.id)), studentIds: new Set(rooms.flatMap(room => window.f.memberships[room.id] || [])) });
      };`, map: null };
    if (file.endsWith('/module7/services/classPerformanceService.ts')) return { code: `export const getClassPerformance = (q,c,scope) => window.respond('classes', {...window.f.classPerformance, classrooms:window.f.classPerformance.classrooms.filter(r=>!scope.roomId||r.roomId===scope.roomId)});`, map: null };
    if (file.endsWith('/module7/services/studentPerformanceService.ts')) return { code: `export const getStudentPerformance = () => window.respond('students', window.f.studentPerformance);`, map: null };
    if (file.endsWith('/module7/services/quizScoreService.ts')) return { code: `export const getQuizScores = () => window.respond('quizzes', window.f.quizzes);`, map: null };
    if (file.endsWith('/module4/services/classroomService.ts')) return { code: `export const getClassroomById = async id => ({id,room_code:id === 'room-a' ? 'ABC123' : 'XYZ789'}); export const getRoomEnrollments = id => window.respond('enrollment:'+id, (window.f.memberships[id] || []).map(student_id=>({student_id})));`, map: null };
    if (file.endsWith('/module7/services/m7Service.ts')) return { code: `export const m7Request = (url,method='GET',body) => {
      if (url === '/teacher' && method === 'GET') return window.respond(url,window.support);
      if (method !== 'GET' && new URLSearchParams(location.search).get('page') === 'support') {
        const parts=url.split('/'), student=window.support.students.find(s=>s.id===parts[2]);
        if (!student || parts[1]!=='students' || parts[3]!=='interventions' || !['POST','PATCH'].includes(method)) throw Error('Unauthorized fixture write');
        if (method === 'PATCH' && !student.interventions.some(i=>i.id===parts[4])) throw Error('Unauthorized fixture intervention');
        window.supportWrites.push({url,method,body});
        const record={...body,id:method==='POST'?'created-local':parts[4]};
        student.interventions=method==='POST'?[...student.interventions,record]:student.interventions.map(i=>i.id===parts[4]?record:i);
        return Promise.resolve(structuredClone(record));
      }
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
    if (m.method === 'Runtime.exceptionThrown') { errors.push(m.params.exceptionDetails); console.error(JSON.stringify(m.params.exceptionDetails)); }
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
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, `${name}: no page overflow: ${JSON.stringify(await evaluate(`Array.from(document.querySelectorAll('body *')).filter(e=>e.getClientRects().length && e.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(e).overflowX!=='auto' && !Array.from((function*(n){while(n){yield n;n=n.parentElement;}})(e.parentElement)).some(n=>['auto','scroll','hidden'].includes(getComputedStyle(n).overflowX))).slice(0,12).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width])`))}`);
    const labels = await evaluate(`Array.from(document.querySelectorAll('select')).filter(e=>e.getClientRects().length).map(e=>({labels:e.labels.length,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))`);
    assert.ok(labels.every(label => label.labels > 0 && label.width > 0 && label.height >= 44), `${name}: labels and touch targets`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(captures, name + '.png'), Buffer.from(screenshot.data, 'base64')); shots.push(name);
  };
  for (const width of [390, 768, 1366]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate('teacher'); await until('!!document.querySelector(".m7-compact-metric")');
    assert.equal(await evaluate('document.querySelectorAll("[role=tabpanel]").length'), 1);
    assert.equal(await evaluate('!!document.getElementById("analytics-panel-0")'), true);
    assert.equal(await evaluate('!!document.getElementById("weekly-report-heading")'), false);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).map(e=>e.textContent.trim())`), ['Class Performance', 'Student Performance', 'Reading Performance Metrics']);
    assert.equal(await evaluate(`document.querySelector('.m7-workflow-links, [aria-label="Related teacher workflows"]') === null`), true);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.m7-compact-metric > strong')).map(e=>e.textContent)`), ['2','6 of 12','86.49%','75%'], 'completion is the sum of the active rooms (3 fixture rooms x 4)');
    await snapshot(`${width}-class`, '.m7-analytics-navigation');
    const beforeRefresh = await evaluate('window.calls.length');
    await evaluate(`document.querySelector('[aria-label="Refresh analytics"]').focus()`); await key(' ', 'Space', 32);
    await until(`window.calls.length > ${beforeRefresh} && !document.querySelector('[aria-label="Refresh analytics"]').disabled`);
    await evaluate(`document.getElementById('analytics-tab-0').focus()`); await key('ArrowRight','ArrowRight',39);
    await until(`!!document.getElementById('analytics-panel-1') && document.activeElement.id==='analytics-tab-1'`);
    await select('teacher-student', 'ben');
    assert.match(await panelText('analytics-panel-1'), /No results yet/);
    await evaluate(`document.querySelector('[aria-label="View progress for Ben"]').click()`);
    assert.match(await panelText('analytics-panel-1'), /No completed assessments/);
    await snapshot(`${width}-student`, '#teacher-student');
    await evaluate(`document.getElementById('analytics-tab-1').focus()`); await key('End','End',35);
    await until(`!!document.getElementById('analytics-panel-2')`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.m7-compact-metric > strong')).map(e=>e.textContent)`), ['3','1','86.49%','100.4 WPM']);
    assert.equal(await evaluate('document.querySelectorAll("[role=tabpanel]").length'), 1);
    await snapshot(`${width}-reading`, '.m7-analytics-navigation');
    await key('Home','Home',36); await until(`!!document.getElementById('analytics-panel-0')`);
    for (const index of [1,2,0]) {
      await evaluate(`document.getElementById('analytics-tab-${index}').click()`);
      assert.equal(await evaluate('document.querySelectorAll("[role=tabpanel]").length'), 1);
    }
    await evaluate(`(() => {const e=document.querySelectorAll('[aria-label="Analytics filters"] select')[1]; e.value='room-a';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(50);
    await evaluate(`document.querySelector('[aria-label="Analytics filters"] button[type="submit"]').click()`);
    await until(`document.querySelectorAll('[aria-label="Analytics filters"] select')[1].value === 'room-a' && !document.querySelector('[aria-label="Refresh analytics"]').disabled`);
    await evaluate(`document.getElementById('analytics-tab-1').click()`);
    assert.deepEqual(await evaluate(`Array.from(document.getElementById('teacher-student').options).map(e=>e.value)`), ['ana']);
    await navigate('reports'); await until(`!!document.querySelector('.m7-saved-reports tbody tr')`);
    assert.equal(await evaluate(`document.querySelector('.m7-header-card, a[href="/m3/teacher/student-support"]') === null`), true);
    assert.doesNotMatch(await evaluate('document.body.textContent'), /Generate a report using recorded reading attempts|Reporting periods follow Philippine Standard Time|Competency reports and Student Support|F8-F10/);
    await snapshot(`${width}-reports`, '#weekly-report-heading');
    const reportCalls = await evaluate('window.reportRequests.length');
    await evaluate(`document.querySelector('.m7-saved-reports button').click()`);
    await until(`window.reportRequests.length > ${reportCalls}`);
    await evaluate(`(() => {const fields=document.querySelectorAll('.m7-report-dates input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(fields[0],'2026-11-02');fields[0].dispatchEvent(new Event('input',{bubbles:true}));setter.call(fields[1],'2026-11-08');fields[1].dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(50);
    await evaluate(`document.querySelector('.m7-report-dates button').click()`);
    await until(`document.body.textContent.includes('Weekly report generated and saved successfully.')`);
    assert.deepEqual(await evaluate(`JSON.parse(window.reportRequests.find(r=>r.method==='POST').body)`), {period:{startDate:'2026-11-02',endDate:'2026-11-08'}});
    await evaluate(`Array.from(document.querySelectorAll('.m7-saved-reports button')).find(e=>e.textContent==='View Report').click()`);
    await until(`document.body.textContent.includes('Previously saved report opened successfully.')`);
    await evaluate(`Array.from(document.querySelectorAll('.m7-saved-reports button')).find(e=>e.textContent==='Load More').click()`);
    await until(`document.querySelectorAll('.m7-saved-reports tbody tr').length===2`);
    await navigate('support'); await until(`!!document.getElementById('support-panel-0')`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('[role="tabpanel"]')).filter(e=>e.getClientRects().length).length`),1);
    assert.doesNotMatch(await evaluate('document.body.innerText'), /Notifications|No unread alerts|View performance analytics|View weekly reports|F8|F9|F10/);
    await snapshot(`${width}-support-overview`, '.m7-support-tabs');
    await evaluate(`document.querySelector('[aria-label="View details for Ana"]').click()`);
    assert.match(await evaluate('document.body.innerText'), /Recovery in progress/);
    await evaluate(`document.getElementById('support-tab-0').focus()`); await key('ArrowRight','ArrowRight',39);
    await until(`!document.getElementById('support-panel-1').hidden`);
    assert.equal(await evaluate(`document.getElementById('support-student').value`),'ana');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.m7-competency-cards strong')).map(e=>e.textContent)`),['100%','50%','No data']);
    assert.doesNotMatch(await evaluate('document.body.innerText'), /Extra saved attempt/);
    await evaluate(`Array.from(document.querySelectorAll('#support-panel-1 summary')).find(e=>e.textContent.includes('Other Saved Results')).click()`);
    assert.match(await evaluate('document.body.innerText'), /Extra saved attempt/);
    assert.match(await evaluate('document.body.innerText'), /1 of 3 passages completed/);
    await snapshot(`${width}-support-competencies`, '#support-student');
    await evaluate(`document.getElementById('support-tab-2').click()`);
    assert.equal(await evaluate(`document.getElementById('support-student').value`),'ana');
    await evaluate(`Array.from(document.querySelectorAll('#support-panel-2 button')).find(e=>e.textContent==='Record Intervention').click()`);
    const setField = async (selector,value) => {await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(40);};
    await setField('.m7-intervention-form textarea','Local fixture intervention');
    await evaluate(`document.getElementById('support-tab-1').click()`);
    await evaluate(`document.getElementById('support-tab-2').click()`);
    assert.equal(await evaluate(`document.querySelector('.m7-intervention-form textarea').value`),'Local fixture intervention');
    await snapshot(`${width}-support-intervention-form`, '.m7-intervention-form');
    await evaluate(`document.querySelector('.m7-intervention-form').requestSubmit()`);
    await until(`!document.querySelector('.m7-intervention-form') && document.body.innerText.includes('Intervention saved.')`);
    assert.equal(await evaluate(`window.supportWrites[0].method`),'POST');
    assert.equal(await evaluate(`window.supportWrites[0].url`),'/students/ana/interventions');
    await evaluate(`document.querySelector('.m7-intervention-history button').click()`);
    await setField('.m7-intervention-form textarea','Updated local fixture intervention');
    await evaluate(`document.querySelector('.m7-intervention-form').requestSubmit()`);
    await until(`window.supportWrites.length===2 && !document.querySelector('.m7-intervention-form')`);
    assert.equal(await evaluate(`window.supportWrites[1].method`),'PATCH');
    assert.match(await evaluate(`document.querySelector('.m7-intervention-history').innerText`),/Updated local fixture intervention/);
    await snapshot(`${width}-support-interventions`, '#support-student');
    await select('support-student','ben');
    assert.match(await evaluate('document.body.innerText'), /No interventions recorded/);
    await evaluate(`document.getElementById('support-tab-1').click()`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.m7-competency-cards strong')).map(e=>e.textContent)`),['No data','No data','No data']);
    await navigate('system'); await until(`!!document.getElementById('admin-classroom')`);
    assert.deepEqual(await evaluate(`Array.from(document.getElementById('admin-classroom').options).slice(0,2).map(e=>[e.value,e.textContent.trim()])`), [['room-a','Grade 5 \u2014 Teacher T \u00b7 Room ABC123'],['room-b','Grade 5 \u2014 Teacher T \u00b7 Room XYZ789']]);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Analytics filters"] select')[1].options).slice(1,3).map(e=>e.textContent.trim())`), ['Grade 5 \u2014 Teacher T \u00b7 Room ABC123','Grade 5 \u2014 Teacher T \u00b7 Room XYZ789']);
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
  for (const page of ['teacher', 'system', 'students', 'support']) {
    await navigate(page, 'empty');
    await until(`document.body.textContent.includes('${page === 'support' ? 'No enrolled students in your classrooms' : page === 'students' ? 'No Student accounts yet' : 'No classrooms available'}') || document.body.textContent.includes('No classrooms found')`);
    await navigate(page, 'error'); await until(`!!document.querySelector('[role="alert"]')`);
    assert.match(await evaluate('document.body.innerText'), /Fixture unavailable/);
    await navigate(page, 'slow'); assert.match(await evaluate('document.body.innerText'), /Loading/);
    await until(`!document.body.innerText.includes('Loading')`);
  }
  // Active classrooms only: an archived room is absent from the selector; no active rooms shows an empty state.
  await navigate('teacher', 'archived'); await until('!!document.querySelector(".m7-compact-metric")');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Analytics filters"] select')[1].options).map(o=>o.value)`), ['', 'room-a', 'room-b']);
  assert.doesNotMatch(await evaluate('document.body.innerText'), /Empty classroom/);
  await navigate('teacher', 'noactive'); await until(`document.body.innerText.includes('No active classrooms')`);
  assert.equal(await evaluate(`document.querySelector('.m7-no-active-rooms a').getAttribute('href')`), '/m3/teacher/archived-classrooms');
  assert.equal(await evaluate('document.querySelectorAll(".m7-compact-metric").length'), 0);
  assert.deepEqual(blocked, [], 'No remote access'); assert.deepEqual(errors, [], 'No browser runtime exceptions');
  fs.writeFileSync(path.join(captures, 'results.json'), JSON.stringify({ widths: [390, 768, 1366], shots, blocked, errors }, null, 2));
  console.log(JSON.stringify({ screenshots: shots.length, captures, status: 'passed', blocked, errors }, null, 2));
} finally { ws?.close(); chrome?.kill(); await vite.close(); }
