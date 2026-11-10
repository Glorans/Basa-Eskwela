// Local browser check: real pages/routes/services + disposable SQL. Auth and Gemini are fixtures.
// No real provider, remote database, microphone recording or production session is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const require=createRequire(import.meta.url);
const {fixture,owner,story}=require('../../../server/tests/fixtures/personalMaterialDatabase');
const {id}=require('../../../server/tests/fixtures/m5M6SecurityDatabase');
const db=await fixture();const material=id(500);
await db.exec('alter table public.profiles add column full_name text, add column nickname text;');
await db.query(`insert into public.uploaded_materials(id,uploaded_by,title,content_text,language,extraction_status) values($1,$2,'My personal story',$3,'en','completed')`,[material,owner,story]);
const client=require('../../../server/tests/fixtures/personalSqlClient')(db);
await client.rpc('personal_material_access',{actor:owner,material,operation:'metadata',missing_pages:[2]});
const auth=require('../../../server/services/supabaseAdmin');
auth.getSupabaseAdmin=()=>client;
auth.getAuthenticatedSupabaseUser=async()=>({id:owner});
const requester={user:{id:owner},profile:{role:'general_user'}};
let generationCalls=0;
const express=require('../../../server/node_modules/express');const app=express();app.use(express.json());
app.use('/api/materials',require('../../../server/routes/materials').createMaterialsRouter({authorizeMaterialRequest:async()=>requester,getSupabaseAdmin:()=>client,
 generateComprehensionQuestions:async()=>{generationCalls++;return Array.from({length:9},(_,i)=>({type:['literal','inferential','critical'][Math.floor(i/3)],questionText:`What did Ana do in question ${i+1}?`,options:['Read a book.','Go swimming.','Go singing.','Go sleeping.'],correctAnswer:'Read a book.',scaffoldingHint:'Read the first sentence.',answerExplanation:'The first sentence tells us she reads.',supportingEvidence:'Ana reads a book.'}));}}));
