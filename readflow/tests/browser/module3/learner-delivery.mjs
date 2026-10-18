// Isolated UI regression: actual viewers, loader and passage repository; synthetic
// authenticated read responses. No application .env, Supabase, or publication changes.
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
import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';
import Student from '/src/pages/StudentModuleViewPage.tsx';
import Detail from '/src/modules/module3/pages/ModuleDetailPage.tsx';
createRoot(document.getElementById('root')).render(<BrowserRouter>
<Link to={location.pathname.startsWith('/dashboard')?'/dashboard/materials/one':'/m3/general/modules/one'}>Other module</Link>
<Routes>
<Route path='/dashboard/materials/:moduleId' element={<Student/>}/>
<Route path='/m3/general/modules/:moduleId' element={<Detail role='general_user'/>}/>
</Routes></BrowserRouter>);`;
const context = `
import {loadStudentModuleDetail} from '/src/modules/module3/services/studentModuleDetail.ts';
import {createModulePassageRepository} from '/src/modules/module3/services/modulePassageService.ts';
window.reads=[];
const child=(module_id,id,display_order)=>({id,module_id,display_order,title:'Title '+id,passage_text:'Text '+id+'\\nSecond line',source_material_id:null,created_at:'',updated_at:''});
const repository=createModulePassageRepository({from(table){
  if(table!=='module_passages')throw Error('Unexpected read '+table);
  let moduleId;
  return {select(){return this;},eq(key,value){if(key!=='module_id')throw Error('Missing module filter');moduleId=value;return this;},
    async order(key,options){
      if(key!=='display_order'||!options.ascending)throw Error('Missing order');
      window.reads.push({table,moduleId});
      if(moduleId==='error')return {data:null,error:Error('Denied passage read')};
      if(moduleId==='slow')await new Promise(resolve=>setTimeout(resolve,400));
      return {error:null,data:moduleId==='legacy'?[]:moduleId==='multi'?
        [child(moduleId,'third',3),child(moduleId,'first',1),child(moduleId,'second',2)]:[child(moduleId,moduleId+'-first',1)]};
    }};
}});
const getStudentModule=id=>loadStudentModuleDetail(id,{
  getModuleById:async id=>{
    window.reads.push({table:'modules',moduleId:id});
    if(id==='missing')return undefined;
    return {id,title:'Module '+id,status:id==='draft'?'draft':id==='archived'?'archived':'published',
      difficulty:'Easy',learningPathId:'path',learningPath:'English',language:'en',readingLevel:'Independent',
      difficultyTier:'Easy',createdAt:'2026-10-07',passage:'Legacy text\\nExact spacing.',questionCount:6};
  },getPassages:repository.getPassages});
