// Local browser check: Student personal reading AND comprehension (2026-11-17). Real Student pages, M5/M6 services
// and the real /api/oral-reading and /api/comprehension routes over an in-memory database. Auth is a fixture; no
// Supabase, Azure, microphone or production session. The reading is saved through the real save route with a
// fixture transcript. m6_apply_action is emulated in memory, including the completion rule of the SQL proposal
// m6_student_personal_comprehension (the real function is rehearsed separately on a restored database copy).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);

const EARLY = '00000000-0000-4000-8000-0000000000e1', P_EARLY = '00000000-0000-4000-8000-0000000000f1';
const ENGLISH = '00000000-0000-4000-8000-0000000000e2', P_ENGLISH = '00000000-0000-4000-8000-0000000000f2';
const PATH = '00000000-0000-4000-8000-0000000000c1', ROOM = '00000000-0000-4000-8000-0000000000d1';
const ASSIGNMENT = '00000000-0000-4000-8000-0000000000a1';
const LONER = '00000000-0000-4000-8000-000000000011', ENROLLED = '00000000-0000-4000-8000-000000000012';
const OTHER = '00000000-0000-4000-8000-000000000013', TEACHER = '00000000-0000-4000-8000-000000000021';
const FIL = '00000000-0000-4000-8000-0000000000e3', P_FIL = '00000000-0000-4000-8000-0000000000f3', FIL_PATH = '00000000-0000-4000-8000-0000000000c2';
const FIL_LONER = '00000000-0000-4000-8000-000000000014';
const FIL_TEXT = 'Si Lea ay may regalo. Ibinigay niya ito sa kanyang lola.';
// The app's own Filipino labels (activityLanguage.ts): the Filipino flow is checked in Filipino.
const FILIPINO = Object.fromEntries([...fs.readFileSync(path.resolve('readflow/src/pages/reading-activity/activityLanguage.ts'), 'utf8')
  .matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)].map(m => [m[1], m[2]]));
const EARLY_TEXT = 'Ben runs fast to the park. He sees a red kite in the sky.';
const ENGLISH_TEXT = 'Ana reads a book. She shares the book with her friend.';

