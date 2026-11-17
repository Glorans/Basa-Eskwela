// Local fixture-only browser checks; no database or speech calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';




const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const vite=await createServer({root,configFile:false,plugins:[react(),{
 name:'materials-ui-fixture',enforce:'pre',
 resolveId(id){if(id==='/materials-fixture.tsx')return '\0materials-fixture.tsx';},
 load(id){if(id==='\0materials-fixture.tsx')return `
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {MemoryRouter,Routes,Route} from 'react-router-dom';
 import Library from '/src/modules/module3/pages/MaterialLibraryPage';
 import Detail from '/src/modules/module3/pages/MaterialDetailPage';
 import '/src/index.css';import '/src/modules/module3/styles/module3.css';
 const p=new URLSearchParams(location.search);const role=p.get('role')||'general_user';
 window.materialFixture={id:'material',uploadedById:'owner',title:'A very long private reading material title about caring for our community and environment',originalFilename:'A_very_long_uploaded_filename_without_spaces_for_overflow_testing.pdf',fileType:'PDF',language:'Filipino',languageCode:'fil',uploadedAt:'2026-11-18',processingStatus:'completed',contentText:'Ang pusa ay masaya.',questionSetCount:2};
 window.practiceFixture={revision:'v1',reviewed:p.get('reviewed')==='true',missingPages:[],questionSetId:p.get('saved')?'saved':null,readingId:p.get('saved')?'reading':null,attemptId:null,attemptStatus:null};
 window.fixtureRole=role;window.failureStatus=Number(p.get('status')||502);window.fixtureState=p.get('state');window.confirmCalls=0;window.removeCalls=0;
 window.savedSet={id:'saved',name:'Saved Set One',sequenceNumber:1,questionCount:9,counts:{literal:3,inferential:3,critical:3},reviewStatus:'reviewed',hasStudentAttempts:true};
 createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/materials'+(p.get('detail')?'/material':'')]}><main style={{maxWidth:1100,margin:'24px auto',padding:16}}><Routes>
 <Route path='/materials' element={<Library role={role}/>}/><Route path='/materials/:materialId' element={<Detail role={role}/>}/>
 </Routes></main></MemoryRouter>);
 `;},
 async transform(code,id){if(id==='\0materials-fixture.tsx')return transformWithEsbuild(code,'fixture.tsx',{loader:'tsx',jsx:'automatic'});const file=id.replaceAll('\\','/');
 if(file.endsWith('/module3/context/M3ContentContext.tsx'))return {code:`const refreshMaterials=async()=>{};export const useM3Content=()=>({materials:window.fixtureState==='empty'?[]:[window.materialFixture],materialsLoading:window.fixtureState==='loading',materialsError:'',getMaterial:()=>window.materialFixture,refreshMaterials,removeMaterial:async()=>{window.removeCalls++;}});`,map:null};
 if(file.endsWith('/hooks/useAuthenticatedProfile.ts'))return {code:`export default function(){return {profile:{id:'owner',role:window.fixtureRole},loading:false};}`,map:null};
 if(file.endsWith('/services/authHeaders.ts'))return {code:`export const getSessionAuthHeaders=async()=>({});`,map:null};
 if(file.endsWith('/components/ReadFlowDialog.tsx'))return {code:`export const confirmReadFlow=async(text)=>{window.confirmCalls++;window.confirmText=text;return false;};`,map:null};
 if(file.endsWith('/services/api.ts'))return {code:`export default {get:async(path)=>({data:path.endsWith('/personal-practice')?{state:{...window.practiceFixture}}:path.endsWith('/materials/trash')?{materials:[]}:{sets:[window.savedSet]}}),post:async(path)=>{if(path.endsWith('/confirm')){window.practiceFixture.reviewed=true;return {data:{}};}throw {response:{status:window.failureStatus,data:{message:'Gemini gemini-model API_KEY=secret internal provider stack'}}};}};`,map:null};
 },
 configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/fixture'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/materials-fixture.tsx"></script></body></html>'));});}
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


 const captures=fs.mkdtempSync(path.join(os.tmpdir(),'materials-ui-captures-'));let checks=0;
 const nav=async(query)=>{await send('Page.navigate',{url:`http://127.0.0.1:${port}/fixture?${query}`});await until(`!!document.querySelector('h1')`);};
 const clickText=async(text)=>evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing '+${JSON.stringify(text)});e.click();})()`);
 const layout=async(label)=>{await pause(150);assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth+1`),false,label);
 const clipped=await evaluate(`Array.from(document.querySelectorAll('button,a')).filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.textContent)`);assert.deepEqual(clipped,[],label);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(captures,label+'.png'),Buffer.from(shot.data,'base64'));checks++;};
 for(const width of [320,390,768,1366]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await nav('role=general_user');await until(`!!document.querySelector('.m3-record-card')`);
  assert.equal(await evaluate(`document.querySelectorAll('a[href*="question-sets"]').length`),0,'No unauthorized learner question-set links');
  assert.equal(await evaluate(`document.querySelector('a[href$="/upload"]').getAttribute('href')`),'/m3/general/materials/upload');
  assert.equal(await evaluate(`!!document.querySelector('.m3-page-actions .m3-trash-button')`),true,'Trash button in the header');
  await clickText('Move to Trash');assert.equal(await evaluate(`window.confirmCalls`),1);assert.equal(await evaluate(`window.removeCalls`),0);
  assert.match(await evaluate(`window.confirmText`),/Nothing is erased/);await layout(`${width}-independent-library`);
  await nav('role=teacher');assert.equal(await evaluate(`!!document.querySelector('.m3-personal-library')`),false);assert.equal(await evaluate(`!!document.querySelector('.m3-trash-button')`),false,'no Trash for Teachers');
  assert.equal(await evaluate(`document.querySelector('a[href*="#question-sets"]').getAttribute('href')`),'/m3/teacher/materials/material#question-sets');
  await nav('detail=1');await until(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Confirm Text')`);
  assert.equal(await evaluate(`document.body.textContent.includes('Up to five new question sets')`),false);
  await clickText('Confirm Text');await until(`document.body.textContent.includes('Generate Questions')`);
  await clickText('Generate Questions');await until(`!!document.querySelector('[role="alert"]')`);
  assert.equal(await evaluate(`document.querySelector('[role="alert"]').textContent`),"We couldn't generate a new question set. Please try again.");await layout(`${width}-personal-failure`);
  await nav('detail=1&role=teacher');await until(`document.body.textContent.includes('Saved Set One')`);
  { const cols=await evaluate(`getComputedStyle(document.querySelector('.m3-detail-summary')).gridTemplateColumns.split(' ').length`);
    assert.equal(cols,width>1080?4:width>560?2:1,`Teacher material card keeps the shared grid at ${width}px`);
    assert.equal(await evaluate(`!!document.querySelector('.m3-personal-material')`),false); }
  await clickText('+ Generate New Question Set');await until(`!!document.querySelector('[role="alert"]')`);
  const body=await evaluate(`document.body.innerText`);assert.ok(body.includes("We couldn't generate a new question set. Please try again."));assert.ok(body.includes('Saved Set One'));assert.ok(body.includes('View Questions'));assert.doesNotMatch(body,/Gemini|API_KEY|gemini-model|internal provider/);await layout(`${width}-saved-sets-failure`);
 }
 for(const state of ['empty','loading']){await nav('state='+state);assert.ok((await evaluate(`document.body.innerText`)).includes(state==='empty'?'No uploaded materials yet':'Loading uploaded materials...'));checks++;}
 await nav('detail=1&reviewed=true&status=429');await until(`document.body.textContent.includes('Generate Questions')`);await clickText('Generate Questions');await until(`!!document.querySelector('[role="alert"]')`);assert.match(await evaluate(`document.querySelector('[role="alert"]').textContent`),/limit has been reached/);checks++;
 await nav('detail=1&reviewed=true&saved=1');await until(`document.body.textContent.includes('Start Comprehension')`);assert.ok((await evaluate(`document.body.textContent`)).includes('Read Again'));checks++;
 assert.deepEqual(blocked,[]);console.log(JSON.stringify({checks,blocked,captures},null,2));
}finally{ws?.close();chrome?.kill();await vite.close();}