export const useM3Content=()=>({getStudentModule});`;

const server = await createServer({root, configFile:false,
  envDir:fileURLToPath(new URL('.',import.meta.url)),
  server:{host:'127.0.0.1',port:5182,strictPort:true},plugins:[{
    name:'learner-fixture',enforce:'pre',
    resolveId(id){
      if(id==='/learner-fixture.tsx')return '\0learner-fixture.tsx';
      if(id.endsWith('/context/M3ContentContext'))return '\0learner-context';
      if(id.endsWith('/components/AdminCollectionEditor'))return '\0unused-admin';
    },
    async load(id){
      if(id==='\0learner-fixture.tsx')return (await transformWithEsbuild(fixture,'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;
      if(id==='\0learner-context')return context;
      if(id==='\0unused-admin')return "export default function Admin(){throw Error('Unexpected admin viewer');}";
    },
    configureServer(s){s.middlewares.use(async(req,res,next)=>{
      if(!/^\/(dashboard|m3)\//.test(req.url))return next();
      res.setHeader('Content-Type','text/html');
      res.end(await s.transformIndexHtml('/fixture.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/learner-fixture.tsx"></script></body></html>'));
    });}
  },react()]});
const profile = await mkdtemp(join(tmpdir(),'readflow-learner-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9228',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  await server.listen();
  let target;
  for(let i=0;i<100;i++){
    try{target=await(await fetch('http://127.0.0.1:9228/json/new?about:blank',{method:'PUT'})).json();break;}
    catch{await new Promise(r=>setTimeout(r,100));}
  }
  assert.ok(target,'Chrome available');ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let next=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',e=>{
    const m=JSON.parse(e.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;
  };
  async function until(expression){
    for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}
    throw Error('Timeout '+expression+' '+await evaluate('document.body.innerText'));
  }
  const button=label=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  async function navigate(path){await send('Page.navigate',{url:'http://127.0.0.1:5182'+path});}
  const articleId='document.querySelector("article")?.dataset.passageId';
  await send('Runtime.enable');
  for(const prefix of ['/dashboard/materials','/m3/general/modules']){
    await navigate(prefix+'/one');await until(`${articleId}==='one-first'`);
    assert.equal(await evaluate('document.querySelector("article h2").textContent'),'Title one-first');
    assert.equal(await evaluate('document.querySelector("article p").textContent'),'Text one-first\nSecond line');
    assert.equal(await evaluate('document.querySelectorAll("nav.basa-passage-navigation").length'),0);
    assert.equal(await evaluate('document.querySelector("a.basa-reading-module-back").getAttribute("href")'),prefix);
    assert.equal(await evaluate('document.querySelector(".basa-reading-module-actions a").getAttribute("href")'),prefix+'/one/read-aloud');

    await navigate(prefix+'/multi');await until(`${articleId}==='first'`);
    assert.ok(await evaluate('document.body.innerText.includes("Passage 1 of 3")'));
    assert.equal(await evaluate(button('Previous')+'.disabled'),true);
    for(const [id,count] of [['second',2],['third',3]]){
      await evaluate(button('Next')+'.click()');await until(`${articleId}===${JSON.stringify(id)}`);
      assert.equal(await evaluate('document.querySelector("article h2").textContent'),'Title '+id);
      assert.ok(await evaluate(`document.body.innerText.includes('Passage ${count} of 3')`));
    }
    assert.equal(await evaluate(button('Next')+'.disabled'),true);
    for(const id of ['second','first']){
      await evaluate(button('Previous')+'.click()');await until(`${articleId}===${JSON.stringify(id)}`);
    }
    assert.equal(await evaluate('document.querySelectorAll("input,textarea,select,form").length'),0);
    assert.equal(await evaluate('/question|score|submit|completion/i.test(document.body.innerText)'),false);
    assert.deepEqual(await evaluate('window.reads.map(r=>r.table)'),['modules','module_passages']);
    await evaluate(button('Next')+'.click()');await until(`${articleId}==='second'`);
    await evaluate('document.querySelector("a").click()');await until(`${articleId}==='one-first'`);

    await navigate(prefix+'/legacy');await until('!!document.querySelector("article")');
    assert.equal(await evaluate(articleId),undefined);
    assert.equal(await evaluate('document.querySelector("article p").textContent'),'Legacy text\nExact spacing.');
    assert.equal(await evaluate('document.querySelectorAll("button").length'),0);
    for(const id of ['draft','archived','missing']){
      await navigate(prefix+'/'+id);await until('document.body.innerText.includes("Reading module not found")');
      assert.equal(await evaluate('document.querySelector("article")'),null);
      assert.deepEqual(await evaluate('window.reads.map(r=>r.table)'),['modules']);
    }
    await navigate(prefix+'/error');await until('document.body.innerText.includes("Unable to load")');
    assert.equal(await evaluate('document.querySelector("article")'),null);
    await navigate(prefix+'/slow');await until('document.body.innerText.includes("Loading reading module")');
    await evaluate('document.querySelector("a").click()');await until(`${articleId}==='one-first'`);
    await new Promise(r=>setTimeout(r,500));
    assert.equal(await evaluate(articleId),'one-first','late previous-route result ignored');
    console.log('PASS learner browser:',prefix,'single, ordered multiple, navigation, route reset, legacy, access/errors, read-only');
  }
  assert.deepEqual(errors,[]);
} finally {ws?.close();chrome.kill();await server.close();}