const questionRows = [];
const answerRows = [];
for (const [moduleId, passageId, text] of [[EARLY, P_EARLY, EARLY_TEXT], [ENGLISH, P_ENGLISH, ENGLISH_TEXT], [FIL, P_FIL, FIL_TEXT]]) {
  ['literal', 'inferential', 'critical'].forEach((type, index) => {
    const id = randomUUID();
    questionRows.push({ id, module_id: moduleId, passage_id: passageId, material_id: null, question_set_id: null, question_type: type,
      question_text: `${moduleId === EARLY ? 'Early' : 'English'} ${type} question?`, options: ['Right answer', 'Wrong one', 'Wrong two', 'Wrong three'],
      scaffolding_hint: 'Read the story again.', review_status: 'reviewed', display_order: index + 1 });
    answerRows.push({ question_id: id, correct_answer: 'Right answer', answer_explanation: 'The story says so.', supporting_evidence: text.split('.')[0] });
  });
}
const tables = {
  profiles: [{ id: LONER, role: 'student', full_name: 'Loner' }, { id: ENROLLED, role: 'student', full_name: 'Enrolled' },
    { id: OTHER, role: 'student', full_name: 'Other' }, { id: FIL_LONER, role: 'student', full_name: 'Filipino Loner' },
    { id: TEACHER, role: 'teacher', teacher_status: 'approved' }],
  modules: [
    { id: EARLY, path_id: PATH, title: 'Early Start', difficulty: 'Easy', status: 'published', passage: EARLY_TEXT, deleted_at: null, created_by: TEACHER },
    { id: ENGLISH, path_id: PATH, title: 'English', difficulty: 'Easy', status: 'published', passage: ENGLISH_TEXT, deleted_at: null, created_by: TEACHER },
    { id: FIL, path_id: FIL_PATH, title: 'Ang Regalo', difficulty: 'Easy', status: 'published', passage: FIL_TEXT, deleted_at: null, created_by: TEACHER },
  ],
  module_passages: [
    { id: P_EARLY, module_id: EARLY, title: 'Early Start', passage_text: EARLY_TEXT, display_order: 1 },
    { id: P_ENGLISH, module_id: ENGLISH, title: 'English', passage_text: ENGLISH_TEXT, display_order: 1 },
    { id: P_FIL, module_id: FIL, title: 'Ang Regalo', passage_text: FIL_TEXT, display_order: 1 },
  ],
  learning_paths: [{ id: PATH, path_name: 'English Foundations', language: 'English' }, { id: FIL_PATH, path_name: 'Filipino Panimulang Pagbasa', language: 'Filipino' }],
  rooms: [{ id: ROOM, teacher_id: TEACHER, archived_at: null }],
  enrollments: [{ id: 'e1', student_id: ENROLLED, room_id: ROOM }],
  room_modules: [{ id: ASSIGNMENT, room_id: ROOM, module_id: ENGLISH, removed_at: null }],
  room_module_recipients: [],
  oral_reading_attempts: [],
  comprehension_questions: questionRows,
  comprehension_question_answers: answerRows,
  m6_comprehension_attempts: [],
  m6_comprehension_responses: [],
};
class Query {
  constructor(table) { this.table = table; this.filters = []; this.action = 'select'; }
  select() { return this; }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  is(c, v) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  order(c, { ascending = true } = {}) { (this.ordering ??= []).push([c, ascending]); return this; }
  range(a, b) { this.offset = a; this.limitTo = b - a + 1; return this; }
  limit(n) { this.limitTo = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  run() {
    const rows = tables[this.table];
    if (!rows) return { data: this.one ? null : [], error: null };
    if (this.action === 'insert') {
      if (this.table === 'm6_comprehension_attempts') {
        const p = this.payload; // the one-assessment-per-activity and unique-reading rules
        if (rows.some(r => r.user_id === p.user_id && ((r.submission_id === p.submission_id)
          || (p.oral_reading_attempt_id && r.oral_reading_attempt_id === p.oral_reading_attempt_id)
          || (r.module_id === p.module_id && r.passage_id === p.passage_id && (r.room_id ?? null) === (p.room_id ?? null) && (r.assignment_id ?? null) === (p.assignment_id ?? null))))) {
          return { data: null, error: { code: '23505' } };
        }
      }
      const row = { id: randomUUID(), created_at: new Date().toISOString(), completed_at: this.table === 'oral_reading_attempts' ? new Date().toISOString() : null,
        ...(this.table === 'm6_comprehension_attempts' ? { status: 'in_progress' } : {}), ...this.payload };
      rows.push(row);
      return { data: { ...row }, error: null };
    }
    let out = rows.filter(r => this.filters.every(f => f(r)));
    if (this.action === 'update') { out.forEach(r => Object.assign(r, this.payload)); return { data: out.map(r => ({ ...r })), error: null }; }
    for (const [c, asc] of [...(this.ordering ?? [])].reverse()) out = [...out].sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (asc ? 1 : -1));
    if (this.offset) out = out.slice(this.offset);
    if (this.limitTo !== undefined) out = out.slice(0, this.limitTo);
    out = out.map(r => ({ ...r }));
    return this.one ? { data: out[0] ?? null, error: this.one === 'single' && out.length !== 1 ? { message: 'Expected one row' } : null } : { data: out, error: null };
  }
}
// In-memory stand-in for m6_apply_action (answer: first answer final; complete: the proposed completion rule).
function applyAction({ target_attempt, target_user, target_question, action_name, selected_option, request_id }) {
  const attempt = tables.m6_comprehension_attempts.find(a => a.id === target_attempt && a.user_id === target_user);
  if (!attempt) return { data: null, error: { code: 'P0002', message: 'Activity not found' } };
  if (action_name === 'complete') {
    if (attempt.status === 'completed') return { data: { completed: true }, error: null };
    const student = tables.profiles.find(p => p.id === attempt.user_id)?.role === 'student';
    if (student && attempt.room_id == null) {
      const reading = tables.oral_reading_attempts.find(r => r.id === attempt.oral_reading_attempt_id && r.user_id === attempt.user_id
        && r.module_id === attempt.module_id && r.room_id == null && r.material_id == null);
      const classroom = tables.m6_comprehension_attempts.some(c => c.user_id === attempt.user_id && c.id !== attempt.id
        && c.module_id === attempt.module_id && c.passage_id === attempt.passage_id && c.room_id != null);
      if (!reading || classroom) return { data: null, error: { code: '42501', message: 'Student personal practice refused' } };
    }
    // Reverse direction of the proposed rule: a classroom assessment cannot complete after a personal one.
    if (student && attempt.room_id != null && tables.m6_comprehension_attempts.some(c => c.user_id === attempt.user_id && c.id !== attempt.id
      && c.module_id === attempt.module_id && c.passage_id === attempt.passage_id && c.room_id == null && c.material_id == null)) {
      return { data: null, error: { code: '42501', message: 'This passage already has a personal comprehension assessment' } };
    }
    Object.assign(attempt, { status: 'completed', completed_at: new Date().toISOString() });
    return { data: { completed: true }, error: null };
  }
  if (attempt.status === 'completed') return { data: null, error: { code: '22023', message: 'This activity is already completed' } };
  const question = attempt.question_snapshot.find(q => q.id === target_question);
  const correct = question.correctOptionIndex === selected_option;
  tables.m6_comprehension_responses.push({ id: randomUUID(), attempt_id: attempt.id, question_id: target_question, first_option_index: selected_option,
    first_answer_correct: correct, answer_history: [{ requestId: request_id, optionIndex: selected_option }], hint_used: false, resolved: true });
  return { data: { correct, resolved: true }, error: null };
}
const db = {
  from: table => new Query(table),
  rpc: async (name, args) => name === 'm6_apply_action' ? applyAction(args) : { data: null, error: { code: '42883' } },
  storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'none' } }), createSignedUrl: async () => ({ data: null, error: { message: 'none' } }) }) },
};
let who = LONER;
// Services read these when they load: patch first, then load the routes.
const auth = require('../../../server/services/supabaseAdmin');
auth.getSupabaseAdmin = () => db;
auth.getAuthenticatedSupabaseUser = async () => ({ id: who });
const express = require('../../../server/node_modules/express');
const app = express(); app.use(express.json());
app.use('/api/oral-reading', require('../../../server/routes/oralReading').createOralReadingRouter({
  getSupabaseAdmin: () => db, isRoomArchived: async () => false, getAuthenticatedSupabaseUser: async () => ({ id: who }), prefetchProfile: false,
}));
app.use('/api/comprehension', require('../../../server/routes/comprehension'));
const api = app.listen(0, '127.0.0.1'); await new Promise(r => api.once('listening', r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

const root = path.resolve('readflow'), output = path.resolve('.tmp/student-personal-browser'); fs.mkdirSync(output, { recursive: true });
const harness = path.join(root, 'tests/browser/studentPersonalReadingHarness.tsx').replaceAll('\\', '/');
const vite = await createServer({ root, configFile: false, envFile: false, optimizeDeps: { entries: ['tests/browser/studentPersonalReadingHarness.tsx'] }, plugins: [{ name: 'student-personal-fixture', enforce: 'pre', resolveId(name) {
  if (name.endsWith('/lib/supabaseClient')) return path.join(root, 'tests/browser/personalMaterialsAuth.ts').replaceAll('\\', '/');
  if (name.endsWith('/context/M3ContentContext') || name.endsWith('/hooks/useAuthenticatedProfile')) return harness;
}, configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url?.startsWith('/dashboard/')) { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/browser/studentPersonalReadingHarness.tsx"></script></body></html>')); } else next(); }); } }, react()],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:5194') }, server: { host: '127.0.0.1', port: 5194, strictPort: true, proxy: { '/api': apiUrl } } });
await vite.listen();
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=9244', '--user-data-dir=' + path.join(output, 'chrome-profile'), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms)); let target;
for (let i = 0; i < 100; i++) { try { target = await (await fetch('http://127.0.0.1:9244/json/new?about:blank', { method: 'PUT' })).json(); break; } catch { await pause(100); } }
assert.ok(target, 'Chrome started'); const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
let serial = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++serial; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function until(expression) { for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await pause(75); } throw Error('Timeout: ' + expression + ' ' + errors.join(' | ') + ' TEXT: ' + await evaluate('document.body.innerText')); }
const navigate = async suffix => send('Page.navigate', { url: 'http://127.0.0.1:5194' + suffix + (suffix.includes('?') ? '&' : '?') + 'as=' + who });
const text = () => evaluate('document.body.innerText');
const click = async label => evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('Missing control: '+${JSON.stringify(label)});e.click()})()`);
const shot = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
const noHorizontalScroll = () => evaluate('document.documentElement.scrollWidth <= window.innerWidth');
const asJson = async (url, init) => { const r = await fetch(`${apiUrl}${url}`, init); return { status: r.status, body: await r.json() }; };
const save = async (moduleId, passageId, transcript) => {
  const { status, body } = await asJson('/api/oral-reading/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId, passageId, transcript, durationSeconds: 12, submissionId: randomUUID() }) });
  assert.equal(status, 201, JSON.stringify(body));
  return body.attempt;
};
// Reading result -> Continue to Questions -> Start -> answer every question -> results.
async function completeComprehension(readingId, answers, language = 'en') {
  const L = key => language === 'fil' ? (FILIPINO[key] ?? assert.fail('No Filipino label: ' + key)) : key;
  const click = async label => evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(L(label))});if(!e)throw Error('Missing control: '+${JSON.stringify(L(label))});e.click()})()`);
  await navigate(`/dashboard/read-aloud/results/${readingId}`);
  await until(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === ${JSON.stringify(L('Continue to Questions'))})`);
  await click('Continue to Questions');
  await until(`document.querySelector('.m6-card') && document.body.innerText.includes(${JSON.stringify(L('Ready to answer?'))})`);
  await until(`![...document.querySelectorAll('p')].some(e=>e.textContent.includes(${JSON.stringify(L('Checking your questions…').replace('…', ''))}))`);
  await click('Start Comprehension');
  await until(`!!document.querySelector('input[type="radio"]')`);
  for (let i = 0; i < answers.length; i++) {
    await until(`!!document.querySelector('input[type="radio"]:not(:disabled)')`);
    await evaluate(`document.querySelectorAll('input[type="radio"]')[${answers[i]}].click()`);
    await click('Submit answer');
    if (i < answers.length - 1) { await until(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(L('Next Question'))}&&!e.disabled)`); await click('Next Question'); }
  }
  await until(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(L('Finish Assessment'))}&&!e.disabled) || document.body.innerText.includes(${JSON.stringify(L('Your comprehension results'))})`);
  if (await evaluate(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(L('Finish Assessment'))})`)) await click('Finish Assessment');
  await until(`document.body.innerText.includes(${JSON.stringify(L('Your comprehension results'))})`);
}
const PERSONAL_NOTE = 'Personal practice: this reading is saved to your Reading History. It is not part of any classroom.';
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });

  // A. Student without a classroom: Early Start -> Read Aloud -> result -> comprehension -> results.
  who = LONER;
  await navigate(`/dashboard/materials/${EARLY}`); await until(`document.body.innerText.includes('Ben runs fast to the park.')`);
  await pause(400);
  await evaluate(`[...document.querySelectorAll('a')].find(a => a.textContent.includes('Start Read-Aloud')).click()`);
  await until(`document.body.innerText.includes('${PERSONAL_NOTE}')`);
  assert.ok((await text()).includes('He sees a red kite in the sky.'), 'correct passage');
  await shot('A-read-aloud');
  const lonerReading = await save(EARLY, P_EARLY, 'Ben runs fast to the park. He sees a red kite in the sky.');
  assert.deepEqual([lonerReading.userId, lonerReading.roomId, lonerReading.practiceContext], [LONER, null, 'personal']);
  assert.equal(lonerReading.transcript, 'Ben runs fast to the park. He sees a red kite in the sky.', 'saved transcription');
  await navigate(`/dashboard/read-aloud/results/${lonerReading.id}`);
  await until(`document.body.innerText.includes('Personal practice: this reading and its comprehension')`);
  await shot('A-reading-result');
  // Saved transcription reopens from the result page (Read-Aloud Transcript panel).
  await evaluate(`[...document.querySelectorAll('button,a')].find(e => e.textContent.trim().startsWith('Read-Aloud Transcript')).click()`);
  await until(`document.body.innerText.includes('He sees a red kite in the sky.') && !!document.querySelector('dialog[open], [role="dialog"]')`);
  await evaluate(`(document.querySelector('dialog[open] button, [role="dialog"] button'))?.click()`);
  await completeComprehension(lonerReading.id, [0, 1, 0]); // two right, one wrong
  await shot('A-comprehension-results');
  const lonerQuiz = tables.m6_comprehension_attempts.find(a => a.user_id === LONER);
  assert.deepEqual([lonerQuiz.status, lonerQuiz.room_id ?? null, lonerQuiz.assignment_id ?? null, lonerQuiz.oral_reading_attempt_id], ['completed', null, null, lonerReading.id]);
  assert.equal(tables.m6_comprehension_responses.filter(r => r.attempt_id === lonerQuiz.id).length, 3);
  assert.equal(tables.m6_comprehension_responses.filter(r => r.attempt_id === lonerQuiz.id && r.first_answer_correct).length, 2);
  // Reopen: the reading result offers the saved comprehension result, read-only.
  await navigate(`/dashboard/read-aloud/results/${lonerReading.id}`);
  await until(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'View Comprehension Result')`);
  await click('View Comprehension Result');
  await until(`document.body.innerText.includes('Your comprehension results')`);
  assert.equal(await evaluate(`!!document.querySelector('input[type="radio"]:not(:disabled)')`), false, 'completed results are read-only');
  // No second completed attempt: a new reading and a new start reopen the same completed assessment.
  const again = await save(EARLY, P_EARLY, 'Ben runs fast to the park. He sees a red kite in the sky.');
  const restart = await asJson('/api/comprehension/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: again.id, submissionId: randomUUID() }) });
  assert.equal(restart.body.attempt?.id ?? restart.body.id, lonerQuiz.id, JSON.stringify(restart.body).slice(0, 200));
  assert.equal(tables.m6_comprehension_attempts.filter(a => a.user_id === LONER).length, 1);
  const answerAgain = await asJson(`/api/comprehension/attempts/${lonerQuiz.id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'answer', questionId: lonerQuiz.question_snapshot[0].id, optionIndex: 0, requestId: randomUUID() }) });
  assert.ok(answerAgain.status >= 400, 'a completed assessment cannot be answered again');
  // Reading History shows the personal reading.
  await navigate('/dashboard/reading-history'); await until(`document.body.innerText.includes('Personal practice')`);
  await shot('A-history');

  // Reverse direction: Early Start is now assigned in a classroom the Student joins. The classroom reading saves as
  // classroom work, but its comprehension does not start: the passage was already assessed as personal practice.
  const ASSIGN_EARLY = '00000000-0000-4000-8000-0000000000a2';
  tables.enrollments.push({ id: 'e2', student_id: LONER, room_id: ROOM });
  tables.room_modules.push({ id: ASSIGN_EARLY, room_id: ROOM, module_id: EARLY, removed_at: null });
  const classroomEarly = await save(EARLY, P_EARLY, EARLY_TEXT);
  assert.deepEqual([classroomEarly.roomId, classroomEarly.assignmentId, classroomEarly.practiceContext], [ROOM, ASSIGN_EARLY, 'classroom']);
  await navigate(`/dashboard/read-aloud/results/${classroomEarly.id}`);
  await until(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Continue to Questions')`);
  await click('Continue to Questions');
  await until(`document.querySelector('.m6-card') && document.body.innerText.includes('Ready to answer?')`);
  await until(`![...document.querySelectorAll('p')].some(e=>e.textContent.includes('Checking your questions'))`);
  await click('Start Comprehension');
  await until(`document.body.innerText.includes('You already have a personal comprehension assessment for this passage. Open it from your Reading History.')`);
  await shot('reverse-refused');
  assert.equal(tables.m6_comprehension_attempts.filter(a => a.user_id === LONER).length, 1, 'no classroom assessment created');
  assert.equal(tables.m6_comprehension_attempts.find(a => a.user_id === LONER).room_id ?? null, null, 'the personal result is not converted');
  tables.enrollments.splice(tables.enrollments.findIndex(e => e.id === 'e2'), 1);
  tables.room_modules.splice(tables.room_modules.findIndex(r => r.id === ASSIGN_EARLY), 1);

  // C. Another Student cannot open the first Student's reading or assessment.
  who = OTHER;
  assert.ok([403, 404].includes((await asJson(`/api/oral-reading/attempts/${lonerReading.id}`)).status));
  assert.ok([403, 404].includes((await asJson(`/api/comprehension/attempts/${lonerQuiz.id}`)).status));
  const other = await asJson('/api/comprehension/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: EARLY, passageId: P_EARLY, oralReadingAttemptId: lonerReading.id, submissionId: randomUUID() }) });
  assert.ok(other.status >= 400, 'another Student cannot reuse the reading');

  // B. Enrolled Student: unassigned Early Start is personal (reading + comprehension); assigned English is classroom.
  who = ENROLLED;
  const enrolledPersonal = await save(EARLY, P_EARLY, 'Ben runs fast to the park. He sees a red kite in the sky.');
  assert.equal(enrolledPersonal.roomId, null);
  await completeComprehension(enrolledPersonal.id, [0, 0, 0]);
  const enrolledPersonalQuiz = tables.m6_comprehension_attempts.find(a => a.user_id === ENROLLED && a.module_id === EARLY);
  assert.deepEqual([enrolledPersonalQuiz.status, enrolledPersonalQuiz.room_id ?? null], ['completed', null]);
  const classroomReading = await save(ENGLISH, P_ENGLISH, 'Ana reads a book. She shares the book with her friend.');
  assert.deepEqual([classroomReading.roomId, classroomReading.assignmentId, classroomReading.practiceContext], [ROOM, ASSIGNMENT, 'classroom']);
  await navigate(`/dashboard/read-aloud/results/${classroomReading.id}`);
  await until(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Continue to Questions')`);
  assert.ok(!(await text()).includes('Personal practice'), 'a classroom reading is not labelled personal');
  await completeComprehension(classroomReading.id, [0, 0, 1]);
  const classroomQuiz = tables.m6_comprehension_attempts.find(a => a.user_id === ENROLLED && a.module_id === ENGLISH);
  assert.deepEqual([classroomQuiz.status, classroomQuiz.room_id, classroomQuiz.assignment_id], ['completed', ROOM, ASSIGNMENT]);
  // Switching context: after leaving the classroom, English is no longer assigned, yet no personal assessment opens.
  tables.enrollments.length = 0;
  const afterLeaving = await save(ENGLISH, P_ENGLISH, 'Ana reads a book. She shares the book with her friend.');
  assert.equal(afterLeaving.roomId, null);
  const bypass = await asJson('/api/comprehension/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId: ENGLISH, passageId: P_ENGLISH, oralReadingAttemptId: afterLeaving.id, submissionId: randomUUID() }) });
  assert.equal(bypass.status, 409, JSON.stringify(bypass.body));
  assert.equal(tables.m6_comprehension_attempts.filter(a => a.user_id === ENROLLED && a.module_id === ENGLISH).length, 1);
  tables.enrollments.push({ id: 'e1', student_id: ENROLLED, room_id: ROOM });

  // Filipino module, Student without a classroom: the same flow, in Filipino, saved with language 'fil'.
  who = FIL_LONER;
  await navigate(`/dashboard/materials/${FIL}/read-aloud?passageId=${P_FIL}`);
  await until(`document.body.innerText.includes(${JSON.stringify(FILIPINO[PERSONAL_NOTE])})`);
  assert.ok((await text()).includes('Ibinigay niya ito sa kanyang lola.'), 'Filipino passage');
  await shot('FIL-read-aloud');
  const filReading = await save(FIL, P_FIL, FIL_TEXT);
  assert.deepEqual([filReading.userId, filReading.roomId, filReading.language, filReading.practiceContext], [FIL_LONER, null, 'fil', 'personal']);
  await navigate(`/dashboard/read-aloud/results/${filReading.id}`);
  await until(`document.body.innerText.includes(${JSON.stringify(FILIPINO['Personal practice: this reading and its comprehension are saved to your history. They are not part of any classroom.'])})`);
  await shot('FIL-reading-result');
  await completeComprehension(filReading.id, [0, 0, 0], 'fil');
  await shot('FIL-comprehension-results');
  const filQuiz = tables.m6_comprehension_attempts.find(a => a.user_id === FIL_LONER);
  assert.deepEqual([filQuiz.status, filQuiz.room_id ?? null, filQuiz.language], ['completed', null, 'fil']);

  // Mobile layouts: no horizontal scroll on the personal reading, result and comprehension result pages.
  who = LONER;
  for (const [width, height] of [[820, 1180], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    for (const [page, marker] of [[`/dashboard/materials/${EARLY}/read-aloud?passageId=${P_EARLY}`, 'Personal practice'],
      [`/dashboard/read-aloud/results/${lonerReading.id}`, 'Personal practice'], [`/dashboard/comprehension/${lonerQuiz.id}/results`, 'Your comprehension results']]) {
      await navigate(page); await until(`document.body.innerText.includes('${marker}')`);
      assert.equal(await noHorizontalScroll(), true, `no horizontal scroll at ${width}: ${page}`);
    }
    await shot(`mobile-${width}`);
  }
  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log('PASS browser: Student personal reading + comprehension without a classroom (saved transcript, results, read-only reopen, no second attempt), enrolled Student personal vs classroom, context-switch bypass refused both ways, other Student refused, Filipino module in Filipino, mobile layout');
} finally {
  ws.close(); chrome.kill(); await vite.close(); api.close();
}
