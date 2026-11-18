// Local fixture-only browser checks; no database or speech calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';



const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const vite = await createServer({root,configFile:false,plugins:[react(),{
name:'account-fixture',enforce:'pre',
resolveId(id){if(id==='/account-fixture.tsx')return '\0account-fixture.tsx';},
load(id){if(id==='\0account-fixture.tsx')return `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import Users from '/src/modules/module1/pages/admin/UserManagementPage';
import Create from '/src/modules/module1/pages/admin/CreateSchoolAdminPage';
import M3 from '/src/modules/module3/components/M3Layout';
import '/src/index.css';
const params=new URLSearchParams(location.search);const role=params.get('role')||'system_admin';
window.fixtureProfile={id:'self',role,full_name:'Review Admin'};
window.loads=0;window.changes=[];window.creates=[];
window.rows=params.has('empty')?[]:['admin','teacher','student','general_user','system_admin'].map((role,i)=>({id:role==='system_admin'?'self':role,role,fullName:role+' Name',nickname:'',email:role+'@example.test',status:i===3?'inactive':'active',signInBlocked:i===3,createdAt:'2026-11-01'}));
if(params.has('many')) window.rows=['admin','teacher','student','general_user'].flatMap(role=>Array.from({length:23},(_,i)=>({id:role+i,role,fullName:role+' Person '+String(i+1).padStart(2,'0'),nickname:'',email:role+i+'@example.test',status:i<11?'active':'inactive',signInBlocked:i>=11,createdAt:'2026-11-01',teacherStatus:role==='teacher'?'approved':null})));
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[params.has('create')?'/system-admin/school-admins/new':'/system-admin/users?section='+ (params.get('section')||'all')]}><Routes><Route element={<M3 role={role}/>}><Route path='/system-admin/users' element={<Users/>}/><Route path='/system-admin/school-admins/new' element={<Create/>}/></Route></Routes></MemoryRouter>);
`;},
async transform(code,id){if(id==='\0account-fixture.tsx')return transformWithEsbuild(code,'fixture.tsx',{loader:'tsx',jsx:'automatic'});
const file=id.replaceAll('\\','/');
if(file.endsWith('/hooks/useAuthenticatedProfile.ts'))return {code:'export default function(){return {profile:window.fixtureProfile,loading:false};}',map:null};
if(file.endsWith('/auth/useAuth.ts'))return {code:'export function useAuth(){return {user:{id:"self"},profile:window.fixtureProfile,loading:false};}',map:null};
if(file.endsWith('/components/ReadFlowDialog.tsx'))return {code:'export async function confirmReadFlow(){return window.confirmResult!==false;}',map:null};
if(file.endsWith('/module1/services/adminUsers.ts'))return {code:`
export async function getManagedAccounts(){window.loads++;const role=window.fixtureProfile.role;return {users:window.rows.filter(u=>role==='system_admin'||['teacher','student'].includes(u.role)),permissions:{role,visibleRoles:role==='system_admin'?'all':['teacher','student'],statusRoles:role==='system_admin'?['admin','general_user']:['teacher','student'],canCreateSchoolAdmin:role==='system_admin'}};}
export async function setManagedUserStatus(id,status){window.changes.push({id,status});return {account:{id,status}};}
export async function createSchoolAdmin(input){window.creates.push(input);if(window.failCreate)throw Error('Fixture create error');return {message:'Invitation sent'};}
export function getAdminUserError(e){return e.message;}
`,map:null};
},
configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/fixture'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/account-fixture.tsx"></script></body></html>'));});}
}],server:{host:'127.0.0.1',port:process.env.M1_REVIEW_ONLY ? Number(process.env.M1_REVIEW_PORT || 5181) : 0,strictPort:true}});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'filipino-ui-'));
let chrome, ws;
const pause = ms => new Promise(r => setTimeout(r, ms));
try {
  await vite.listen();
  const port = vite.httpServer.address().port;
  if(process.env.M1_REVIEW_ONLY){console.log('Fixture-only UI review: http://127.0.0.1:'+port+'/fixture?many');await new Promise(()=>{});}
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let startupError; chrome.on('error', e => startupError = e);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile) && !startupError; i++) await pause(100);
  if (startupError) throw startupError;
  const chromePort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (!m.id) return; const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  await send('Runtime.enable');
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')console.error(JSON.stringify(m.params.exceptionDetails));});
  const until = async expression => { for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(50); } throw Error('Timeout: ' + expression); };

  // Block every non-local request, including external APIs and remote assets.
  const blocked=[];
  ws.addEventListener('message', e=>{
    const m=JSON.parse(e.data); if(m.method!=='Fetch.requestPaused') return;
    const {requestId,request}=m.params;
    const local=/^http:\/\/127\.0\.0\.1:/.test(request.url) || request.url.startsWith('data:');
    if(!local) blocked.push(request.url);
    void send(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId}:{requestId,errorReason:'BlockedByClient'});
  });
  await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});

 const captures=process.env.M1_REVIEW_SCREENSHOTS||path.join(os.tmpdir(),'basa-m1-tabs-review'); /* outside the repository */fs.mkdirSync(captures,{recursive:true});
 const click=async selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const navigate=async query=>{await send('Page.navigate',{url:`http://127.0.0.1:${port}/fixture?${query}`});await until('!!document.querySelector(".admin-users-table") || !!document.querySelector(".create-school-admin-form")');};
 const fill=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 for(const width of [320,390,768,1366]){
 await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 await navigate('');
 assert.equal(await evaluate('document.querySelectorAll(".admin-users-categories article").length'),3);
 assert.deepEqual(await evaluate('[...document.querySelectorAll("dd")].map(e=>e.textContent)'),['1','1','1']);
 assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),5);
 assert.equal(await evaluate(`!!document.querySelector('aside a[href="/system-admin/school-admins/new"]')`),false);
 await click('a[href$="?section=school"]');await until('!!document.querySelector("#school-tab-admin[aria-selected=true]")');
 assert.equal(await evaluate('document.querySelectorAll("tbody button").length'),1);
 assert.equal(await evaluate('document.querySelectorAll(".admin-users-table").length'),1);
 for(const role of ['teacher','student']){
   await click('#school-tab-'+role);
   await until(`document.querySelector('#school-tab-${role}').getAttribute('aria-selected')==='true'`);
   assert.equal(await evaluate('document.querySelectorAll("tbody button").length'),0);
   assert.equal(await evaluate('document.querySelector(".admin-users-managed-note").textContent'),'Managed by School Admin');
   assert.equal(await evaluate(`!!document.querySelector('a[href="/system-admin/school-admins/new"]')`),false);
   assert.equal(await evaluate('document.querySelector("thead").textContent.includes("Teacher Verification")'),role==='teacher');
 }
 await click('#school-tab-admin');
 await click('button[aria-label="Deactivate admin Name"]');await until(`!!document.querySelector('button[aria-label="Reactivate admin Name"]')`);
 await click('button[aria-label="Reactivate admin Name"]');await until('window.changes.length===2');
 await click('a[href$="?section=independent"]');await until('document.querySelectorAll("tbody tr").length===1');
 await click('button[aria-label="Reactivate general_user Name"]');await until('window.changes.length===3');
 await click('a[href$="?section=all"]');await until('!!document.querySelector("select")');
 await fill('[aria-label="Role filter"]','teacher');await until('document.querySelectorAll("tbody tr").length===1');
 await fill('[aria-label="Status filter"]','inactive');await until('!!document.querySelector(".admin-users-empty")');
 await click('[aria-label="Clear filters"]');await fill('[aria-label="Search users"]','general_user@example');await until('document.querySelectorAll("tbody tr").length===1');
 assert.equal(await evaluate('window.loads'),1);
 await click('a[href$="?section=school"]');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await evaluate(`document.querySelector('a[href$="?section=school"]').focus()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 assert.equal(await evaluate('document.activeElement.getAttribute("href")'),'/system-admin/users?section=school');
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(captures,`school-${width}.png`),Buffer.from(shot.data,'base64'));
 await click('a[href="/system-admin/school-admins/new"]');await until('!!document.querySelector("form")');
 await click('button[type="submit"]');await until('document.querySelectorAll("input[aria-invalid=true]").length===2');
 await fill('input[type="text"]','New Admin');await fill('input[type="email"]','admin@example.test');
 await click('button[type="submit"]');await until('window.creates.length===1');
 assert.deepEqual(await evaluate('window.creates[0]'),{fullName:'New Admin',email:'admin@example.test'});
 await until('document.body.textContent.includes("Invitation sent")');
 await click('a[href="/system-admin/users?section=school"]');await until('!!document.querySelector("#school-tab-admin[aria-selected=true]")');
 }

 for(const width of [390,1366]){
 await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 await navigate('many');await click('a[href$="?section=school"]');await until('!!document.querySelector("[role=tablist]")');
 assert.deepEqual(await evaluate('[...document.querySelectorAll("[role=tab]")].map(e=>e.textContent)'),['School Admins (23)','Teachers (23)','Students (23)']);
 const pageText=()=>evaluate('document.querySelector(".admin-users-pagination span").textContent');
 const next=()=>click('.admin-users-pagination button:last-child');
 assert.equal(await pageText(),'Page 1 of 3');
 assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),10);
 await next();await until('document.querySelector(".admin-users-pagination span").textContent==="Page 2 of 3"');
 await next();await until('document.querySelectorAll("tbody tr").length===3');
 assert.match(await evaluate('document.querySelector(".admin-users-result-count").textContent'),/21 - 23 of 23/);
 assert.equal(await evaluate('document.querySelector(".admin-users-pagination button:last-child").disabled'),true);
 await click('#school-tab-teacher');
 await until('document.querySelector(".admin-users-pagination span").textContent==="Page 1 of 3"');
 await next();await fill('[aria-label="Search users"]','Person 23');await until('document.querySelectorAll("tbody tr").length===1');
 assert.equal(await pageText(),'Page 1 of 1');
 assert.equal(await evaluate('document.querySelector("#school-tab-teacher").textContent'),'Teachers (23)');
 await fill('[aria-label="Status filter"]','active');await until('!!document.querySelector(".admin-users-empty")');
 assert.match(await evaluate('document.querySelector(".admin-users-result-count").textContent'),/0 - 0 of 0/);
 await click('[aria-label="Clear filters"]');await next();await fill('[aria-label="Status filter"]','inactive');
 await until('document.querySelector(".admin-users-pagination span").textContent==="Page 1 of 2"');
 assert.match(await evaluate('document.querySelector(".admin-users-result-count").textContent'),/1 - 10 of 12/);
 await click('[aria-label="Clear filters"]');
 await evaluate('document.querySelector("#school-tab-teacher").focus()');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
 await until('document.activeElement.id==="school-tab-student"');
 assert.equal(await evaluate('document.querySelector("#school-tab-student").getAttribute("aria-selected")'),'true');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});
 await until('document.activeElement.id==="school-tab-admin"');
 assert.equal(await evaluate('document.querySelectorAll(".admin-users-table").length'),1);
 await evaluate('document.querySelector("[role=tablist]").scrollIntoView()');
 let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(captures,`school-tabs-${width}.png`),Buffer.from(shot.data,'base64'));
 await click('a[href$="?section=independent"]');await until('!!document.querySelector(".admin-users-pagination") && !document.querySelector("[role=tablist]")');
 assert.deepEqual(await evaluate('[...document.querySelectorAll("th")].map(e=>e.textContent)'),['Name','Email','Status','Registered','Actions']);
 assert.equal(await pageText(),'Page 1 of 3');
 await next();await next();await until('document.querySelectorAll("tbody tr").length===3');
 await fill('[aria-label="Search users"]','GENERAL_USER22@EXAMPLE.TEST');await until('document.querySelectorAll("tbody tr").length===1');
 assert.equal(await pageText(),'Page 1 of 1');
 await fill('[aria-label="Status filter"]','active');await until('!!document.querySelector(".admin-users-empty")');
 await click('[aria-label="Clear filters"]');await next();await fill('[aria-label="Status filter"]','active');
 await until('document.querySelector(".admin-users-pagination span").textContent==="Page 1 of 2"');
 await next();await until('document.querySelectorAll("tbody tr").length===1');
 await evaluate('window.confirmResult=false');
 await click('tbody button');assert.equal(await evaluate('window.changes.length'),0);
 await evaluate('window.confirmResult=true');
 await click('tbody button');await until('window.changes.length===1');
 await until('document.querySelector(".admin-users-pagination span").textContent==="Page 1 of 1"');
 assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),10);
 assert.equal(await evaluate('document.querySelectorAll(".admin-users-total")[0].textContent.startsWith("23")'),true);
 assert.equal(await evaluate('window.loads'),1);
 await click('[aria-label="Clear filters"]');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await evaluate('document.querySelector(".admin-users-table-wrap").scrollIntoView()');
 shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(captures,`independent-accounts-${width}.png`),Buffer.from(shot.data,'base64'));
 }
 await navigate('role=admin');
 assert.equal(await evaluate('document.querySelectorAll(".admin-users-categories").length'),0);
 assert.equal(await evaluate('document.querySelectorAll("tbody button:not(:disabled)").length'),2);
 await navigate('empty');await click('a[href$="?section=school"]');await until('document.querySelectorAll(".admin-users-empty").length===1');
 await navigate('create');await fill('input[type="text"]','New Admin');await fill('input[type="email"]','admin@example.test');
 await evaluate('window.failCreate=true');await click('button[type="submit"]');await until('document.body.textContent.includes("Fixture create error")');
 assert.deepEqual(blocked,[]);
 console.log('PASS: 23-account pagination, reset/clamp, keyboard tabs, filtered counts, category columns, confirmation cancellation, account grouping/counts, navigation, status transitions, view-only roles, filters, create validation/success/error/direct route, School Admin permissions, empty states, keyboard and 4 responsive widths. Fixture services only.');
 console.log('Screenshots: '+captures);
}finally{ws?.close();chrome?.kill();await vite.close();}
