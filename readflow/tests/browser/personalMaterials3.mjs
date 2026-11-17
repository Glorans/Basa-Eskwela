// Local browser check WITH the proposed personal_material_3 migration applied to the disposable SQL (not Staging):
// edit text after practice, outdated questions, Regenerate Questions, and the unfinished-assessment locks.
// Real pages/routes/services + disposable SQL. Auth and Gemini are fixtures.
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
await db.exec(fs.readFileSync(path.resolve('supabase/proposed/personal_material_3_text_edits_and_new_questions_PROPOSED.sql'),'utf8'));
await db.exec(`alter table public.uploaded_materials add column original_filename text,add column storage_path text,add column mime_type text,
 add column file_size_bytes bigint,add column raw_extracted_text text,add column ocr_confidence numeric,add column created_at timestamptz default now(),add column updated_at timestamptz default now();`);
// The extraction has a mistake ("reeds") that the learner corrects; the original extraction must stay unchanged.
const extracted='Ana reeds a book. She shares the book with her friend.';
await db.query(`insert into public.uploaded_materials(id,uploaded_by,title,content_text,raw_extracted_text,language,extraction_status,original_filename,mime_type,file_size_bytes)
 values($1,$2,'My personal story',$3,$3,'en','completed','story.pdf','application/pdf',2048)`,[material,owner,extracted]);
// The shared fixture also holds a minimal older upload for this learner; give it the NOT NULL values real rows always have.
await db.query(`update public.uploaded_materials set title='Older upload',original_filename='older.pdf',mime_type='application/pdf',language='en',extraction_status='completed' where uploaded_by=$1 and id<>$2`,[owner,material]);
const count=async(sql)=>(await db.query(sql,[material])).rows[0].n;
const history=async()=>({readings:await count('select count(*)::int n from public.oral_reading_attempts where material_id=$1'),
 sets:await count('select count(*)::int n from public.personal_material_question_sets where material_id=$1'),
 attempts:await count('select count(*)::int n from public.m6_comprehension_attempts where material_id=$1')});
const client=require('../../../server/tests/fixtures/personalSqlClient')(db);
await client.rpc('personal_material_access',{actor:owner,material,operation:'metadata',missing_pages:[2]});
const auth=require('../../../server/services/supabaseAdmin');
auth.getSupabaseAdmin=()=>client;
auth.getAuthenticatedSupabaseUser=async()=>({id:owner});
const requester={user:{id:owner},profile:{role:'general_user'}};
let generationCalls=0;
const express=require('../../../server/node_modules/express');const app=express();app.use(express.json());
app.use('/api/materials',require('../../../server/routes/materials').createMaterialsRouter({authorizeMaterialRequest:async()=>requester,getSupabaseAdmin:()=>client,
 generateComprehensionQuestions:async()=>{generationCalls++;return Array.from({length:9},(_,i)=>({type:['literal','inferential','critical'][Math.floor(i/3)],questionText:`Set ${generationCalls}: what did Ana do in question ${i+1}?`,options:['Read a book.','Go swimming.','Go singing.','Go sleeping.'],correctAnswer:'Read a book.',scaffoldingHint:'Read the first sentence.',answerExplanation:'The first sentence tells us she reads.',supportingEvidence:'She shares the book with her friend.'}));}}));
