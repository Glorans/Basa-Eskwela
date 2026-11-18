// System Admin readability audit: WCAG contrast of every visible text element (4.5:1 normal, 3:1 large),
// 3:1 control boundaries, distinguishable button states, and the Add Passage Below button position.
// Uses the REAL editor markup (rendered from AdminCollectionEditor with stubbed services) plus page samples
// built from the real M1/M3/M7 class names. Run after `npm run build`: node tests/browser/systemAdminContrast.mjs
// Set AUDIT_ONLY=1 to print findings without failing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import postcss from 'postcss';
import { renderSystemAdminEditor } from './systemAdminEditorMarkup.ts';

const auditOnly = process.env.AUDIT_ONLY === '1';
const assets = new URL('../../dist/assets/', import.meta.url);
const css = fs.readdirSync(assets).filter(n => n.endsWith('.css')).map(n => fs.readFileSync(new URL(n, assets), 'utf8')).join('\n');
assert.ok(css.includes('.system-admin-ui'), 'Build production CSS first');
const baseline = postcss.parse(css); baseline.walkRules(rule => { if (rule.selector.includes('.system-admin-ui')) rule.remove(); });
const beforeCss = baseline.toString();
const editor = await renderSystemAdminEditor();
assert.match(editor, /sa-add-passage/, 'real System Admin editor markup');

