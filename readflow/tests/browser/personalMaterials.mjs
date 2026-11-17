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
 const clickIn=async(scope,text)=>evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope+' button,'+scope+' a')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing control: '+${JSON.stringify(text)});e.click()})()`);
 const fits=async label=>{assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),true,label+': no horizontal scroll');};
 const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await pause(150);};
 // 1. Check and edit the extracted text (before practice), then confirm it.
 await navigate(page);await until(`document.body.textContent.includes('Check the text below. You can edit it if something is incorrect.')`);
 assert.equal(await evaluate(`!!document.querySelector('a[href*="read-aloud"]')`),false,'no Read Aloud before the text is confirmed');
 assert.equal(await evaluate(`document.body.textContent.includes('readable text')`),false,'no technical extraction note');
 await until(`document.body.textContent.includes('Ana reeds a book.')`);await shot('review');
 await click('Edit Text');await until(`!!document.querySelector('.m3-practice-editor textarea')`);
 await evaluate(`(()=>{const t=document.querySelector('.m3-practice-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(story)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await shot('edit');await click('Save Changes');await until(`document.body.textContent.includes('Your changes are saved')`);
 const row=(await db.query('select content_text,raw_extracted_text from public.uploaded_materials where id=$1',[material])).rows[0];
 assert.equal(row.content_text,story,'corrected text saved');assert.equal(row.raw_extracted_text,extracted,'original extraction unchanged');
 assert.equal(await evaluate(`document.querySelector('.m3-practice-text').textContent`),story);
 await click('Confirm Text');await until(`document.body.textContent.includes('Generate Questions')`);
 // Reopening a confirmed, unchanged text never asks again.
 await navigate(page);await until(`document.body.textContent.includes('Generate Questions')`);
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Confirm Text')`),false);
 // 2. Generate, then preview: questions and choices only, nothing started.
 await click('Generate Questions');await until(`document.body.textContent.includes('Preview Questions')`);
 assert.equal(generationCalls,1);assert.equal(await evaluate(`document.body.textContent.includes('The first sentence tells us')`),false);
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Edit Text')`),false,'without personal_material_3 the text is locked once practice starts');
 assert.equal(await evaluate(`document.body.textContent.includes('You already practiced with this text, so it stays as it is.')`),true);
 assert.equal(await evaluate(`document.body.textContent.includes('Review your questions before starting comprehension.')`),true);
 assert.equal(await evaluate(`[...document.querySelectorAll('a,button')].some(e=>/Regenerate Questions|Edit Questions|Create My Own/i.test(e.textContent))`),false,'without personal_material_3 there is no Regenerate; editing and manual creation are never offered');
 await click('Preview Questions');await until(`document.body.textContent.includes('Your question set · 9 questions')`);
 for(const secret of['The first sentence tells us','Read the first sentence.'])assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(secret)})`),false,secret);
 assert.equal(await evaluate(`document.querySelectorAll('.m3-question-preview__item').length`),9);
 assert.equal(await evaluate(`document.body.textContent.includes('Read the text aloud first')`),true);
 assert.deepEqual(await history(),{readings:0,sets:1,attempts:0},'preview starts nothing');await shot('preview');
 await viewport(390,844);await fits('preview 390');await shot('preview-mobile');await viewport(1366,1000);
 await navigate(page);await until(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='Read Aloud')`);
 await click('Read Aloud');await until(`document.querySelector('.story-text') || document.body.textContent.includes('Ana reads a book.')`);
 assert.equal(await evaluate(`document.body.textContent.includes('Back to Learning Room')`),false);await shot('reading');
 // A fixture transcript exercises the real save/scoring route; this is not a provider/microphone test.
 const source=await (await fetch('http://127.0.0.1:'+api.address().port+'/api/oral-reading/materials/'+material)).json();
 const readingResponse=await fetch('http://127.0.0.1:'+api.address().port+'/api/oral-reading/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({materialId:material,passageRevision:source.module.passageRevision,submissionId:id(700),transcript:story,durationSeconds:15})});
 assert.equal(readingResponse.status,201,await readingResponse.clone().text());
 // The preview now offers Start Comprehension, still without starting anything.
 await navigate(page+'/questions');await until(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='Start Comprehension')`);
 assert.equal((await history()).attempts,0);
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
 assert.equal(await evaluate(`document.body.textContent.includes('You already answered these questions, so they stay the same.')`),true,'completed lock message');
 const before=await history();
 // 3. Library: Move to Trash (confirmation; Keep cancels), Trash list, Restore. Real routes and SQL.
 await navigate('/m3/general/materials');await until(`document.body.textContent.includes('Move to Trash') && document.body.textContent.includes('My personal story')`);
 assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Delete')`),false);
 assert.equal(await evaluate(`!!document.querySelector('a[href$="?edit=1"]')`),true,'Edit Text link');
 await click('Move to Trash');await until(`document.querySelector('dialog[open]')?.textContent.includes('to Trash?')`);
 const dialogText=await evaluate(`document.querySelector('dialog[open]').textContent`);
 for(const phrase of['Move "My personal story" to Trash?','Nothing is erased','restore it from Trash'])assert.ok(dialogText.includes(phrase),phrase+" || DIALOG: "+dialogText);
 await shot('trash-confirmation');await clickIn('dialog[open]','Keep material');await until(`!document.querySelector('dialog[open]')`);
 assert.deepEqual(await evaluate('window.removedMaterials'),[]);
 await click('Move to Trash');await until(`document.querySelector('dialog[open]')?.textContent.includes('to Trash?')`);await clickIn('dialog[open]','Move to Trash');
 await until(`document.body.textContent.includes('My personal story was moved to Trash.')`);
 assert.deepEqual(await evaluate('window.removedMaterials'),[material]);
 assert.equal(await count('select count(*)::int n from public.personal_material_state where material_id=$1 and deleted_at is not null'),1);
 await until(`![...document.querySelectorAll('.m3-record-card h2')].some(e=>e.textContent==='My personal story')`);
 assert.equal(await evaluate(`document.querySelector('.m3-trash-button__count').textContent`),'1','Trash count');
 assert.ok(await evaluate(`(()=>{const a=document.querySelector('.m3-page-actions');const t=a.querySelector('.m3-trash-button'),u=[...a.querySelectorAll('a')].find(e=>e.textContent.includes('Upload Material'));return t.compareDocumentPosition(u)&Node.DOCUMENT_POSITION_FOLLOWING;})()`),'Trash sits left of Upload Material');
 await evaluate(`document.querySelector('.m3-trash-button').click()`);await until(`document.body.textContent.includes('Moved to Trash') && document.body.textContent.includes('My personal story')`);
 await shot('trash');await viewport(320,640);await fits('trash 320');await shot('trash-mobile');await viewport(1366,1000);
 assert.deepEqual(await history(),before,'Trash erases nothing');
 await click('Restore');await until(`document.body.textContent.includes('My personal story is back in My Materials.')`);
 assert.equal(await count('select count(*)::int n from public.personal_material_state where material_id=$1 and deleted_at is not null'),0);
 await until(`document.body.textContent.includes('Trash is empty')`);
 assert.equal(await evaluate(`document.querySelector('.m3-trash-button__count').textContent`),'0');
 await click('Back to My Materials');await until(`[...document.querySelectorAll('.m3-record-card h2')].some(e=>e.textContent==='My personal story')`);
 assert.deepEqual(await history(),before,'Restore keeps readings, questions and the completed assessment');
 await navigate(page);await until(`document.body.textContent.includes('View Comprehension Result')`);
 assert.equal(await evaluate(`!![...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='Start Comprehension')`),false,'still one assessment');
 const summaryFills=`(()=>{const g=document.querySelector('.m3-personal-material .m3-detail-summary');const r=g.getBoundingClientRect();
  const cells=[...g.children].map(c=>c.getBoundingClientRect());const cols=getComputedStyle(g).gridTemplateColumns.split(' ').length;
  return {cells:cells.length,cols,fills:cells.every(c=>Math.abs(Math.max(...cells.filter(x=>Math.abs(x.top-c.top)<2).map(x=>x.right))-r.right)<=2)};})()`;
 for(const [w,h] of [[320,640],[390,844],[768,1024],[1366,1000]]){await viewport(w,h);await fits('material '+w);
  const s=await evaluate(summaryFills);assert.equal(s.cells,3,'Source, File type, Status');assert.ok(s.fills,`material card has no empty column at ${w}px: ${JSON.stringify(s)}`);
  assert.equal(s.cols,w<=560?1:3,`columns at ${w}px`);await shot('material-card-'+w);}
 await viewport(390,844);await shot('mobile');
 await navigate('/m3/general/materials');await until(`document.body.textContent.includes('Move to Trash')`);
 for(const [w,h] of [[320,640],[390,844],[768,1024],[1366,1000]]){await viewport(w,h);await fits('library '+w);}
 console.log('PASS browser: edit extracted text (original kept), confirm, private generation, read-only preview (no answers, nothing started), M5 source/save, M6 start/submission/completion, answer secrecy, Move to Trash with confirmation, Trash list, Restore with history kept, one assessment kept, 320/390/768/1366 layouts');
 assert.equal(errors.length,0,errors.join('\n'));
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,generationCalls,provider:'mock',microphone:'not exercised'},null,2));
}finally{await send('Browser.close').catch(()=>{});ws.close();chrome.kill();await vite.close();await new Promise(r=>api.close(r));await db.close();}
