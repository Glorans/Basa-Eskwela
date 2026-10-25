// Run after npm run build: node tests/browser/responsiveOverflow.mjs
// CSS layout fixtures, not authenticated end-to-end coverage. No API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const assets = new URL('../../dist/assets/', import.meta.url);
const css = fs.readdirSync(assets).filter(name => name.endsWith('.css'))
  .map(name => fs.readFileSync(new URL(name, assets), 'utf8')).join('\n');
assert.ok(css.includes('.m5-review-filters'), 'Build production CSS first');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'basa-overflow-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
let startupError;
chrome.on('error', error => { startupError = error; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile) && !startupError; i++) await pause(100);
  if (startupError) throw startupError;
  assert.ok(fs.existsSync(portFile), 'Chrome must start');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const long = 'LongPassageOrClassroomName'.repeat(10);
  const filters = `<div class="m5-review-filters"><label class="m5-review-search">Search<input placeholder="Search learner or module"></label>${['Student', 'Module', 'Comprehension'].map(label => `<label>${label}<select><option>${long}</option></select></label>`).join('')}<button class="m5-review-clear">Clear Filters</button></div>`;
  const table = `<div class="m5-review-table-scroll"><table class="m5-review-table"><thead><tr>${Array.from({ length: 8 }, () => '<th>Reading result</th>').join('')}</tr></thead><tbody>${Array.from({ length: 12 }, () => `<tr>${Array.from({ length: 8 }, () => '<td>Saved assessment</td>').join('')}</tr>`).join('')}</tbody></table></div>`;
  const content = `<div class="m3-page-stack m5-teacher-page"><header class="m3-page-header"><div><h1>Reading Results</h1><p>${long}</p></div><div class="m3-page-actions"><button class="m3-button">Refresh</button></div></header><section class="m5-review-list-card">${filters}${table}</section><section class="m3-panel"><div class="m3-toolbar"><label class="m3-search-field"><input placeholder="Search"></label><div class="m3-filter-group"><label>Module<select><option>${long}</option></select></label><button class="m3-button">Apply filters</button></div></div><div class="grid gap-5 md:grid-cols-2"><div class="flex gap-4"><span>Room</span><div><h2>${long}</h2><p>Grade and section</p></div></div><div class="basa-settings-columns"><label>Email<input value="student@example.invalid"></label><p>${long}</p></div></div><div class="m7-metrics"><article class="m7-card">${long}</article></div><audio controls></audio></section></div>`;
  let checks = 0;
  for (const role of ['admin', 'teacher', 'student', 'general']) {
    for (const width of [320, 390, 768, 820, 1024, 1366, 1920]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
      const student = role === 'student';
      const shell = student ? 'basa-page' : `m3-shell m3-shell--${role}`;
      const main = student ? 'basa-content' : 'm3-content';
      const html = `<style>${css}</style><div class="${shell}"><aside class="${student ? 'basa-sidebar' : 'm3-sidebar'}">Basa Eskwela<nav><a class="m3-nav-item">Reading Results</a></nav></aside><div class="${student ? 'basa-main-shell' : 'm3-workspace'}"><header class="${student ? 'basa-header' : 'm3-topbar'}">Basa Eskwela</header><main class="${main}">${content}</main></div></div>`;
      const { frameTree } = await send('Page.getFrameTree');
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
      const result = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const main = document.querySelector('.${main}');
        const table = document.querySelector('.m5-review-table-scroll');
        table.scrollLeft = table.scrollWidth;
        const bounds = main.getBoundingClientRect();
        const controlsFit = [...main.querySelectorAll('input, select, button, audio')].every(el => {
          const rect = el.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        });
        const overflow = [...document.querySelectorAll('main, .m3-page-stack, .m5-review-filters, .m3-panel, .m3-toolbar, .m3-filter-group, input, select')].filter(el => el.scrollWidth > el.clientWidth + 1 && !['INPUT','SELECT'].includes(el.tagName)).map(el => el.className);
        return { overflow, controlsFit, tableReachable: table.scrollWidth <= table.clientWidth || table.scrollLeft > 0, page: document.documentElement.scrollWidth <= innerWidth, vertical: main.scrollHeight > main.clientHeight, table: getComputedStyle(table).overflowX, scrollbar: getComputedStyle(main, '::-webkit-scrollbar').width };
      })()` });
      assert.deepEqual(result.result.value.overflow, [], `${role} ${width}: overflow`);
      assert.equal(result.result.value.page, true, `${role} ${width}: document`);
      assert.equal(result.result.value.controlsFit, true, `${role} ${width}: controls stay accessible`);
      assert.equal(result.result.value.tableReachable, true, `${role} ${width}: last table column reachable`);
      assert.equal(result.result.value.vertical, true, `${role} ${width}: vertical scroll retained`);
      assert.equal(result.result.value.table, 'auto');
      assert.equal(result.result.value.scrollbar, '14px');
      await send('Runtime.evaluate', { expression: `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify('<div class="m5-modal-backdrop"><div class="m5-modal"><header class="m5-modal-header"><h2>Feedback & Practice</h2><button class="m5-modal-close">X</button></header><div class="m5-modal-body"><p>' + long + '</p><audio controls></audio>' + '<p>Saved assessment feedback with a complete recording.</p>'.repeat(40) + '</div></div></div>')})` });
      const modal = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const body = document.querySelector('.m5-modal-body');
        const audio = body.querySelector('audio').getBoundingClientRect();
        const bounds = body.getBoundingClientRect();
        return body.scrollWidth <= body.clientWidth + 1 && body.scrollHeight > body.clientHeight && audio.right <= bounds.right && bounds.right <= innerWidth;
      })()` });
      assert.equal(modal.result.value, true, `${role} ${width}: modal fits and scrolls vertically`);
      if (role === 'teacher' || role === 'admin') {
        const adult = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          document.querySelector('.m5-modal-backdrop').remove();
          const main = document.querySelector('.${main}');
          if ('${role}' === 'teacher') {
            main.firstElementChild.classList.add('m5-teacher-results');
            const headers = ['Learner', 'Module', 'Transcript-based Accuracy', 'Recognized / Legacy Passage WPM', 'Recognized-word Differences', 'Comprehension', 'Date Completed', 'Action'];
            document.querySelectorAll('.m5-review-table th').forEach((th, i) => th.textContent = headers[i]);
          } else {
            main.innerHTML = '<div class="admin-users-page"><header class="admin-users-header"><h1>Diagnostic Results</h1></header><section class="admin-users-table-wrap"><div class="admin-users-controls"><label class="admin-users-control">Learner<input></label></div><div class="admin-users-table-scroll"><table class="admin-users-table admin-diagnostic-results-table"><thead><tr>' + ['Learner Name','Email','Account Type','Language','ORV Score','Comprehension','WPM','Reading Level','Difficulty','Date Completed'].map(s => '<th>'+s+'</th>').join('') + '</tr></thead><tbody>' + ('<tr>' + '<td>Saved diagnostic result</td>'.repeat(10) + '</tr>').repeat(30) + '</tbody></table></div></section></div>';
          }
          const wrapper = main.querySelector('.admin-users-table-scroll, .m5-review-table-scroll');
          return { pageFits: main.scrollWidth <= main.clientWidth + 1,
            noNestedVertical: wrapper.scrollHeight <= wrapper.clientHeight + 1,
            desktopFits: '${role}' !== 'teacher' || innerWidth < 1366 || wrapper.scrollWidth <= wrapper.clientWidth + 1 };
        })()` });
        assert.deepEqual(adult.result.value, { pageFits: true, noNestedVertical: true, desktopFits: true }, `${role} ${width}: compact adult table`);
      }
      checks++;
    }
  }
  console.log(`PASS: ${checks} role/viewport CSS fixtures; page/content fit, local table scrolling, vertical scrolling and yellow scrollbar sizing retained.`);
  await send('Browser.close');
} finally {
  ws?.close();
  chrome.kill();
}