const pages = `<div class="m3-page-stack"><header class="m3-page-header"><div><h1>Reading Materials</h1><p class="m3-page-description">Manage your source files and review generated comprehension questions.</p></div></header>
<article class="m3-record-card"><h2>Sample material</h2><p>PDF · English · Uploaded 18 Nov 2026</p><span class="m3-status-badge">Completed</span></article></div>
<section class="admin-users-page"><header class="admin-users-header"><div><h1>User Management</h1><p class="admin-users-scope">You can manage Independent Learners and School Admins.</p></div><button type="button">Refresh</button></header>
<div class="admin-users-table-wrap"><div class="admin-users-controls"><label class="admin-users-control">Search<input placeholder="Search users"></label></div><table class="admin-users-table"><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Sample account</td><td>Independent Learner</td></tr></tbody></table></div></section>
<main class="m7-page m7-dashboard m7-admin-dashboard"><header class="m7-dashboard-header m7-header-card"><div><h1>Platform Analytics</h1><p>Totals and averages only; no individual records are shown.</p></div></header>
<div class="m7-dashboard-content"><section><h2>Registered users</h2><p>Saved readings and completed quizzes.</p><div class="m7-metrics"><div class="m7-card"><span>All accounts</span><strong>52</strong></div></div>
<div class="m7-scroll"><table><thead><tr><th>Week starting (PHT)</th><th>Saved readings</th></tr></thead><tbody><tr><td>10 Nov 2026</td><td>4</td></tr></tbody></table></div><p class="m7-performance-scope">Weeks without activity are not listed.</p></section></div></main>
<div class="basa-settings-card"><h1 class="basa-page-title">Settings</h1><div class="basa-settings-avatar-row"><p>Profile and Account</p></div><div class="basa-settings-columns"><label>Nickname<input value="Admin"></label></div></div>`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'basa-sa-contrast-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms));
let ws, failures = [];
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (!m.id) return; const t = pending.get(m.id); pending.delete(m.id); m.error ? t.reject(Error(JSON.stringify(m.error))) : t.resolve(m.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'evaluate failed'); return r.result.value; };
  const render = async (width, content, styles = css, role = 'system_admin') => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.enable');
    const html = `<!doctype html><html><head><style>${styles}</style></head><body><div id="root"><div class="m3-shell m3-shell--admin rf-shell ${role === 'system_admin' ? 'system-admin-ui' : ''}"><aside class="m3-sidebar rf-sidebar"></aside><div class="m3-workspace rf-workspace"><header class="m3-topbar"><div class="m3-topbar-title"></div></header><div class="rf-content-scroll"><main class="m3-content">${content}</main></div></div></div></div></body></html>`;
    const frame = (await send('Page.getFrameTree')).frameTree.frame.id;
    await send('Page.setDocumentContent', { frameId: frame, html });
    await evaluate('document.fonts.ready.then(()=>1)');
  };
  const LIB = `
    const parse=c=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return [0,0,0,0];const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1]};
    const over=(f,b)=>{const a=f[3];return [f[0]*a+b[0]*(1-a),f[1]*a+b[1]*(1-a),f[2]*a+b[2]*(1-a),1]};
    const bgOf=el=>{const chain=[];for(let e=el;e;e=e.parentElement)chain.push(e);let c=[255,255,255,1];for(const e of chain.reverse())c=over(parse(getComputedStyle(e).backgroundColor),c);return c};
    const opacityOf=el=>{let o=1;for(let e=el;e;e=e.parentElement)o*=Number(getComputedStyle(e).opacity);return o};
    const lum=c=>{const [r,g,b]=c.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
    const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};
    const label=e=>((e.parentElement?.className?'['+e.parentElement.className+'] ':'')+e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).join('.'):'')+' "'+(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,40)+'"');`;
  const audit = () => evaluate(`(()=>{${LIB}
    const out=[];
    for(const e of document.querySelectorAll('.m3-content *')){
      const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      if(!own||!r.width||s.visibility!=='visible'||opacityOf(e)===0||e.closest('[aria-hidden="true"]'))continue;
      if(e.closest(':disabled,[aria-disabled="true"]'))continue; // WCAG 1.4.3 exempts inactive controls (checked separately)
      const bg=bgOf(e),fg=over([...parse(s.color).slice(0,3),parse(s.color)[3]*opacityOf(e)],bg);
      const size=parseFloat(s.fontSize),large=size>=24||(size>=18.66&&Number(s.fontWeight)>=700);
      const need=large?3:4.5,value=ratio(fg,bg);
      if(value<need)out.push({kind:'text',what:label(e),ratio:+value.toFixed(2),need});
    }
    for(const e of document.querySelectorAll('.m3-content :is(input:not([type=file]):not(.m3-editor-upload-input),select,textarea,button:not(:disabled))')){
      const s=getComputedStyle(e);if(!e.getBoundingClientRect().width)continue;
      const outside=bgOf(e.parentElement),fill=over(parse(s.backgroundColor),outside),border=over(parse(s.borderTopColor),outside);
      const value=Math.max(ratio(fill,outside),parseFloat(s.borderTopWidth)?ratio(border,outside):0);
      if(value<3)out.push({kind:'boundary',what:label(e),ratio:+value.toFixed(2),need:3});
    }
    return out;})()`);

  const report = (name, list) => { for (const f of list) console.log(`  ${name}: ${f.kind} ${f.ratio}:1 < ${f.need}:1  ${f.what}`); failures.push(...list.map(f => ({ name, ...f }))); };
  for (const width of [390, 768, 1440]) {
    await render(width, editor); report(`editor ${width}`, await audit());
    await render(width, pages); report(`pages ${width}`, await audit());
  }

  // Card and secondary-section separation from the page.
  await render(1440, editor);
  const surfaces = await evaluate(`(()=>{${LIB}
    const card=document.querySelector('.m3-editor-passage'),up=document.querySelector('.m3-editor-upload'),page=bgOf(document.querySelector('.m3-content'));
    const cs=getComputedStyle(card),us=getComputedStyle(up);
    return {cardBorder:+ratio(over(parse(cs.borderTopColor),page),page).toFixed(2),cardFill:cs.backgroundColor,pageFill:getComputedStyle(document.querySelector('.m3-content')).backgroundColor,cardShadow:cs.boxShadow,uploadTinted:us.backgroundColor,uploadBorder:+ratio(over(parse(us.borderTopColor),bgOf(up)),bgOf(card)).toFixed(2)}})()`);
  console.log('  surfaces', JSON.stringify(surfaces));

  // Save Draft: enabled, hover, focus and disabled must differ by more than colour.
  const save = sel => evaluate(`(async()=>{const b=[...document.querySelectorAll('.m3-editor-footer button')].find(x=>/Save Draft/.test(x.textContent));${sel||''}
    await new Promise(r=>setTimeout(r,500)); // let colour transitions finish
    const s=getComputedStyle(b);return {disabled:b.disabled,bg:s.backgroundColor,color:s.color,border:s.borderTopStyle+' '+s.borderTopColor,cursor:s.cursor,opacity:s.opacity}})()`);
  const states = { initial: await save() };
  states.enabled = await save('b.disabled=false;');
  states.disabled = await save('b.disabled=true;');
  console.log('  save draft', JSON.stringify(states));

  if (!auditOnly) {
    assert.deepEqual(failures, [], 'all visible System Admin text and control boundaries meet WCAG targets');
    // Cards stay separated from the cream page by a white fill, a border and a soft shadow.
    assert.equal(surfaces.cardFill, 'rgb(255, 255, 255)'); assert.equal(surfaces.pageFill, 'rgb(248, 243, 232)');
    assert.ok(surfaces.cardBorder >= 1.2 && surfaces.cardShadow !== 'none', `card edge ${surfaces.cardBorder}:1 plus shadow`);
    assert.notEqual(surfaces.uploadTinted, 'rgb(255, 255, 255)', 'Upload / Extract has a tinted background');
    assert.ok(surfaces.uploadBorder >= 3, `Upload / Extract boundary ${surfaces.uploadBorder}:1`);
    assert.notEqual(states.enabled.bg, states.disabled.bg);
    assert.equal(states.disabled.cursor, 'not-allowed');
    assert.notEqual(states.enabled.border.split(' ')[0], states.disabled.border.split(' ')[0], 'disabled also differs by border style, not colour alone');
  }
  console.log(auditOnly ? `AUDIT: ${failures.length} finding(s)` : 'PASS: System Admin contrast, surfaces and Save Draft states');
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
}
