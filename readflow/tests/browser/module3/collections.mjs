// Isolated browser acceptance test: mocked persistence, no application .env or Supabase connections.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import Editor from '/src/modules/module3/components/AdminCollectionEditor.tsx';
import '/src/modules/module3/styles/module3.css';
createRoot(document.getElementById('root')).render(<BrowserRouter><main style={{maxWidth:900,padding:16}}><Routes>
<Route path='/m3/admin/modules/new' element={<Editor mode='create'/>}/>
<Route path='/m3/admin/modules/:moduleId/edit' element={<Editor mode='edit'/>}/>
<Route path='/m3/admin/modules/:moduleId' element={<Editor mode='detail'/>}/>
</Routes></main></BrowserRouter>);`;
const service = `
const bank=['literal','literal','inferential','inferential','critical','critical'].map((type,i)=>({id:'q'+i,type,questionText:'Question '+i,options:['A','B','C','D'],correctAnswer:'A',scaffoldingHint:'Read',reviewStatus:'generated'}));
window.stored={id:'module',title:'Collection',learningPathId:'path',difficulty:'Easy',revision:1,status:'draft',publishedAt:null,language:'en',passages:[
{id:'first',title:'First',passageText:'First story',sourceMaterialId:null,displayOrder:1,questions:bank},
{id:'second',title:'Second',passageText:'Second story',sourceMaterialId:null,displayOrder:2,questions:[]}]};
window.calls=[];
export const loadCollection=async()=>structuredClone(window.stored);
export const saveCollection=async(c,removed)=>{window.calls.push({action:'save',removed});window.stored=structuredClone({...c,revision:c.revision+1});};
export const saveBank=async(c,p,action)=>{window.calls.push({action});window.stored.passages.find(v=>v.id===p.id).questions=action==='delete'?[]:p.questions.map(q=>({...q,reviewStatus:'reviewed'}));window.stored.revision++;};
export const generateBank=async(c,id)=>{window.stored.passages.find(p=>p.id===id).questions=structuredClone(bank);window.stored.revision++;};
export const collectionError=e=>e.message;
export const passageRepository={createDraft:async(id,c)=>{window.stored={...structuredClone(c),id};window.calls.push({action:'create'});},getPublishIssues:async()=>['Passage 2 needs reading text']};`;
const server = await createServer({ root, configFile:false, envDir: fileURLToPath(new URL('.', import.meta.url)), server:{host:'127.0.0.1',port:5181,strictPort:true},plugins:[{
  name:'collections-fixture',enforce:'pre',
  resolveId(id) {
    if(id==='/collections-fixture.tsx')return '\0fixture.tsx';
    if(id.endsWith('/context/M3ContentContext'))return '\0context';
    if(id.endsWith('/services/adminCollectionService'))return '\0service';
    if(id.endsWith('/services/adminModuleExtraction'))return '\0extraction';
  },
  async load(id) {
    if(id==='\0fixture.tsx')return (await transformWithEsbuild(fixture, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code;
    if(id==='\0context')return "export const useM3Content=()=>({learningPaths:[{id:'path',name:'English',language:'en'}],refreshModules:async()=>{window.refreshedStatus=window.stored.status;},publishModule:async()=>{if(window.publicationError)throw Error(window.publicationError);if(window.publicationIssue)return {ok:false,message:window.publicationIssue};window.stored.status='published';window.stored.publishedAt='2026-10-07';return {ok:true};},learningPathsLoading:false,learningPathsError:null});";
    if(id==='\0service')return service;
    if(id==='\0extraction')return "export const ADMIN_MODULE_FILE_ACCEPT='.txt';export const extractAdminModulePassage=async(input,callback,signal)=>window.deferExtraction?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Cancelled')))):({extractedText:'Extracted selected text'});";
  },
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/m3/'))return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/fixture.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/collections-fixture.tsx"></script></body></html>'));});}
},react()] });
const profile = await mkdtemp(join(tmpdir(),'readflow-collections-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9227',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  await server.listen();
  let target;
  for(let i=0;i<100;i++){try{target=await(await fetch('http://127.0.0.1:9227/json/new?about:blank',{method:'PUT'})).json();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(target,'Chrome available'); ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let next=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+expression+' '+await evaluate('document.body.innerText'));}
  async function click(label,index=0){await evaluate(`[...document.querySelectorAll('button')].filter(b=>b.textContent===${JSON.stringify(label)})[${index}].click()`);await new Promise(r=>setTimeout(r,50));}
  async function input(selector,value){await evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);await new Promise(r=>setTimeout(r,50));}
  await send('Runtime.enable');await send('Page.navigate',{url:'http://127.0.0.1:5181/m3/admin/modules/module/edit'});
  await until('document.querySelectorAll("section").length===2');
  assert.ok(await evaluate('document.body.innerText.includes("2 passages • 6 questions")'));
  await input('section:nth-of-type(2) textarea','Edited second');
  await click('Save Draft'); await until('window.stored.passages[1].passageText==="Edited second"');
  assert.equal(await evaluate('window.stored.passages[0].passageText'),'First story');
  await click('Move Up',1);await click('Save Draft');
  assert.deepEqual(await evaluate('window.stored.passages.map(p=>p.id)'),['second','first']);
  await click('+ Add Passage Below',1);assert.equal(await evaluate('document.querySelectorAll("section").length'),3);
  await evaluate('window.confirm=()=>false');await click('Remove Passage',2);
  assert.equal(await evaluate('document.querySelectorAll("section").length'),3,'cancel preserves passage');
  await evaluate('window.confirm=()=>true');await click('Remove Passage',2);await click('Save Draft');
  assert.deepEqual(await evaluate('window.calls.at(-1).removed'),[],'unsaved removal is not sent as persisted deletion');
  await evaluate(`{const e=document.querySelector('input[type=file]');const d=new DataTransfer();d.items.add(new File(['text'],'passage.txt',{type:'text/plain'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until('document.querySelector("section textarea").value==="Extracted selected text"');await click('Save Draft');
  assert.equal(await evaluate('window.stored.passages[1].passageText'),'First story');
  await evaluate(`window.deferExtraction=true;{const e=document.querySelector('input[type=file]');const d=new DataTransfer();d.items.add(new File(['text'],'cancel.txt',{type:'text/plain'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until('document.body.innerText.includes("Cancel Extraction")');await click('Cancel Extraction');
  await until('!document.body.innerText.includes("Cancel Extraction")');
  assert.equal(await evaluate('document.querySelector("section textarea").value'),'Extracted selected text');
  await evaluate('document.querySelector("details").open=true');
  await input('details textarea','Reviewed question');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Save Draft").disabled'),true);
  await click('Save Reviewed Questions');await until('window.stored.passages[1].questions[0].questionText==="Reviewed question"');
  assert.equal(await evaluate('window.stored.passages[1].questions[0].reviewStatus'),'reviewed');
  await click('Validate for Publication');await until('document.body.innerText.includes("Passage 2 needs reading text")');
  await evaluate("window.publicationIssue='Passage 1 has questions that need review'");
  await click('Publish Module');await until('document.body.innerText.includes("questions that need review")');
  assert.equal(await evaluate('window.stored.status'),'draft');
  await evaluate("window.publicationIssue=null;window.publicationError='Database publication denied'");
  await click('Publish Module');await until('document.body.innerText.includes("Database publication denied")');
  assert.equal(await evaluate('window.stored.status'),'draft');
  await evaluate('window.publicationError=null');await click('Publish Module');
  await until('document.body.innerText.includes("Module published successfully.")');
  assert.ok(await evaluate('document.querySelector(".m3-editor-badge").textContent.startsWith("Published")'));
  assert.equal(await evaluate('window.refreshedStatus'),'published','Content Management refreshed');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b=>b.textContent==="Publish Module")'),false);
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=375'),'no mobile horizontal overflow');
  await send('Page.navigate',{url:'http://127.0.0.1:5181/m3/admin/modules/new'});
  await until('document.body.innerText.includes("Create Reading Module")');
  assert.equal(await evaluate('document.querySelectorAll("section").length'),1,'new draft starts with one passage');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=375'),'create layout fits mobile');
  assert.equal(await evaluate('document.querySelector("input").getBoundingClientRect().height'),44,'compact input height');
  await input('input','Draft');await evaluate(`{const s=document.querySelector('select');s.value='path';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await click('+ Add Passage Below');await click('Save Draft');await until('window.calls.some(c=>c.action==="create")');
  assert.equal(await evaluate('window.stored.passages[0].passageText'),'','incomplete draft saves');
  assert.deepEqual(errors,[]);
  console.log('PASS browser: counts, isolated edit/extraction, reorder, unsaved removal, review, draft saving, validation and mobile width');
} finally {ws?.close();chrome.kill();await server.close();}
