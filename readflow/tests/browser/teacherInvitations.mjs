// Isolated real-browser UI checks. Auth/RPC boundaries are mocked; no accounts or codes are created.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'readflow-invitation-ui-'));
const server = await createServer({ root, configFile: false,
  server: { host: '127.0.0.1', port: 5188, strictPort: true }, plugins: [{
    name: 'invitation-fixture', enforce: 'pre',
    resolveId(id) {
      if(id.endsWith('/auth/useAuth')) return '\0auth';
      if(id.endsWith('/services/authService')) return '\0authService';
      if(id==='/invitation-fixture.tsx') return '\0invitation-fixture.tsx';
      if(id.endsWith('/services/adminUsers')) return '\0adminUsers';
      if(id.endsWith('/services/teacherInvitations')) return '\0invitations';
      if(id.endsWith('/components/ReadFlowDialog')) return '\0dialog';
    },
    load(id) {
      if(id==='\0auth') return `export const useAuth=()=>({profile:{role:'teacher',teacher_status:'pending'},refreshProfile:async()=>{window.refreshCount=(window.refreshCount||0)+1;}});`;
      if(id==='\0authService') return `export const logout=async()=>{window.loggedOut=true;};`;
      if(id==='\0adminUsers') return `let rows=[{id:'teacher',fullName:'Pending Teacher',email:'teacher@example.test',role:'teacher',teacherStatus:'pending',status:'active',createdAt:'2026-10-12'},{id:'approved',fullName:'Already Approved',role:'teacher',teacherStatus:'approved'},{id:'student',fullName:'Existing Student',role:'student'}];export const getManagedUsers=async()=>rows;export const getAdminUserError=e=>e.message;export const reviewTeacherRegistration=async(id,decision)=>{if(window.failReview)throw Error('Review unavailable');rows=rows.filter(row=>row.id!==id);return decision;};`;
      if(id==='\0dialog') return `export const confirmReadFlow=async()=>window.allowRevoke;`;
      if(id==='\0invitations') return `const row={id:'fixture-invitation',active:true,createdAt:'2026-10-12T00:00:00Z',expiresAt:'2030-01-01T00:00:00Z',maxUses:1,useCount:0,status:'active'};let rows=[];window.createCount=0;window.allowRevoke=true;export const listTeacherInvitations=async()=>rows;export const createTeacherInvitation=async(expiresAt,maxUses)=>{window.createCount++;rows=[{...row,expiresAt,maxUses}];return {invitation:rows[0],code:'FIXTURE_ONLY_NOT_A_REAL_INVITATION'};};export const revokeTeacherInvitation=async()=>{rows=[{...rows[0],active:false,status:'revoked'}];return rows[0];};export const invitationError=e=>e.message;`;
      if(id==='\0invitation-fixture.tsx') return `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Verification from '/src/modules/module1/pages/TeacherVerificationPage.tsx';import Page from '/src/modules/module1/pages/admin/TeacherInvitationsPage.tsx';import '/src/index.css';if(location.search.includes('verification'))document.body.style.padding='0';createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(location.search.includes('verification')?Verification:Page)));`;
    },
    configureServer(vite) { vite.middlewares.use(async(req,res,next)=>{
      if(!req.url.startsWith('/invitation-check'))return next();
      res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/invitation-check','<html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="background:#d6e2d2;padding:20px"><div id="root"></div><script type="module" src="/invitation-fixture.tsx"></script></body></html>'));
    }); },
  },react()] });
