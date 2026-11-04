// Run after npm run build: node tests/browser/adultTableLayout.mjs
// Teacher/Admin data tables measured in headless Chrome with the built CSS and
// markup copied from the real pages. CSS fixtures only: no login, no API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const assets = path.join(root, 'dist', 'assets');
const css = fs.readdirSync(assets).filter(n => n.endsWith('.css')).map(n => fs.readFileSync(path.join(assets, n), 'utf8')).join('\n');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'basa-measure-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms));

const rows = (n, cells) => Array.from({ length: n }, (_, i) => `<tr>${cells(i).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
const names = ['Maria Clara Dela Cruz', 'Juan Miguel Santos', 'Angelica Ramos', 'Jose Rizal Bautista Jr.'];
const comp = `<div class="m5-review-comprehension"><span class="m3-status-badge m3-status-badge--published">Completed</span><span>4 of 5 correct on first try (80%)</span><small>1 hint · Phil-IRI comprehension: Instructional</small></div>`;
const teacherResults = `<div class="m3-page-stack m5-teacher-page m5-teacher-results">
<header class="m3-page-header"><div><h1>Reading Results</h1><p class="m3-page-description">Review read-aloud and comprehension results from students enrolled in your classrooms.</p></div><div class="m3-page-actions"><button class="m3-button m3-button--secondary">Refresh</button></div></header>
<section class="m5-review-list-card"><div class="m5-review-filters"><label class="m5-review-search"><span>Search learner or module</span><span class="m5-review-search-input"><input type="search" placeholder="Search learner or module"></span></label><label><span>Student</span><select><option>All Students</option></select></label><label><span>Module</span><select><option>All Modules</option></select></label><label><span>Comprehension</span><select><option>All</option></select></label><button class="m5-review-clear">Clear Filters</button></div>
<p class="m5-review-count">Showing 30 of 30 results</p>
<div class="m5-review-table-scroll"><table class="m5-review-table"><colgroup><col style="width:12%"><col style="width:14%"><col style="width:12%"><col style="width:14%"><col style="width:13%"><col style="width:15%"><col style="width:12%"><col style="width:8%"></colgroup>
<thead><tr><th>Learner</th><th>Module</th><th>Transcript-based Accuracy</th><th>Recognized / Legacy Passage WPM</th><th>Recognized-word Differences</th><th>Comprehension</th><th>Date Completed</th><th><span class="m3-visually-hidden">Action</span></th></tr></thead>
<tbody>${rows(30, i => [names[i % 4], 'Grade 3 English Stories<small> - A Helping Hand</small>', '93%', '112', '5', comp, 'Oct 25, 2026, 8:04 AM', '<a class="m5-review-view" href="#">View</a>'])}</tbody></table></div></section></div>`;

const adminControls = (labels) => `<div class="admin-users-controls"><button class="admin-users-clear">Pending Teachers</button>${labels.map(l => `<label class="admin-users-control"><span>${l}</span><select><option>All</option></select></label>`).join('')}</div><p class="admin-users-result-count">Showing 40 of 40</p>`;
const adminUsers = `<section class="admin-users-page"><header class="admin-users-header"><div><h1>User Management</h1></div><button>Refresh</button></header><div class="admin-users-table-wrap">${adminControls(['Search users', 'Role', 'Status'])}<div class="admin-users-table-scroll"><table class="admin-users-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Registered</th><th>Teacher Verification</th><th>Actions</th></tr></thead><tbody>${rows(40, i => [names[i % 4], 'maria.clara.delacruz.teacher@deped-school.example.edu.ph', '<span class="admin-users-role-readonly">Independent Learner</span>', 'active', '10/24/2026', 'approved', '<a href="#">Review in Teacher Invitations</a><button class="admin-users-delete">Delete</button>'])}</tbody></table></div></div></section>`;
const adminDiagnostic = `<section class="admin-users-page"><header class="admin-users-header"><div><h1>Diagnostic Results</h1></div><button>Refresh</button></header><div class="admin-users-table-wrap">${adminControls(['Learner', 'Language', 'Reading Level'])}<div class="admin-users-table-scroll"><table class="admin-users-table admin-diagnostic-results-table"><thead><tr>${['Learner Name', 'Email', 'Account Type', 'Language', 'ORV Score', 'Comprehension', 'WPM', 'Reading Level', 'Difficulty', 'Date Completed'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows(40, i => [names[i % 4], 'juan.santos@example.edu.ph', 'Independent Learner', 'Filipino', '87.5', '80.0', '96', 'Instructional', 'Medium', 'Oct 24, 2026, 10:32 PM'])}</tbody></table></div></div></section>`;
const invitations = `<div class="m3-page-stack"><header class="m3-page-header"><div><h1>Teacher Invitations</h1></div></header><section class="m3-panel"><div class="teacher-invitations-table"><table><thead><tr><th>Invitation ID</th><th>Created</th><th>Expires</th><th>Uses</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows(15, () => ['3f9a1c2e-7b4d-4e2a-9c1f-8d6e5b4a3c21', 'Oct 24, 2026, 10:32 PM', 'Oct 31, 2026, 10:32 PM', '0 / 1', 'Active', '<button>Revoke</button>'])}</tbody></table></div></section></div>`;
const m7 = `<main class="m7-page m7-dashboard"><header class="m7-dashboard-header m7-header-card"><div><h1>System Analytics</h1><p>Review learner progress.</p></div></header>
<section><h2>Trends</h2><div class="m7-scroll"><table><thead><tr>${['Week starting', 'Readings', 'Reading accuracy', 'Speed (WPM)', 'Quizzes', 'Comprehension'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows(8, () => ['Oct 19, 2026', '42', '88%', '96', '30', '79%'])}</tbody></table></div></section>
<section><h2>Classrooms</h2><div class="m7-scroll"><table><thead><tr>${['Classroom / teacher', 'Participating / enrolled', 'Readings', 'Reading accuracy', 'Speed (WPM)', 'Quizzes', 'Comprehension', 'Completed / assigned'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows(8, () => ['Grade 3 - Sampaguita (Ms. Maria Clara Dela Cruz)', '24 / 30', '120', '86%', '92', '80', '77%', '96 / 120'])}</tbody></table></div></section>
<section><h2>Students needing support</h2><div class="m7-scroll"><table><thead><tr>${['Student', 'Current classification', 'Teacher context and recent scores', 'Interventions'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows(6, () => ['Jose Rizal Bautista Jr.', 'Needs support (reading accuracy below 70%)', 'Ms. Dela Cruz · Grade 3 - Sampaguita · Accuracy 64%, 58%, 61%', 'Small-group guided reading twice weekly'])}</tbody></table></div></section></main>`;

const pages = [
  ['teacher', 'Teacher Reading Results', teacherResults],
  ['teacher', 'Teacher Analytics (M7)', m7],
  ['admin', 'Admin User Management', adminUsers],
  ['admin', 'Admin Diagnostic Results', adminDiagnostic],
  ['admin', 'Admin Teacher Invitations', invitations],
  ['admin', 'Admin Analytics (M7)', m7],
];

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (!m.id) return; const t = pending.get(m.id); pending.delete(m.id); m.error ? t.reject(Error(JSON.stringify(m.error))) : t.resolve(m.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  let checks = 0;
  for (const [role, label, content] of pages) {
    for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const shell = role === 'admin' ? 'm3-shell m3-shell--admin' : 'm3-shell';
      const html = `<!doctype html><html><head><style>${css}</style></head><body><div class="${shell}"><aside class="m3-sidebar"><div class="m3-sidebar-brand">Basa Eskwela</div><nav class="m3-sidebar-nav"><a class="m3-nav-item">Reading Results</a></nav></aside><div class="m3-workspace"><header class="m3-topbar">Basa Eskwela</header><main class="m3-content">${content}</main></div></div></body></html>`;
      const { frameTree } = await send('Page.getFrameTree');
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
      await pause(50);
      const { result } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const scrolls = [];
        for (const el of document.querySelectorAll('body *:not(.m3-visually-hidden)')) {
          const s = getComputedStyle(el);
          const x = ['auto','scroll'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
          const y = ['auto','scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
          const clippedX = ['hidden','clip'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
          if (x || y || clippedX) scrolls.push((el.className || el.tagName).toString().split(' ')[0] + ':' + (x ? 'X' : '') + (y ? 'Y' : '') + (clippedX ? 'CLIPPED' : ''));
        }
        const lines = (th) => { const r = document.createRange(); r.selectNodeContents(th); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; };
        const wrapped = [...document.querySelectorAll('th')].filter(th => th.textContent.trim() && !th.querySelector('.m3-visually-hidden') && lines(th) > 1).map(th => th.textContent.trim() + '×' + lines(th));
        // A single word split across lines (headings with spaces, hyphens or slashes may wrap there).
        const brokenWords = [...document.querySelectorAll('th')].filter(th => th.textContent.trim()
          && !th.querySelector('.m3-visually-hidden') && !/[\\s\\-\\/]/.test(th.textContent.trim()) && lines(th) > 1).map(th => th.textContent.trim());
        const tableScrollers = '.m5-review-table-scroll, .admin-users-table-scroll, .m7-scroll, .teacher-invitations-table';
        const sideways = scrolls.filter(entry => entry.includes('X') && !/^(m5-review-table-scroll|admin-users-table-scroll|m7-scroll|teacher-invitations-table):/.test(entry));
        const vertical = scrolls.filter(entry => entry.includes('Y'));
        const lastColumns = [...document.querySelectorAll(tableScrollers)].every(box => {
          box.scrollLeft = box.scrollWidth;
          const last = box.querySelector('tr > :last-child');
          return !last || last.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1;
        });
        const maxHeaderLines = Math.max(0, ...[...document.querySelectorAll('th')].filter(th => !th.querySelector('.m3-visually-hidden')).map(lines));
        const main = document.querySelector('.m3-content');
        const content = main.firstElementChild.getBoundingClientRect();
        return { page: document.documentElement.scrollWidth > innerWidth ? 'PAGE-X' : 'ok', scrolls, wrapped, brokenWords, sideways, vertical, lastColumns, maxHeaderLines,
          contentWidth: Math.round(content.width), mainWidth: Math.round(main.clientWidth),
          pad: getComputedStyle(main).paddingLeft };
      })()` });
      const v = result.value;
      const at = `${label} ${width}x${height}`;
      assert.equal(v.page, 'ok', `${at}: no page-level horizontal scrollbar`);
      assert.deepEqual(v.sideways, [], `${at}: horizontal scrolling only inside a table container`);
      assert.ok(v.vertical.every(entry => entry.startsWith('m3-content:')), `${at}: one main vertical scrollbar (${v.vertical})`);
      assert.deepEqual(v.brokenWords, [], `${at}: no heading split inside a word`);
      assert.equal(v.lastColumns, true, `${at}: last column reachable`);
      assert.ok(!v.scrolls.some(entry => entry.includes('CLIPPED')), `${at}: nothing clipped (${v.scrolls})`);
      if (label === 'Teacher Reading Results' && width >= 1366) assert.ok(v.maxHeaderLines <= 2, `${at}: headings fit in two lines`);
      if (label === 'Teacher Reading Results' && width >= 1280) assert.ok(v.maxHeaderLines <= 3, `${at}: headings fit in three lines`);
      if (width >= 1366) assert.ok(!v.sideways.length && !v.scrolls.some(entry => entry.endsWith(':X')), `${at}: fits the desktop width`);
      checks++;
    }
  }
  // Independent Learner keeps its child-friendly shell: the adult table rules do not apply.
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  const { frameTree } = await send('Page.getFrameTree');
  await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: `<!doctype html><html><head><style>${css}</style></head><body>
    <div class="m3-shell m3-shell--general"><div class="m3-workspace"><main class="m3-content"><div class="m7-page"><div class="m7-scroll"><table><tr><th>Readings</th></tr></table></div></div></main></div></div>
    <div class="result-panel-cards"><button class="result-panel-card result-panel-card--result">a</button><button class="result-panel-card result-panel-card--feedback"><svg></svg><span class="result-panel-card-title">Feedback</span><span class="result-panel-card-text">t</span></button><button class="result-panel-card result-panel-card--transcript">c</button></div></body></html>` });
  const learner = (await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const th = document.querySelector('th'), page = document.querySelector('.m7-page'), box = document.querySelector('.m7-scroll');
    const card = (name) => getComputedStyle(document.querySelector('.result-panel-card--' + name));
    const feedback = document.querySelector('.result-panel-card--feedback');
    return { wrap: getComputedStyle(th).overflowWrap, position: getComputedStyle(box).position, pagePadding: getComputedStyle(page).paddingLeft,
      pageMax: getComputedStyle(page).maxWidth, cards: ['result', 'feedback', 'transcript'].map(name => card(name).backgroundColor),
      feedbackText: [card('feedback').color, getComputedStyle(feedback.querySelector('.result-panel-card-text')).color],
      radius: card('feedback').borderRadius === card('result').borderRadius, height: card('feedback').minHeight };
  })()` })).result.value;
  assert.equal(learner.wrap, 'anywhere', 'Independent Learner tables keep their existing wrapping');
  assert.equal(learner.position, 'static');
  assert.equal(learner.pageMax, '1200px', 'Independent Learner M7 page keeps its measure');
  assert.notEqual(learner.pagePadding, '0px');
  // Result yellow, Transcript green, Pronunciation Feedback pastel blue with dark teal text.
  assert.deepEqual(learner.cards, ['rgb(255, 226, 154)', 'rgb(181, 217, 239)', 'rgb(185, 223, 158)']);
  assert.deepEqual(learner.feedbackText, ['rgb(11, 58, 61)', 'rgb(11, 58, 61)']);
  assert.equal(learner.radius, true);
  assert.equal(learner.height, '150px');
  console.log(`PASS: ${checks} Teacher/Admin page/viewport fixtures (one vertical scrollbar, tables scroll only inside their container, no split words, last columns reachable); Independent Learner and M5 card colors unchanged.`);
  await send('Browser.close');
  ws.close();
} finally {
  chrome.kill();
}
