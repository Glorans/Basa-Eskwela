// Run with a temporary Chrome instance listening on localhost:9226:
// node tests/browser/module3/contentManagement.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import Module3Page from '/src/modules/module3/pages/Module3Page.tsx';
import M3Layout from '/src/modules/module3/components/M3Layout.tsx';
import {M3ContentProvider,useM3Content} from '/src/modules/module3/context/M3ContentContext';
import '/src/index.css';
function CatalogProbe(){const {modules,studentModules}=useM3Content();return <output hidden data-teacher-catalog={modules.map(m=>m.id).join(',')} data-learner-catalog={studentModules.map(m=>m.id).join(',')}/>;}
createRoot(document.getElementById('root')).render(<BrowserRouter><M3ContentProvider><CatalogProbe/><Routes><Route path='/m3/admin' element={<M3Layout role="admin"/>}><Route index element={<Module3Page/>}/></Route></Routes></M3ContentProvider></BrowserRouter>);
`;
const server = await createServer({root,configFile:false,server:{host:'127.0.0.1',port:5180,strictPort:true},plugins:[{
 name:'admin-content-fixture',enforce:'pre',
 resolveId(id){
  if(id==='/content-fixture.tsx')return '\0content-fixture.tsx';
  if(id.endsWith('/services/moduleService') || id==='../services/moduleService')return '\0module-service';
  if(id.endsWith('/services/materialService'))return '\0material-service';
  if(id.endsWith('/hooks/useAuthenticatedProfile'))return '\0profile';
  if(id.endsWith('/lib/supabaseClient'))return '\0supabase';
 },
 async load(id){
  if(id==='\0content-fixture.tsx')return (await transformWithEsbuild(fixture,'content-fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;
  if(id==='\0profile')return "export default ()=>({profile:{role:'admin',full_name:'Admin'},loading:false});";
  if(id==='\0supabase')return "export const supabase={auth:{signOut:async()=>({})}};";
  if(id==='\0material-service')return "export const getMaterials=async()=>[];export const deleteMaterial=async()=>{};export const getMaterialServiceError=(e,f)=>e?.message||f;";
  if(id==='\0module-service')return `
   const rows=[['draft','Garden story','en','draft',null],['published','Forest story','fil','published','2026-10-01'],['archived','River story','en','archived',null],['locked','Old draft','fil','draft','2026-09-01']].map(([id,title,language,status,publishedAt])=>({id,title,language,status,publishedAt,readingLevel:'Instructional',difficulty:'Medium',learningPath:'Reading Path',questionCount:12,createdAt:id==='archived'?'':'2026-10-01T00:00:00Z'}));
   const current=()=>JSON.parse(sessionStorage.getItem('modules')||'null')||rows;
   const mode=new URLSearchParams(location.search).get('mode');let loads=0;window.actionCalls=[];
   export async function getModules(){loads++;if(mode==='loading')return new Promise(()=>{});if(mode==='error'&&loads===1)throw Error('Unable to load modules.');return mode==='empty'?[]:current();}
   export const getLearningPaths=async()=>[];
   export const getModuleById=async id=>current().find(m=>m.id===id);
   export const getModuleErrorMessage=(e,f)=>e?.message||f;
   async function mutate(action,id){window.actionCalls.push([action,id]);await new Promise(r=>setTimeout(r,100));
     if(mode==='denied'&&action==='delete')throw Error('Database permission denied while deleting this module (42501): Admin access is required to delete reading modules');
     const next=action==='delete'?current().filter(m=>m.id!==id):current().map(m=>m.id===id?{...m,status:action==='archive'?'archived':'draft'}:m);
     sessionStorage.setItem('modules',JSON.stringify(next));return action==='delete'?(id==='locked'?'soft':'permanent'):next.find(m=>m.id===id);
   }
   export const deleteModule=id=>mutate('delete',id);
   export const archiveModule=id=>mutate('archive',id);
   export const restoreModule=id=>mutate('restore',id);
   export const createModule=async()=>{};export const updateModule=async()=>{};export const publishModule=async()=>{};export const unpublishModule=async()=>{};
  `;
 },
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(!req.url.startsWith('/m3/admin'))return next();
  const html=await server.transformIndexHtml('/fixture.html','<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/content-fixture.tsx"></script></body></html>');
  res.setHeader('Content-Type','text/html');res.end(html);
 });}
},react()]});
let ws;
try {
  await server.listen();
  const target=await(await fetch('http://127.0.0.1:9226/json/new?about:blank',{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let nextId=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
  async function until(expression){for(let n=0;n<200;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression+' '+errors.join('\n')+' '+await evaluate('document.body.innerText'));}
  await send('Runtime.enable');await send('Page.enable');
  const navigate=async mode=>{await send('Page.navigate',{url:'http://127.0.0.1:5180/m3/admin'+(mode?'?mode='+mode:'')});await until("!!document.querySelector('.m3-admin-content')");if(mode!=='loading')await until("!document.body.textContent.includes('Loading reading modules...')");};
  await navigate('');
  assert.equal(await evaluate("document.querySelector('h1').textContent"),'Content Management');
  assert.equal(await evaluate("document.querySelectorAll('.m3-record-card').length"),4);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.m3-admin-module-summary strong')].map(n=>n.textContent)"),['2','1','1']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.m3-admin-module-actions a[href$=edit]')].map(n=>n.getAttribute('href'))"),['/m3/admin/modules/draft/edit']);
  assert.equal(await evaluate("!!document.querySelector('a[href=\"/m3/admin/modules/new\"]')"),true);
  assert.equal(await evaluate("document.querySelector('.m3-record-card').textContent.includes('Reading Path')"),true);
  assert.equal(await evaluate("document.querySelector('.m3-record-card').textContent.includes('Oct 1, 2026')"),true);
  assert.equal(await evaluate("document.body.textContent.includes('Not available')"),true);
  const select=async(index,value)=>{await evaluate(`(()=>{const s=document.querySelectorAll('.m3-filter-group select')[${index}];s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
  await select(0,'draft');await select(1,'fil');
  await until("document.querySelectorAll('.m3-record-card').length===1");
  assert.equal(await evaluate("document.querySelector('.m3-record-card h2').textContent"),'Old draft');
  await evaluate(`(()=>{const s=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,' GARDEN ');s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until("document.body.textContent.includes('No matching modules')");
  await select(1,'en');await until("document.querySelectorAll('.m3-record-card').length===1");
  assert.equal(await evaluate("document.querySelector('.m3-record-card h2').textContent"),'Garden story');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.m3-admin-module-summary strong')].map(n=>n.textContent)"),['2','1','1']);
  await navigate('');
  for(const width of [390,1366]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600});
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(path.join(tmpdir(),`readflow-admin-content-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  await navigate('empty');assert.equal(await evaluate("document.body.textContent.includes('No reading modules yet')"),true);
  await navigate('loading');assert.equal(await evaluate("document.body.textContent.includes('Loading reading modules...')"),true);
  await navigate('error');assert.equal(await evaluate("!!document.querySelector('[role=alert]')"),true);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Try Again').click()");
  await until("document.querySelectorAll('.m3-record-card').length===4");
  await navigate('');
  const clickAction=async label=>evaluate(`document.querySelector('button[aria-label="${label}"]').click()`);
  await evaluate("(()=>{const b=document.querySelector('button[aria-label=\"Delete Garden story\"]');b.click();b.click();})()");
  assert.equal(await evaluate("document.querySelector('dialog')"),null);
  await until("document.querySelectorAll('.m3-record-card').length===3");
  assert.deepEqual(await evaluate('window.actionCalls'),[['delete','draft']]);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.m3-admin-module-summary strong')].map(n=>n.textContent)"),['1','1','1']);
  await send('Page.reload');await until("document.querySelectorAll('.m3-record-card').length===3");
  assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Delete Garden story\"]')"),false);
  await clickAction('Delete Old draft');await until("document.querySelectorAll('.m3-record-card').length===2");
  assert.match(await evaluate("document.querySelector('[role=status]').textContent"),/Existing assignments and reading history were preserved/);
  await clickAction('Delete Forest story');await until("document.querySelectorAll('.m3-record-card').length===1");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.m3-admin-module-summary strong')].map(n=>n.textContent)"),['0','0','1']);
  assert.equal(await evaluate("document.querySelector('[data-learner-catalog]').dataset.learnerCatalog"),'');
  assert.equal(await evaluate("document.querySelector('[data-teacher-catalog]').dataset.teacherCatalog"),'archived');
  await evaluate("sessionStorage.removeItem('modules')");
  await navigate('denied');
  await clickAction('Delete Garden story');await until("!!document.querySelector('[role=alert]')");
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"),/42501.*Admin access is required/);
  assert.equal(await evaluate("document.querySelectorAll('.m3-record-card').length"),4);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.m3-admin-module-summary strong')].map(n=>n.textContent)"),['2','1','1']);
  await navigate('');
  await clickAction('Archive Forest story');
  await until("!!document.querySelector('button[aria-label=\"Restore Forest story\"]')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.m3-admin-module-summary strong')].map(n=>n.textContent)"),['2','0','2']);
  await clickAction('Restore Forest story');
  await until("!!document.querySelector('button[aria-label=\"Archive Forest story\"]')===false && document.querySelectorAll('.m3-admin-module-summary strong')[0].textContent==='3'");
  assert.equal(await evaluate("!!document.querySelector('a[aria-label=\"Edit Forest story\"]')"),false);
  await evaluate("sessionStorage.removeItem('modules')");
  assert.deepEqual(errors,[]);
  console.log('PASS: Admin content list, metadata, totals, combined filters, eligible draft links, create/detail routes, empty/loading/error/retry states, one-click deletion, failed deletion, fixture refresh persistence, archive/restore, immediate counts and mobile/laptop widths.');
  await send('Page.close');
} finally {ws?.close();await server.close();}