let chrome, ws;
try {
  await server.listen();
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9238',`--user-data-dir=${join(artifacts,'profile')}`,'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let target;
  for (let i=0;i<100;i++) {
    try { target=await(await fetch('http://127.0.0.1:9238/json/new?about:blank',{method:'PUT'})).json();break; }
    catch { await new Promise(r=>setTimeout(r,100)); }
  }
  assert.ok(target,'Chrome debugging endpoint did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let id=0;const pending=new Map();
  ws.addEventListener('message', event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error(`Timed out: ${expression}`);};
  const click=async text=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable');b.click();})()`);
  await send('Page.enable');
  await send('Browser.grantPermissions',{origin:'http://127.0.0.1:5188',permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  for(const [width,height] of [[1366,768],[1280,720],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'http://127.0.0.1:5188/invitation-check'});
    await send('Page.bringToFront');
    await until('!!document.querySelector("form") && !document.querySelector("button[type=submit]").disabled');
    assert.equal(await evaluate('document.querySelector("input[type=number]").value'),'1');
    await click('Generate invitation');
    await until('!!document.querySelector("code")');
    assert.equal(await evaluate('window.createCount'),1);
    assert.equal(await evaluate('document.activeElement.id'),'invitation-code-title');
    await click('Copy Code');await until('document.body.innerText.includes("Code copied")');
    assert.equal(await evaluate('navigator.clipboard.readText()'),'FIXTURE_ONLY_NOT_A_REAL_INVITATION');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    await writeFile(join(artifacts,`${width}x${height}.png`),Buffer.from(screenshot.data,'base64'));
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    assert.equal(await evaluate('localStorage.length+sessionStorage.length'),0);
    await click('Dismiss code');await until('!document.querySelector("code")');
    await click('Refresh list');await until('!document.querySelector("main").getAttribute("aria-busy") || document.querySelector("main").getAttribute("aria-busy")==="false"');
    assert.equal(await evaluate('!!document.querySelector("code")'),false);
    await click('Revoke');await until('document.body.innerText.includes("Invitation revoked.")');
    assert.ok(await evaluate('document.querySelector("tbody").innerText.includes("revoked")'));
    await click('Pending Approval'); await until('document.body.innerText.includes("teacher@example.test")');
    assert.equal(await evaluate('document.body.innerText.includes("Already Approved") || document.body.innerText.includes("Existing Student")'),false);
    await evaluate('window.failReview=true'); await click('Approve Teacher'); await until('document.body.innerText.includes("Review unavailable")');
    await evaluate('window.failReview=false'); await click('Refresh pending teachers'); await until('document.body.innerText.includes("teacher@example.test")');
    await evaluate('window.allowRevoke=false'); await click('Reject Teacher');
    assert.ok(await evaluate('document.body.innerText.includes("teacher@example.test")'));
    await evaluate('window.allowRevoke=true');
    await click(width===1280 ? 'Reject Teacher' : 'Approve Teacher');
    await until('document.body.innerText.includes("No pending teacher applications.")');
    await click('Refresh pending teachers'); await until('document.body.innerText.includes("No pending teacher applications.")');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    console.log(`PASS invitation creation/copy/dismiss/metadata/revoke at ${width}x${height}`);
  }
  for(const [width,height] of [[1366,768],[1280,720],[390,844],[320,640]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'http://127.0.0.1:5188/invitation-check?verification'});
    await until('!!document.querySelector(".teacher-verification")');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    assert.ok(await evaluate(`(()=>{const h=document.querySelector('h1').getBoundingClientRect();const p=document.querySelector('.auth-form-panel').getBoundingClientRect();return h.left>=p.left && h.right<=p.right;})()`));
    assert.ok(await evaluate(`(()=>{const b=[...document.querySelectorAll('.auth-submit')].map(n=>n.getBoundingClientRect());return b[1].top-b[0].bottom>=15;})()`));
    if(width>800) assert.ok(await evaluate('document.documentElement.scrollHeight<=innerHeight'));
    assert.ok(
  await evaluate(
    '![...document.querySelectorAll("button")].some(b => b.textContent?.trim() === "Check Approval Status")'
   )
    );    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    await writeFile(join(artifacts,`verification-${width}x${height}.png`),Buffer.from(screenshot.data,'base64'));
    await click('Sign Out');await until('window.loggedOut===true');
    console.log(`PASS verification layout/logout at ${width}x${height}`);
  }
  console.log('Screenshots:',artifacts);
  await send('Browser.close');
} finally { ws?.close();chrome?.kill();await server.close(); }