app.use('/api/oral-reading',require('../../../server/routes/oralReading').createOralReadingRouter({authorizeOralReadingRequest:async()=>requester,getSupabaseAdmin:()=>client}));
app.use('/api/comprehension',require('../../../server/routes/comprehension'));
const api=app.listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));
const root=path.resolve('readflow'), output=path.resolve('.tmp/personal-browser');fs.mkdirSync(output,{recursive:true});
const harness=path.join(root,'tests/browser/personalMaterialsHarness.tsx').replaceAll('\\','/');
const vite=await createServer({root,configFile:false,envFile:false,optimizeDeps:{entries:['tests/browser/personalMaterialsHarness.tsx']},plugins:[{name:'private-local-fixture',enforce:'pre',resolveId(name){
 if(name.endsWith('/lib/supabaseClient'))return path.join(root,'tests/browser/personalMaterialsAuth.ts').replaceAll('\\','/');
 if(name.endsWith('/context/M3ContentContext')||name.endsWith('/hooks/useAuthenticatedProfile'))return harness;
},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.startsWith('/m3/')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/browser/personalMaterialsHarness.tsx"></script></body></html>'));}else next();});}},react()],
 define:{'import.meta.env.VITE_API_URL':JSON.stringify('http://127.0.0.1:5193')},server:{host:'127.0.0.1',port:5193,strictPort:true,proxy:{'/api':'http://127.0.0.1:'+api.address().port}}});await vite.listen();
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=9243','--user-data-dir='+path.join(output,'chrome-profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let target;
for(let i=0;i<100;i++){try{target=await(await fetch('http://127.0.0.1:9243/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(100);}}
assert.ok(target,'Chrome started');const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let serial=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description);if(m.method==='Log.entryAdded')console.log('BROWSER',m.params.entry.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')console.log('CONSOLE',m.params.args.map(a=>a.value??a.description));});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++serial;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function until(expression){for(let i=0;i<160;i++){if(await evaluate(expression))return;await pause(75);}throw Error('Timeout: '+expression+' '+errors.join(' | ')+' HTML: '+await evaluate('document.documentElement.outerHTML')+' RESOURCES: '+await evaluate('JSON.stringify(performance.getEntriesByType("resource").map(x=>x.name))'));}
const click=async text=>evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing control: '+${JSON.stringify(text)});e.click()})()`);
const navigate=async suffix=>{await send('Page.navigate',{url:'http://127.0.0.1:5193'+suffix});};
const page='/m3/general/materials/'+material;
const shot=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
try{
 await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:1,mobile:false});
 await navigate(page);await until(`document.body.textContent.includes('Confirm reviewed text')`);
 assert.equal(await evaluate(`!!document.querySelector('a[href*="read-aloud"]')`),false);
 assert.equal(await evaluate(`document.body.textContent.includes('page(s) 2')`),true);await shot('review');
 await evaluate(`document.querySelector('input[type="checkbox"]').click()`);await click('Confirm reviewed text');await until(`document.body.textContent.includes('Generate Questions')`);
 await click('Generate Questions');await until(`document.body.textContent.includes('Private AI-validated questions ready')`);
 assert.equal(generationCalls,1);assert.equal(await evaluate(`document.body.textContent.includes('The first sentence tells us')`),false);
 await click('Read Aloud');await until(`document.querySelector('.story-text') || document.body.textContent.includes('Ana reads a book.')`);
 assert.equal(await evaluate(`document.body.textContent.includes('Back to Learning Room')`),false);await shot('reading');
 // A fixture transcript exercises the real save/scoring route; this is not a provider/microphone test.
 const source=await (await fetch('http://127.0.0.1:'+api.address().port+'/api/oral-reading/materials/'+material)).json();
 const readingResponse=await fetch('http://127.0.0.1:'+api.address().port+'/api/oral-reading/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({materialId:material,passageRevision:source.module.passageRevision,submissionId:id(700),transcript:story,durationSeconds:15})});
 assert.equal(readingResponse.status,201,await readingResponse.clone().text());
 await navigate(page);await until(`document.body.textContent.includes('Start Comprehension')`);await click('Start Comprehension');
 await until(`document.querySelector('.m6-card') && document.body.textContent.includes('Ready to answer?')`);
 await until(`![...document.querySelectorAll('p')].some(e=>e.textContent.includes('Checking your questions'))`);
 await click('Start Comprehension');await until(`document.body.textContent.includes('What did Ana do')`);await shot('questions');
 assert.equal(await evaluate(`document.body.textContent.includes('The first sentence tells us')`),false);
 for(let i=0;i<9;i++) {
  await until(`!!document.querySelector('input[type="radio"]:not(:disabled)')`);
  await evaluate(`document.querySelector('input[type="radio"]').click()`);
  await click('Submit answer');
  if(i<8) {await until(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Next Question'&&!e.disabled)`);await click('Next Question');}
 }
 await until(`document.body.textContent.includes('Your comprehension results')`);await shot('results');
 await navigate(page);await until(`document.body.textContent.includes('View Comprehension Result')`);
 assert.equal(await evaluate(`!![...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='Start Comprehension')`),false);
 assert.equal(generationCalls,1);
 // Library: Independent Learners remove (retained), with an accurate confirmation; Cancel keeps the material.
 await navigate('/m3/general/materials');await until(`document.body.textContent.includes('Remove from Reading Materials')`);
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Delete')`),false);
 await click('Remove from Reading Materials');await until(`!!document.querySelector('dialog[open]')`);
 const dialogText=await evaluate(`document.querySelector('dialog[open]').textContent`);
 for(const phrase of['Remove "My personal story" from your Reading Materials?','becomes read-only','This is not a permanent deletion','keeps the uploaded file','Completed results stay in your history'])assert.ok(dialogText.includes(phrase),phrase);
 await shot('remove-confirmation');await click('Keep material');await until(`!document.querySelector('dialog[open]')`);
 assert.deepEqual(await evaluate('window.removedMaterials'),[]);
 await click('Remove from Reading Materials');await until(`!!document.querySelector('dialog[open]')`);await click('Remove');
 await until(`document.body.textContent.includes('was removed from your Reading Materials. Its file, text and saved results are kept.')`);
 assert.deepEqual(await evaluate('window.removedMaterials'),[material]);
 await navigate(page);await until(`document.body.textContent.includes('View Comprehension Result')`);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot('mobile');
 assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true);
 console.log('PASS browser: explicit partial-text review, private generation, M5 source/save, M6 start/submission/completion, answer secrecy, saved-result return, library removal confirmation and mobile layout');
 assert.equal(errors.length,0,errors.join('\n'));
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,generationCalls,provider:'mock',microphone:'not exercised'},null,2));
}finally{await send('Browser.close').catch(()=>{});ws.close();chrome.kill();await vite.close();await new Promise(r=>api.close(r));await db.close();}
