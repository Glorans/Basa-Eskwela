// Run after npm run build: node tests/browser/systemAdminTheme.mjs
// CSS layout fixtures, not authenticated end-to-end coverage. No API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import postcss from 'postcss';

const assets = new URL('../../dist/assets/', import.meta.url);
const css = fs.readdirSync(assets).filter(name => name.endsWith('.css'))
  .map(name => fs.readFileSync(new URL(name, assets), 'utf8')).join('\n');
assert.ok(css.includes('.system-admin-ui'), 'Build production CSS first');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'basa-system-admin-layout-'));
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

  const baseline = postcss.parse(css);
  baseline.walkRules(rule => { if (rule.selector.includes('.system-admin-ui')) rule.remove(); });
  const beforeCss = baseline.toString();
  const output = process.env.BASA_UI_SCREENSHOTS || path.join(os.tmpdir(), 'basa-system-admin-ui-review');
  fs.mkdirSync(output,{recursive:true});
  const links=['Content Management','Create Module','Reading Materials','Upload Material','User Management','Create School Admin','Platform Analytics','Independent Learners'];
  const sidebar=`<aside class="m3-sidebar rf-sidebar"><div class="rf-sidebar-main"><div class="m3-sidebar-brand"><a class="m3-sidebar-home"><span class="m3-brand-logo">BE</span><span class="rf-nav-label"><strong>Basa Eskwela</strong><small class="sa-brand-caption">Administration</small></span></a><button class="rf-rail-toggle" aria-label="Collapse sidebar">?</button><button class="rf-drawer-close" aria-label="Close navigation">?</button></div><nav class="m3-sidebar-nav rf-sidebar-scroll">${links.map((l,i)=>`<a class="m3-nav-item ${i===6?'m3-nav-item--active':''}"><span aria-hidden="true">?</span><span class="rf-nav-label">${l}</span></a>`).join('')}</nav></div><div class="m3-sidebar-footer rf-sidebar-footer"><button class="m3-sidebar-quiet-link"><span>?</span><span class="rf-nav-label">Logout</span></button></div></aside>`;
  const header=`<header class="m3-topbar"><div class="m3-topbar-title"><button class="m3-menu-button" aria-label="Open navigation">?</button></div><div class="profile-dropdown"><button class="profile-dropdown-trigger"><span class="profile-dropdown-avatar">SA</span><span class="profile-dropdown-copy"><strong>Layout test fixture</strong><small>System Admin</small></span></button></div></header>`;
  const table=`<div class="m7-scroll"><table><thead><tr>${['Learner','Saved readings','Completed quizzes','Comprehension','Reading accuracy','Reading speed','Last activity'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${Array.from({length:3},()=>'<tr><td>Fixture account</td><td>0</td><td>0</td><td>No data</td><td>No data</td><td>No data</td><td>No activity yet</td></tr>').join('')}</tbody></table></div>`;
  const overview=`<main class="m7-page m7-dashboard m7-admin-dashboard"><header class="m7-dashboard-header"><div><h1>Platform Analytics</h1><p>CSS layout fixture only. Live pages continue to use existing API data.</p></div></header><div class="m7-dashboard-content"><section><h2>Registered users</h2><div class="m7-metrics">${['All accounts','Independent Learners','Students','Teachers','School Admins','System Admins'].map(x=>`<div class="m7-card"><span>${x}</span><strong>0</strong></div>`).join('')}</div></section><section><h2>Independent Learners</h2>${table}</section><section><h2>Weekly activity</h2><p>No learner activity recorded yet.</p></section></div></main>`;
  const editor=`<div class="m3-page-stack m3-collection-editor"><header class="m3-editor-header"><h1>Create Reading Module</h1><p>Layout fixture ? no save requests are made.</p></header><section class="m3-editor-card"><div class="m3-editor-metadata m3-collection-fields"><label>Title<input value="Reading module"></label><label>Difficulty<select><option>Easy</option></select></label></div></section><section class="m3-editor-card"><h2>Passage 1</h2><label>Reading passage<textarea rows="5">Fixture text for responsive layout verification.</textarea></label><div class="m3-editor-upload"><label>Upload reading material<input type="file"></label></div></section><div class="m3-collection-actions"><button class="m3-button">Save Draft</button><button class="m3-button m3-button--secondary">Discard Changes</button></div></div>`;
  const users=`<div class="admin-users-page"><header class="admin-users-header"><h1>User Management</h1><p>Manage the existing accounts within your permitted scope.</p></header><section class="admin-users-table-wrap"><div class="admin-users-controls"><label class="admin-users-control">Search<input placeholder="Search users"></label><label class="admin-users-control">Account type<select><option>All roles</option></select></label></div><div class="admin-users-table-scroll"><table class="admin-users-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody><tr><td>Fixture account</td><td>fixture@example.test</td><td>School Admin</td><td><button class="admin-users-delete">Delete</button></td></tr></tbody></table></div></section></div>`;
  const render=async(role,width,content,styles=css,collapsed=false,open=false)=>{
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.enable');
    let html=`<!doctype html><html><head><style>${styles}</style></head><body><div id="root"><div class="m3-shell m3-shell--admin rf-shell ${role==='system_admin'?'system-admin-ui':''} ${collapsed?'rf-shell--collapsed':''} ${open?'rf-shell--drawer-open':''}">${sidebar.replace('m3-sidebar rf-sidebar',`m3-sidebar rf-sidebar ${open?'m3-sidebar--open':''}`)}<div class="m3-workspace rf-workspace">${header}<div class="rf-content-scroll"><main class="m3-content">${content}</main></div></div></div></div></body></html>`;
    if(role==='student') html=html.replace('m3-shell m3-shell--admin','basa-page').replaceAll('m3-sidebar','basa-sidebar').replaceAll('m3-workspace','basa-main-shell').replaceAll('m3-topbar','basa-header').replaceAll('m3-content','basa-content');
    const frame=(await send('Page.getFrameTree')).frameTree.frame.id;
    await send('Page.setDocumentContent',{frameId:frame,html});
    await send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});
  };
  const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
  const measure=()=>evaluate(`JSON.stringify([...document.querySelectorAll('.rf-shell *')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(); return [e.tagName,e.className,s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.borderRadius,s.display,s.padding,s.boxShadow,r.x,r.y,r.width,r.height]}))`);
  let checks=0;
  for(const role of ['admin','teacher','student','general_user']) for(const width of [390,768,1024,1440]) {
    await render(role,width,overview,beforeCss);const before=await measure();
    await render(role,width,overview,css);assert.equal(await measure(),before,`${role} ${width}: zero computed-style/geometry changes`);checks++;
  }
  for(const width of [390,768,1024,1440]) for(const [name,content] of [['analytics',overview],['editor',editor],['users',users]]) {
    await render('system_admin',width,content);
    const dimensions=await evaluate(`(()=>{let e=document.querySelector('.m3-content'),h=document.querySelector('.m3-topbar'); return {documentFits:document.documentElement.scrollWidth<=innerWidth,contentFits:e.scrollWidth<=e.clientWidth+1,headerFits:h.scrollWidth<=h.clientWidth+1,sidebar:getComputedStyle(document.querySelector('.m3-sidebar')).backgroundColor,background:getComputedStyle(e).backgroundColor,heading:getComputedStyle(e.querySelector('h1')).color}})()`);
    assert.deepEqual(dimensions,{documentFits:true,contentFits:true,headerFits:true,sidebar:'rgb(18, 63, 50)',background:'rgb(244, 246, 245)',heading:'rgb(18, 63, 50)'},`${name} ${width}`);
    // Minimal header: account controls flush right, no title text, compact height; one h1 in the content.
    const header=await evaluate(`(()=>{let h=document.querySelector('.m3-topbar'),p=h.querySelector('.profile-dropdown'),hr=h.getBoundingClientRect(),pr=p.getBoundingClientRect(),pad=parseFloat(getComputedStyle(h).paddingRight);return {right:Math.abs(hr.right-pad-pr.right)<=1,height:Math.round(hr.height)<=68,title:h.querySelector('.m3-topbar-title').textContent.replace('?','').trim(),h1:document.querySelectorAll('h1').length}})()`);
    assert.deepEqual(header,{right:true,height:true,title:'',h1:1},`${name} ${width} header`);
    if(name==='analytics'||width===1440){ const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`${name}-${width}.png`),Buffer.from(shot.data,'base64')); }
    if(width>=1000){await render('system_admin',width,content,css,true);assert.equal(await evaluate(`Math.round(document.querySelector('.m3-sidebar').getBoundingClientRect().width)`),80);}
    else {await render('system_admin',width,content,css,false,true);assert.equal(await evaluate(`Math.round(document.querySelector('.m3-sidebar').getBoundingClientRect().x)`),0);}
    checks++;
  }
  const arrow='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 19-7-7 7-7M5 12h14"/></svg>';
  const backLinks=`<div class="m3-collection-editor"><a href="#content" class="m3-editor-back">${arrow}Back to Content Management</a></div><div class="m3-page-stack"><a href="#materials" class="m3-back-link">${arrow}Back to Reading Materials</a></div><div class="m3-empty-state"><a href="#material" class="m3-back-link">${arrow}Back to Material</a></div>`;
  for(const width of [390,1440]) {
    await render('system_admin',width,backLinks);
    const styles=await evaluate(`Array.from(document.querySelectorAll('.m3-editor-back,.m3-back-link'),e=>{const s=getComputedStyle(e),i=getComputedStyle(e.querySelector('svg'));return [s.color,s.fontSize,s.fontWeight,s.gap,s.padding,i.width,i.height]})`);
    for(const style of styles)assert.deepEqual(style,['rgb(18, 63, 50)','14px','600','8px','6px 8px','17px','17px']);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await evaluate(`document.querySelector('.m3-editor-back').focus()`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.m3-editor-back')).outlineStyle`),'solid');
    const pos=await evaluate(`(()=>{const r=document.querySelector('.m3-back-link').getBoundingClientRect();return {x:r.x+8,y:r.y+8}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.m3-back-link')).backgroundColor`),'rgb(233, 243, 236)');
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`back-links-${width}.png`),Buffer.from(shot.data,'base64'));
    for(const role of ['admin','teacher','general_user']) {
      await render(role,width,backLinks,beforeCss);const before=await measure();
      await render(role,width,backLinks,css);assert.equal(await measure(),before,`${role}: Back links unchanged`);
    }
    checks++;
  }
  // Solid circular "Add Passage Below" button (System Admin editor only), checked on the REAL editor markup:
  // beside the card's upper-right edge on tablet/desktop, inside the card at the bottom-right on phones; never overlapping.
  const { renderSystemAdminEditor } = await import('./systemAdminEditorMarkup.ts');
  const editorHtml = await renderSystemAdminEditor();
  const passages = editorHtml.replace(/(<section class="m3-editor-card m3-editor-passage"[\s\S]*?<\/section>)/, '$1$1'); // two passage cards
  for(const width of [390,768,1440]) {
    await render('system_admin',width,passages);
    const tip=async()=>{await pause(250);return evaluate(`(()=>{const t=document.querySelector('.sa-add-passage-tooltip'),s=getComputedStyle(t),r=t.getBoundingClientRect();return {visible:s.visibility==='visible'&&s.opacity==='1',onScreen:r.left>=0&&r.right<=innerWidth}})()`);};
    const layout=await evaluate(`(()=>{const cards=document.querySelectorAll('.m3-editor-passage'),card=cards[0],c=card.getBoundingClientRect(),b=card.querySelector('.sa-add-passage'),r=b.getBoundingClientRect(),s=getComputedStyle(b),next=cards[1].getBoundingClientRect();
      const hit=q=>!(q.right<=r.left||q.left>=r.right||q.bottom<=r.top||q.top>=r.bottom);
      const overlaps=[...document.querySelectorAll('.m3-content *')].filter(e=>!b.contains(e)&&!e.contains(b)&&e.getBoundingClientRect().width&&hit(e.getBoundingClientRect())).map(e=>e.tagName+'.'+e.className);
      const wide=innerWidth>=768;
      return {round:s.borderRadius==='50%'&&Math.round(r.width)===Math.round(r.height)&&r.width>=40,solid:s.backgroundColor,plus:getComputedStyle(b.querySelector('svg')).color,
        placed:wide?(r.left>=c.right+8&&r.top>=c.top&&r.top<=c.top+40):(r.left>=c.left&&r.right<=c.right&&r.bottom<=c.bottom),aboveNext:r.bottom<=next.top,
        overlaps,perCard:document.querySelectorAll('.m3-editor-passage .sa-add-passage').length,fits:document.documentElement.scrollWidth<=innerWidth}})()`);
    assert.deepEqual(layout,{round:true,solid:'rgb(40, 116, 83)',plus:'rgb(255, 255, 255)',placed:true,aboveNext:true,overlaps:[],perCard:2,fits:true},`add passage ${width}`);
    if(width===768){const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`add-passage-${width}.png`),Buffer.from(shot.data,'base64'));}
    assert.equal((await tip()).visible,false,'tooltip hidden until hover or focus');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await evaluate(`document.querySelector('.sa-add-passage').focus()`);
    assert.deepEqual(await tip(),{visible:true,onScreen:true},`focus tooltip ${width}`);
    if(width===1440){const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`add-passage-focus-${width}.png`),Buffer.from(shot.data,'base64'));}
    await evaluate(`document.activeElement.blur()`);
    const pos=await evaluate(`(()=>{const r=document.querySelector('.sa-add-passage').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
    assert.deepEqual(await tip(),{visible:true,onScreen:true},`hover tooltip ${width}`);
    if(width===390){const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`add-passage-hover-${width}.png`),Buffer.from(shot.data,'base64'));}
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    checks++;
  }
  console.log(`PASS: ${checks} CSS fixtures: 16 other-role before/after comparisons; 12 System Admin page/viewport layouts; 2 Back-link desktop/mobile checks with hover, focus and role isolation, including collapsed rail and mobile drawer; 3 Add Passage Below button checks. Screenshots: ${output}`);
  await send('Browser.close');
} finally { ws?.close(); chrome.kill(); }
