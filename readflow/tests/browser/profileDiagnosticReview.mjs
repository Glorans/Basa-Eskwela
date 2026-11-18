// Local fixture-only browser checks; no database or speech calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';



const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const vite = await createServer({root, configFile:false,plugins:[react(),{
 name:'profile-diagnostic-fixture',enforce:'pre',
 resolveId(id){if(id==='/profile-fixture.tsx')return '\0profile-fixture.tsx';},
 load(id){if(id==='\0profile-fixture.tsx')return `
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {MemoryRouter,Routes,Route,Link} from 'react-router-dom';
 import {RequireRole} from '/src/components/auth/RequireAuth';
 import Basa from '/src/components/basa/BasaLayout';
 import M3 from '/src/modules/module3/components/M3Layout';
 import Result from '/src/modules/module2/pages/DiagnosticResultPage';
 import Reading from '/src/modules/module2/pages/DiagnosticReadingPage';
 import Questions from '/src/modules/module2/pages/DiagnosticQuestionsPage';
 import {diagnosticAssessmentRegistry} from '/src/modules/module2/data/diagnosticData';
 import '/src/index.css';
 const p=new URLSearchParams(location.search);const role=p.get('role')||'student';
 const language=p.get('language')||'fil';const screen=p.get('screen');
 window.fixtureProfile={id:'fixture',role,nickname:'Ana',full_name:'Maria Santos',teacher_status:'approved'};
 window.fixtureResult={language,readingLevel:'Instructional',difficultyTier:'Medium',orvScore:95,comprehensionScore:80,readingSpeedWpm:90};
 const settings=role==='student'?'/dashboard/settings':role==='system_admin'?'/system-admin/settings':role==='admin'?'/m3/admin/settings':role==='teacher'?'/m3/teacher/settings':'/m3/general/settings';
 const layout=role==='student'?<Basa/>:<M3 role={role}/>;
 createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/fixture']}><Routes>
 <Route element={<RequireRole allowedRoles={[role]}/>}><Route element={screen?undefined:layout}><Route path='/fixture' element={screen==='result'?<Result language={language}/>:screen==='reading'?<Reading assessment={diagnosticAssessmentRegistry[language]}/>:screen==='questions'?<Questions assessment={diagnosticAssessmentRegistry[language]}/>:<Link to='/other'>Other page</Link>}/>
 <Route path={settings} element={<h1>Existing Settings Route</h1>}/><Route path='/other' element={<h1>Other page</h1>}/></Route>
 </Route><Route path='/login' element={<><h1>Login</h1><Link to={settings}>Reopen Settings</Link></>}/></Routes></MemoryRouter>);
 `;},
 async transform(code,id){if(id==='\0profile-fixture.tsx')return transformWithEsbuild(code,'fixture.tsx',{loader:'tsx',jsx:'automatic'});const file=id.replaceAll('\\','/');
 if(file.endsWith('/hooks/useAuthenticatedProfile.ts'))return {code:'export default function(){return {profile:window.fixtureProfile,loading:false};}',map:null};
 if(file.endsWith('/auth/useAuth.ts'))return {code:'export function useAuth(){return {user:window.logoutCalled&&!window.failLogout?null:{id:"fixture"},profile:window.fixtureProfile,loading:false,profileError:false};}',map:null};
 if(file.endsWith('/services/authService.ts'))return {code:'export async function logout(){window.logoutCalled=true;return !window.failLogout;}',map:null};
 if(file.endsWith('/module2/services/diagnosticDatabase.ts'))return {code:`export const getInitialDiagnosticResult=async()=>({result:window.fixtureResult});export const getCompletedDiagnosticLanguages=async()=>['en','fil'];export class DiagnosticDatabaseError extends Error{};export const saveInitialDiagnosticResult=async()=>{throw Error('No writes');};`,map:null};
 if(file.endsWith('/module2/components/DiagnosticSessionProvider.tsx'))return {code:`export function useDiagnosticSession(){return {get:()=>({reading:{language:'fil'},answers:{},questionIndex:0}),save(){},clear(){}};}`,map:null};
 if(file.endsWith('/module2/services/diagnosticTts.ts'))return {code:`export function synthesizeDiagnosticSpeech(){throw Error('No speech calls');}`,map:null};
 },
 configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/fixture'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/profile-fixture.tsx"></script></body></html>'));});}
}],server:{host:'127.0.0.1',port:0}});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'filipino-ui-'));
let chrome, ws;
const pause = ms => new Promise(r => setTimeout(r, ms));
try {
  await vite.listen();
  const port = vite.httpServer.address().port;
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

 const captures=path.join(root,'../.tmp/profile-diagnostic-captures');fs.mkdirSync(captures,{recursive:true});
 let checks=0;
 const navigate=async(query)=>{await send('Page.navigate',{url:`http://127.0.0.1:${port}/fixture?${query}`});};
 const click=async(selector)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const key=async(key)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,text:key==='Enter'?'\r':undefined,windowsVirtualKeyCode:({Enter:13,Escape:27,ArrowDown:40,ArrowUp:38,Home:36,End:35})[key]});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});};
 for(const width of [320,390,768,1366]) for(const [persona,role] of [['System Admin','system_admin'],['School Admin','admin'],['Teacher','teacher'],['Student','student'],['Independent Learner','general_user']]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await navigate(`role=${role}`);await until(`!!document.querySelector('.profile-dropdown-trigger')`);
  // Sidebar: no Settings, exactly one Logout (the shared footer).
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('aside a,aside button')).some(e=>/Settings/.test(e.textContent))`),false);
  assert.equal(await evaluate(`document.querySelectorAll('aside .rf-sidebar-footer button').length`),1);
  // Account menu: identity and Settings only.
  await click('.profile-dropdown-trigger');await until(`!!document.querySelector('[role="menu"]')`);
  assert.equal(await evaluate(`document.querySelectorAll('[role="menuitem"]').length`),1);
  assert.equal(await evaluate(`/Logout/.test(document.querySelector('.profile-dropdown-panel').textContent)`),false);
  const identity=await evaluate(`document.querySelector('.profile-dropdown-identity').textContent`);
  assert.ok(identity.includes(role==='student'||role==='general_user'?'Ana':'Maria Santos'));
  assert.ok(identity.includes(persona));
  const bounds=await evaluate(`(()=>{const r=document.querySelector('.profile-dropdown-panel').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
  assert.ok(bounds.left>=0&&bounds.right<=width&&bounds.bottom<=900&&!bounds.overflow,JSON.stringify({width,persona,bounds}));
  assert.equal(await evaluate(`document.activeElement.textContent`),'Settings');
  await key('ArrowDown');assert.equal(await evaluate(`document.activeElement.textContent`),'Settings');
  await key('Escape');assert.equal(await evaluate(`!!document.querySelector('[role="menu"]')`),false);
  assert.equal(await evaluate(`document.activeElement.className`),'profile-dropdown-trigger');
  await key('Enter');await until(`!!document.querySelector('[role="menu"]')`);
  await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  assert.equal(await evaluate(`!!document.querySelector('[role="menu"]')`),false);
  await click('.profile-dropdown-trigger');await click('[role="menuitem"]');await until(`document.querySelector('h1')?.textContent==='Existing Settings Route'`);
  assert.equal(await evaluate(`!!document.querySelector('[role="menu"]')`),false);
  if(width<1000){await click(role==='student'?'.basa-menu-button':'.m3-menu-button');await key('Escape');await pause(100);await click('.profile-dropdown-trigger');
   assert.equal(await evaluate(`!!document.querySelector('.basa-sidebar--open,.m3-sidebar--open')`),false);
   await key('Escape');await pause(100);
  }
  // Logout sits at the bottom of the sidebar, below the navigation, uncovered; phones/tablets open the drawer first.
  const openSidebar=async()=>{if(width<1000){await click(role==='student'?'.basa-menu-button':'.m3-menu-button');await until(`!!document.querySelector('.basa-sidebar--open,.m3-sidebar--open')`);await pause(300);}};
  const footerGeometry=()=>evaluate(`(()=>{const aside=document.querySelector('aside.rf-sidebar');const a=aside.getBoundingClientRect();const f=aside.querySelector('.rf-sidebar-footer');const b=f.querySelector('button');const r=b.getBoundingClientRect();const n=aside.querySelector('nav');const nr=n.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {bottomLimit:Math.min(a.bottom,innerHeight),buttonTop:r.top,buttonBottom:r.bottom,footerTop:f.getBoundingClientRect().top,navBottom:nr.bottom,navScrolls:n.scrollHeight>n.clientHeight+1,asideWidth:a.width,label:b.getAttribute('aria-label'),title:b.title,uncovered:b.contains(hit)};})()`);
  const checkFooter=(g,where)=>{assert.equal(g.label,'Logout',where);assert.ok(g.uncovered,where+JSON.stringify(g));assert.ok(g.navBottom<=g.footerTop+1,where+' nav overlaps Logout '+JSON.stringify(g));
   assert.ok(g.buttonBottom<=g.bottomLimit+1&&g.buttonBottom>=g.bottomLimit-90,where+' Logout not at the bottom '+JSON.stringify(g));};
  await openSidebar();checkFooter(await footerGeometry(),`${width} ${persona}`);
  if(width<1000){await key('Escape');await pause(300);}
  // A short screen: the navigation scrolls, Logout stays visible at the bottom.
  await send('Emulation.setDeviceMetricsOverride',{width,height:600,deviceScaleFactor:1,mobile:false});await pause(150);
  await openSidebar();const short=await footerGeometry();checkFooter(short,`${width}x600 ${persona}`);if(role==='admin')assert.ok(short.navScrolls,'admin navigation scrolls on a short screen');
  if(width<1000){await key('Escape');await pause(300);}
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await pause(150);
  // Collapsed desktop rail: icon only, still labelled and reachable.
  if(width>=1000){await click('.rf-rail-toggle');await pause(300);const rail=await footerGeometry();assert.ok(rail.asideWidth<=81,JSON.stringify(rail));checkFooter(rail,`rail ${persona}`);
   assert.equal(await evaluate(`getComputedStyle(document.querySelector('aside .rf-sidebar-footer .rf-nav-label')).display`),'none');
   await click('.rf-rail-toggle');await pause(300);}
  await openSidebar();
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(captures,`${width}-${persona}.png`),Buffer.from(shot.data,'base64'));
  // Keyboard: focus Logout and press Enter; the existing sign-out runs and the learner lands on Login.
  await evaluate(`document.querySelector('aside .rf-sidebar-footer button').focus()`);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`),'Logout');
  await key('Enter');await until(`document.querySelector('h1')?.textContent==='Login'`);
  assert.equal(await evaluate(`window.logoutCalled`),true);await click('a');await pause(100);assert.equal(await evaluate(`document.querySelector('h1')?.textContent`),'Login');
  await evaluate(`window.logoutCalled=false`);checks++;
 }
 for(const width of [320,390,768,1366])for(const language of ['en','fil'])for(const screen of ['result','reading','questions']){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await navigate(`screen=${screen}&language=${language}`);await until(`!!document.querySelector('h1')`);
  const body=await evaluate(`document.body.innerText`);
  assert.ok(body.includes(screen==='result'?(language==='fil'?'Resulta ng Pagbasa sa Filipino':'English Reading Result'):screen==='reading'?(language==='fil'?'Basahin nang Malakas':'Read the Story Aloud'):(language==='fil'?'Sagutin ang mga Tanong':'Answer the Questions')),body);
  if(screen==='result'){
   for(const word of ['Independent','Instructional','Frustration',language==='fil'?'Katamtaman':'Medium',language==='fil'?'Mga Antas sa Pagbasa':'Reading Levels'])assert.ok(body.includes(word),word);
  }
  assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth+1`),false,`${screen} overflow at ${width}`);
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(captures,`${width}-${language}-${screen}.png`),Buffer.from(shot.data,'base64'));checks++;
 }
 // A failed sign-out must retain access, report failure in the sidebar, and allow another attempt.
 await navigate('role=student');await until(`!!document.querySelector('.profile-dropdown-trigger')`);
 await evaluate(`window.failLogout=true`);await click('aside .rf-sidebar-footer button');
 await until(`document.querySelector('aside [role="alert"]')?.textContent==='Could not sign out. Please try again.'`);
 assert.equal(await evaluate(`!!document.querySelector('.profile-dropdown-trigger')`),true);
 assert.equal(await evaluate(`document.querySelector('aside .rf-sidebar-footer button').disabled`),false);
 await evaluate(`window.failLogout=false`);await click('aside .rf-sidebar-footer button');
 await until(`document.querySelector('h1')?.textContent==='Login'`);checks++;
 await navigate('screen=result&language=fil');await until(`document.querySelector('h1')?.textContent==='Resulta ng Pagbasa sa Filipino'`);
 await send('Page.reload');await until(`document.querySelector('h1')?.textContent==='Resulta ng Pagbasa sa Filipino'`);checks++;
 console.log(JSON.stringify({checks,blocked,captures},null,2));assert.deepEqual(blocked,[]);
}finally{ws?.close();chrome?.kill();await vite.close();}