app.use('/api/oral-reading',require('../../../server/routes/oralReading').createOralReadingRouter({authorizeOralReadingRequest:async()=>requester,getSupabaseAdmin:()=>client}));
app.use('/api/comprehension',require('../../../server/routes/comprehension'));
const api=app.listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));
const root=path.resolve('readflow'), output=path.resolve('.tmp/personal-browser-3');fs.mkdirSync(output,{recursive:true});
const harness=path.join(root,'tests/browser/personalMaterialsHarness.tsx').replaceAll('\\','/');
const vite=await createServer({root,configFile:false,envFile:false,optimizeDeps:{entries:['tests/browser/personalMaterialsHarness.tsx']},plugins:[{name:'private-local-fixture',enforce:'pre',resolveId(name){
 if(name.endsWith('/lib/supabaseClient'))return path.join(root,'tests/browser/personalMaterialsAuth.ts').replaceAll('\\','/');
 if(name.endsWith('/context/M3ContentContext')||name.endsWith('/hooks/useAuthenticatedProfile'))return harness;
},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.startsWith('/m3/')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/browser/personalMaterialsHarness.tsx"></script></body></html>'));}else next();});}},react()],
 define:{'import.meta.env.VITE_API_URL':JSON.stringify('http://127.0.0.1:5195')},server:{host:'127.0.0.1',port:5195,strictPort:true,proxy:{'/api':'http://127.0.0.1:'+api.address().port}}});await vite.listen();
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=9245','--user-data-dir='+path.join(output,'chrome-profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let target;
for(let i=0;i<100;i++){try{target=await(await fetch('http://127.0.0.1:9245/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(100);}}
assert.ok(target,'Chrome started');const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let serial=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description);if(m.method==='Log.entryAdded')console.log('BROWSER',m.params.entry.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')console.log('CONSOLE',m.params.args.map(a=>a.value??a.description));});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++serial;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function until(expression){for(let i=0;i<160;i++){if(await evaluate(expression))return;await pause(75);}throw Error('Timeout: '+expression+' '+errors.join(' | ')+' HTML: '+await evaluate('document.documentElement.outerHTML')+' RESOURCES: '+await evaluate('JSON.stringify(performance.getEntriesByType("resource").map(x=>x.name))'));}
const click=async text=>evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing control: '+${JSON.stringify(text)});e.click()})()`);
const navigate=async suffix=>{await send('Page.navigate',{url:'http://127.0.0.1:5195'+suffix});};
const page='/m3/general/materials/'+material;
const shot=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
try{
 const clickIn=async(scope,text)=>evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope+' button,'+scope+' a')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing control: '+${JSON.stringify(text)});e.click()})()`);
 const fits=async label=>{assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),true,label+': no horizontal scroll');};
 const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await pause(150);};
 const has=text=>evaluate(`document.body.textContent.includes(${JSON.stringify(text)})`);
 const readAloud=async(text,n)=>{const source=await (await fetch('http://127.0.0.1:'+api.address().port+'/api/oral-reading/materials/'+material)).json();
  const r=await fetch('http://127.0.0.1:'+api.address().port+'/api/oral-reading/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({materialId:material,passageRevision:source.module.passageRevision,submissionId:id(n),transcript:text,durationSeconds:15})});
  assert.equal(r.status,201,await r.clone().text());return (await r.json()).attempt;};
 await send('Page.enable');await send('Runtime.enable');await viewport(1366,1000);
 // Practice with the extracted text: confirm, questions, a reading.
 await navigate(page);await until(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Confirm Text')`);
 await click('Confirm Text');await until(`document.body.textContent.includes('Generate Questions')`);
 await click('Generate Questions');await until(`document.body.textContent.includes('Preview Questions')`);
 const firstReading=await readAloud(extracted,701);
 // Edit after practice: Edit Text stays available; the saved reading keeps its text.
 await navigate(page);await until(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Edit Text')`);
 await click('Edit Text');await until(`!!document.querySelector('.m3-practice-editor textarea')`);
 await evaluate(`(()=>{const t=document.querySelector('.m3-practice-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(story)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await click('Save Changes');await until(`document.body.textContent.includes('Your changes are saved')`);
 assert.equal((await db.query('select passage_snapshot from public.oral_reading_attempts where id=$1',[firstReading.id])).rows[0].passage_snapshot,extracted,'saved reading unchanged');
 assert.equal((await db.query('select raw_extracted_text from public.uploaded_materials where id=$1',[material])).rows[0].raw_extracted_text,extracted,'original extraction kept');
 await click('Confirm Text');await until(`document.body.textContent.includes('Your text changed, so you need new questions.')`);
 assert.equal(await evaluate(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='View Reading Result')`),false,'read the new text aloud again');
 await shot('outdated');await viewport(390,844);await fits('outdated 390');await viewport(1366,1000);
 // New questions for the new text, then Regenerate Questions (confirmation; Keep cancels).
 await click('Generate Questions');await until(`document.body.textContent.includes('Preview Questions')`);
 assert.equal(generationCalls,2);
 await click('Preview Questions');await until(`document.body.textContent.includes('Set 2: what did Ana do in question 1?')`);
 assert.equal(await has('Review your questions before starting comprehension.'),true);
 assert.equal(await evaluate(`document.querySelectorAll('.m3-question-preview__type').length`),9,'question type shown');
 await click('Regenerate Questions');await until(`document.querySelector('dialog[open]')?.textContent.includes('Regenerate your questions?')`);
 await shot('new-questions-confirmation');await clickIn('dialog[open]','Keep my questions');await until(`!document.querySelector('dialog[open]')`);
 assert.equal(generationCalls,2,'Keep cancels');
 await click('Regenerate Questions');await until(`document.querySelector('dialog[open]')?.textContent.includes('Regenerate your questions?')`);
 await clickIn('dialog[open]','Regenerate Questions');await until(`document.body.textContent.includes('Your new questions are ready.')`);
 assert.equal(generationCalls,3);assert.equal(await has('Set 3: what did Ana do in question 1?'),true);assert.equal(await has('Set 2: what did'),false);
 assert.equal((await db.query('select count(*)::int n from public.personal_material_question_sets where material_id=$1 and replaced_at is not null',[material])).rows[0].n,1,'the replaced set is kept');
 for(const secret of['The first sentence tells us','Read the first sentence.'])assert.equal(await has(secret),false,secret);
 assert.equal((await db.query('select count(*)::int n from public.m6_comprehension_attempts where material_id=$1',[material])).rows[0].n,0,'nothing started');
 for(const [w,h] of [[320,640],[390,844],[768,1024],[1366,1000]]){await viewport(w,h);await fits('preview '+w);}
 await shot('preview-new');
 // Regenerate from Step 2 on the material page too (same confirmation, same limits).
 await navigate(page);await until(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Regenerate Questions')`);
 assert.equal(await evaluate(`[...document.querySelectorAll('a,button')].some(e=>/Edit Questions|Create My Own/i.test(e.textContent))`),false,'no question editing or manual creation');
 await click('Regenerate Questions');await until(`document.querySelector('dialog[open]')?.textContent.includes('Regenerate your questions?')`);
 await clickIn('dialog[open]','Regenerate Questions');await until(`document.body.textContent.includes('Your new questions are ready.')`);
 assert.equal(generationCalls,4);
 for(const [w,h] of [[320,640],[390,844]]){await viewport(w,h);await fits('step 2 '+w);}await viewport(1366,1000);
 // Start the assessment: no new questions, and the text is locked until it is finished.
 const reading=await readAloud(story,702);
 const started=await fetch('http://127.0.0.1:'+api.address().port+'/api/comprehension/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({materialId:material,oralReadingAttemptId:reading.id,submissionId:id(703)})});
 assert.equal(started.status,201,await started.clone().text());
 await navigate(page+'/questions');await until(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='Resume Comprehension')`);
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Regenerate Questions')`),false,'no regeneration once started');
 assert.equal(await has('Your comprehension has started, so these questions are locked until you finish.'),true);
 await navigate(page);await until(`document.body.textContent.includes('Finish your comprehension first. Then you can edit the text.')`);
 assert.equal(await has('Your comprehension has started, so these questions are locked until you finish.'),true,'Step 2 lock message');
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Regenerate Questions')`),false);
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Edit Text')`),false);
 for(const [w,h] of [[320,640],[390,844],[768,1024],[1366,1000]]){await viewport(w,h);await fits('material '+w);}
 await shot('locked');
 console.log('PASS browser (personal_material_3 applied to the disposable SQL): edit after practice with the saved reading unchanged, outdated questions, Regenerate Questions with confirmation from the preview and Step 2 (replaced sets kept), preview types, no answers, nothing started, start locks new questions and text edits, 320/390/768/1366 layouts');
 assert.equal(errors.length,0,errors.join('\n'));
}finally{await send('Browser.close').catch(()=>{});ws.close();chrome.kill();await vite.close();await new Promise(r=>api.close(r));await db.close();}
