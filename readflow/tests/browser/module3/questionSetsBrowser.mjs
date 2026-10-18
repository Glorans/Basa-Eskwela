// Real React pages + production Express routes/services. Auth/Gemini/DB transport
// are isolated fixtures. SQL preservation/RLS/rollback is tested separately in staging.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
const express = require('../../../../server/node_modules/express');
const { multiPagePdf } = require('../../../../server/tests/fixtures/multiPageDocuments');
const { materialFinalizeBody } = require('../../../../server/services/materialFinalizeBody');
const { createMaterialsRouter } = require('../../../../server/routes/materials');
const { SupabaseAuthenticationError } = require('../../../../server/services/supabaseAdmin');
const { createDatabase, material, generatedQuestions, requester, TEACHER_A, MATERIAL_A, MATERIAL_B } = require('../../../../server/tests/fixtures/materialDatabase');
const root = path.resolve('readflow');
const output = path.join(os.tmpdir(), 'readflow-m3-question-sets-browser');
fs.mkdirSync(output, { recursive: true });
const db = createDatabase({ uploaded_materials: [material(MATERIAL_A, TEACHER_A, 'Life in the Countryside'), material(MATERIAL_B, TEACHER_A, 'Material B')],
  profiles: [{ id: TEACHER_A, role: 'teacher', full_name: 'Fixture Teacher' }] });
const storage = new Map();
db.storage.from = () => ({info:async key=>({data:storage.get(key),error:null}),remove:async()=>({error:null})});
const originalFrom = db.from.bind(db);
db.from = table => {
  const query = originalFrom(table), insert = query.insert.bind(query), execute = query.execute.bind(query);
  query.insert = value => insert(table==='uploaded_materials' ? {id:randomUUID(),created_at:new Date().toISOString(),...value} : value);
  query.execute = async () => {const result=await execute(); if(query.action==='insert'&&query.singleMode&&Array.isArray(result.data))result.data=result.data[0];return result;};
  return query;
};
let counter = 0, failNext = false;
const legacyReviewOnly = process.argv.includes('--legacy-review-only');
let failReview = legacyReviewOnly;
const reviewCalls = [];
const deleteModalOnly = process.argv.includes('--delete-modal-only');
const addQuestions = (setId, materialId) => {
  const rows = generatedQuestions().map((q,i) => ({ id: randomUUID(), material_id: materialId, question_set_id: setId,
    question_type:q.type,question_text:q.questionText+' version '+(++counter),options:q.options,scaffolding_hint:q.scaffoldingHint,review_status:'generated',display_order:i+1 }));
  db.tables.comprehension_questions.push(...rows);
  db.tables.comprehension_question_answers.push(...rows.map(q=>({question_id:q.id,correct_answer:q.options[0]})));
};
db.rpc = async (name, args) => {
  assert.equal(name,'m3_write_material_question_set');
  if (legacyReviewOnly && ['approve', 'save'].includes(args.operation)) {
    reviewCalls.push(args.operation);
    return {error:{code:'22023',message:'Invalid question set operation'}};
  }
  if (args.operation==='review') {
    reviewCalls.push(args.operation);
    if (failReview) { failReview=false; return {error:{code:'40001',message:'Approval failed. Please retry.'}}; }
  }
  let set=db.tables.material_question_sets.find(s=>s.id===args.target_set&&s.material_id===args.target_material);
  if(args.operation==='create') {
    const n=db.tables.material_question_sets.filter(s=>s.material_id===args.target_material).length+1;
    set={id:randomUUID(),material_id:args.target_material,name:'Question Set '+n,sequence_number:n,revision:0};
    db.tables.material_question_sets.push(set);
  } else if(!set||set.revision!==args.expected_revision) return {error:{code:'40001',message:'Reload changed set.'}};
  if(args.operation==='delete') {
    await db.from('comprehension_questions').delete().eq('material_id',args.target_material).eq('question_set_id',set.id);
    await db.from('material_question_sets').delete().eq('material_id',args.target_material).eq('id',set.id);
    return {data:set.id,error:null};
  }
  if(args.operation==='save'||args.operation==='approve'||args.operation==='review') {
    for(const draft of args.bank) {
      const q=db.tables.comprehension_questions.find(q=>q.id===draft.id&&q.question_set_id===set.id);
      assert.ok(q);
      if(args.operation==='approve') { q.review_status='reviewed'; continue; }
      const key=db.tables.comprehension_question_answers.find(a=>a.question_id===q.id);
      key.correct_answer=draft.options[q.options.indexOf(key.correct_answer)];
      Object.assign(q,{question_text:draft.questionText,options:draft.options,scaffolding_hint:draft.scaffoldingHint,question_type:draft.type,review_status:args.operation==='review'?'reviewed':'generated'});
    }
  } else {
    await db.from('comprehension_questions').delete().eq('question_set_id',set.id);
    addQuestions(set.id,args.target_material);
  }
  set.revision++;
  return {data:set.id,error:null};
};
await db.rpc('m3_write_material_question_set',{operation:'create',target_material:MATERIAL_A});
const set1=db.tables.material_question_sets[0].id;
const snapshot=id=>JSON.stringify(db.tables.comprehension_questions.filter(q=>q.question_set_id===id));
const first=snapshot(set1);
const api=express();
api.put('/fixture-storage/:owner/:file',express.raw({type:()=>true,limit:'25mb'}),(req,res)=>{
  storage.set(req.params.owner+'/'+req.params.file,{size:req.body.length,contentType:req.headers['content-type']});res.json({success:true});
});
api.post('/api/materials/finalize',materialFinalizeBody);
api.use(express.json());
api.use('/api/materials',createMaterialsRouter({
  getSupabaseAdmin:()=>db,
  authorizeMaterialRequest:async req=>{if(req.headers.authorization!=='Bearer fixture-teacher')throw new SupabaseAuthenticationError();return requester(TEACHER_A,'teacher');},
  generateComprehensionQuestions:async()=>{ if(failNext){failNext=false; throw new Error('Fixture provider unavailable');} await new Promise(r=>setTimeout(r,150)); return generatedQuestions(); },
}));
const apiServer=api.listen(0,'127.0.0.1');await new Promise(r=>apiServer.once('listening',r));
const harness=path.join(root,'tests/browser/module3/questionSetsHarness.tsx').replaceAll('\\','/');
const vite=await createServer({root,configFile:false,envFile:false,optimizeDeps:{entries:['tests/browser/module3/questionSetsHarness.tsx']},plugins:[
 {name:'isolated-m3-harness',enforce:'pre',resolveId(id){
   if(id.endsWith('/context/M3ContentContext')||id.endsWith('/hooks/useAuthenticatedProfile')||id.endsWith('/lib/supabaseClient'))return harness;
 },configureServer(server){server.middlewares.use(async (req,res,next)=>{if(req.url?.startsWith('/m3/')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/tests/browser/module3/questionSetsHarness.tsx"></script></body></html>'));}else next();});}},
 react({ jsxRuntime:'automatic' })],define:{'import.meta.env.VITE_API_URL':JSON.stringify('http://127.0.0.1:5187')},
 server:{host:'127.0.0.1',port:5187,strictPort:true,proxy:{'/api': 'http://127.0.0.1:'+apiServer.address().port,'/fixture-storage':'http://127.0.0.1:'+apiServer.address().port}}});
await vite.listen();
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=9237','--user-data-dir='+path.join(output,'chrome-profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let target;
for(let i=0;i<100;i++){try{target=await(await fetch('http://127.0.0.1:9237/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(100);}}
assert.ok(target,'Headless Chrome must start');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let next=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function until(expression){for(let i=0;i<200;i++){if(await evaluate(expression))return;await pause(50);}throw Error('Timeout '+expression+' '+errors.join(' | '));}
const click=async text=>{await evaluate(`(()=>{const el=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Missing control');el.click()})()`);};
const navigate=async url=>{await send('Page.navigate',{url:'http://127.0.0.1:5187'+url});};
const materialUrl='/m3/teacher/materials/'+MATERIAL_A;
const cards=n=>`document.querySelectorAll('#question-sets article').length===${n}`;
const reports=[];
function passed(name){reports.push(name);console.log('PASS:',name);}
try{
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
 await navigate(materialUrl);await until(`document.body.textContent.includes('Sign in as fixture Teacher')`);await click('Sign in as fixture Teacher');await until(cards(1));
 assert.equal(snapshot(set1),first);passed('Existing six questions appear in Question Set 1 unchanged');
 if(legacyReviewOnly) {
   await navigate(materialUrl+'/question-sets/'+set1+'/edit');
   await until(`document.querySelectorAll('.m3-question-editor').length===6`);
   const saveDisabled = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Save Changes')).disabled`;
   assert.equal(await evaluate(saveDisabled),true);
   const keysBefore=structuredClone(db.tables.comprehension_question_answers);
   const questionsBefore=structuredClone(db.tables.comprehension_questions);
   await click('Mark as Reviewed');
   await until(`document.body.textContent.includes('Approval failed. Please retry.')`);
   assert.equal(snapshot(set1),first);
   assert.equal(await evaluate(`document.body.textContent.includes('Needs Review')`),true);
   assert.equal(await evaluate(`document.body.textContent.includes('marked as reviewed.')`),false);
   passed('Failed approval stays Needs Review, preserves content and offers retry');
   await click('Mark as Reviewed');
   await until(`document.body.textContent.includes('marked as reviewed.')`);
   assert.equal(await evaluate(saveDisabled),true);
   assert.deepEqual(db.tables.comprehension_questions,questionsBefore.map(q=>({...q,review_status:'reviewed'})));
   assert.deepEqual(db.tables.comprehension_question_answers,keysBefore);
   assert.deepEqual(reviewCalls,['approve','review','approve','review']);
   const summaries=await (await fetch('http://127.0.0.1:'+apiServer.address().port+'/api/materials/'+MATERIAL_A+'/question-sets',
     {headers:{Authorization:'Bearer fixture-teacher'}})).json();
   assert.equal(summaries.sets.find(s=>s.id===set1).reviewStatus,'reviewed');
   passed('Legacy review approves unchanged questions and exposes Reviewed status to M4');
   assert.deepEqual(errors,[]);
 } else if(deleteModalOnly) {
   await click('Delete Set');await until(`!!document.querySelector('[role=dialog]')`);
   assert.equal(await evaluate(`document.activeElement?.textContent.trim()`),'Cancel');
   assert.ok(await evaluate(`document.querySelector('[role=dialog]').textContent.includes('Delete Question Set 1? Its questions and answer keys will be permanently deleted.')`));
   await click('Cancel');await until(`!document.querySelector('[role=dialog]')`);
   assert.equal(snapshot(set1),first);passed('Delete modal opens with focus and Cancel preserves the set');
   await click('Delete Set');await until(`!!document.querySelector('[role=dialog]')`);
   await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent.trim()==='Delete Set').click()`);
   await until(cards(0));
   assert.equal(db.tables.material_question_sets.length,0);
   assert.equal(db.tables.comprehension_questions.length,0);
   assert.equal(db.tables.comprehension_question_answers.length,0);
   assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`),false);
   passed('Delete confirmation removes the selected set and closes the modal');
 } else {
 await click('+ Generate New Question Set');await until(cards(2));
 await click('+ Generate New Question Set');await until(cards(3));
 assert.equal(snapshot(set1),first);passed('New Sets 2 and 3 preserve Set 1');
 const [one,two,three]=db.tables.material_question_sets;
 for(const set of [two,three])assert.deepEqual(['literal','inferential','critical'].map(type=>db.tables.comprehension_questions.filter(q=>q.question_set_id===set.id&&q.question_type===type).length),[2,2,2]);
 await send('Page.reload');await until(cards(3));passed('All three sets survive browser refresh');
 await click('Materials');await until(`document.body.textContent.includes('3 saved question sets')`);await click('View Question Sets');await until(cards(3));passed('Material list counts and navigation persist');
 await click('Sign out');await until(`document.body.textContent.includes('Sign in as fixture Teacher')`);await click('Sign in as fixture Teacher');await until(cards(3));passed('Fixture logout/login reloads all three sets from server');
 await navigate(materialUrl+'/question-sets/'+two.id+'/edit');await until(`document.querySelectorAll('.m3-question-editor').length===6`);
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Save Changes')).disabled`),true);
 const contentBefore=structuredClone(db.tables.comprehension_questions.filter(q=>q.question_set_id===two.id));
 const keysBefore=structuredClone(db.tables.comprehension_question_answers);
 await click('Mark as Reviewed');await until(`document.body.textContent.includes('marked as reviewed.')`);
 assert.deepEqual(db.tables.comprehension_questions.filter(q=>q.question_set_id===two.id),contentBefore.map(q=>({...q,review_status:'reviewed'})));
 assert.deepEqual(db.tables.comprehension_question_answers,keysBefore);
 passed('Approves without edits while Save Changes is disabled; content and answers are unchanged');
 const thirdBefore=snapshot(three.id),idsBefore=db.tables.comprehension_questions.filter(q=>q.question_set_id===two.id).map(q=>q.id);
 await evaluate(`(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Edited Set 2 question');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await click('Save Changes');await until(`document.body.textContent.includes('Changes saved.')`);
 assert.ok(db.tables.comprehension_questions.filter(q=>q.question_set_id===two.id).some(q=>q.review_status==='generated'));
 await click('Mark as Reviewed');await until(`document.body.textContent.includes('marked as reviewed.')`);
 await navigate(materialUrl);await until(cards(3));await navigate(materialUrl+'/question-sets/'+two.id);
 await until(`document.querySelector('textarea')?.value==='Edited Set 2 question'`);
 assert.equal(snapshot(set1),first);assert.equal(snapshot(three.id),thirdBefore);assert.deepEqual(db.tables.comprehension_questions.filter(q=>q.question_set_id===two.id).map(q=>q.id),idsBefore);passed('Set 2 edit survives reopening, preserves IDs and isolates Sets 1 and 3');
 const secondAfter=snapshot(two.id);
 await navigate(materialUrl+'/question-sets/'+three.id);await until(`document.querySelectorAll('.m3-question-editor').length===6`);
 await click('Regenerate This Set');await until(`document.body.textContent.includes('Regenerating will replace ONLY Question Set 3')`);await click('Cancel');
 assert.equal(snapshot(three.id),thirdBefore);passed('Inline Cancel does not change saved questions');
 await click('Regenerate This Set');await click('Regenerate This Set');await until(`document.body.textContent.includes('Question Set 3 regenerated and saved.')`);
 assert.notEqual(snapshot(three.id),thirdBefore);assert.equal(snapshot(set1),first);assert.equal(snapshot(two.id),secondAfter);passed('Regenerating Set 3 preserves Sets 1 and 2');
 await navigate('/m3/teacher/materials/'+MATERIAL_B);await until(`document.body.textContent.includes('No saved question sets yet.')`);
 assert.equal(await evaluate(`document.querySelectorAll('#question-sets article').length`),0);passed('Material B cannot display Material A sets');
 await navigate(materialUrl);await until(cards(3));failNext=true;await click('+ Generate New Question Set');await until(`!!document.querySelector('[role=alert]')`);
 assert.equal(db.tables.material_question_sets.length,3);passed('Generation failure is inline and preserves all sets');
 assert.equal(await evaluate(`document.querySelectorAll('[role=dialog],[aria-modal=true]').length`),0);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(output,'saved-sets-mobile.png'),Buffer.from(shot.data,'base64'));
 assert.deepEqual(errors,[]);passed('No dialogs, browser exceptions, or mobile horizontal overflow');
 // Real three-page upload/extraction, edited save and reopened persisted material.
 const pdfPath=path.join(output,'three-page-reading.pdf');
 fs.writeFileSync(pdfPath,multiPagePdf(['PAGE ONE READING','PAGE TWO READING','PAGE THREE READING']));
 await navigate('/m3/teacher/materials/upload');
 await until(`!!document.querySelector('input[type=file]')`);
 await evaluate(`(()=>{const e=document.querySelector('input[placeholder="Give this reading material a title"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Browser Three Page Material');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const documentNode=await send('DOM.getDocument');
 const fileNode=await send('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'input[type=file]'});
 await send('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[pdfPath]});
 await click('Upload & Extract Text');
 await until(`!!document.querySelector('textarea')`);
 assert.equal(await evaluate('document.querySelector("textarea").value'),'PAGE ONE READING\n\nPAGE TWO READING\n\nPAGE THREE READING');
 assert.equal(await evaluate(`[...document.querySelectorAll('dl div')].find(d=>d.textContent.includes('Pages detected'))?.querySelector('dd')?.textContent`),'3');
 const approved='PAGE ONE READING\n\nPAGE TWO EDITED READING\n\nPAGE THREE READING';
 await evaluate(`(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(approved)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const previewShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(output,'multi-page-preview.png'),Buffer.from(previewShot.data,'base64'));
 await click('Save Material');
 await until(`document.body.textContent.includes('My Uploaded Materials') && document.body.textContent.includes('Browser Three Page Material')`);
 const uploaded=db.tables.uploaded_materials.find(m=>m.title==='Browser Three Page Material');
 assert.ok(uploaded);assert.equal(uploaded.content_text,approved);assert.equal(uploaded.raw_extracted_text,'PAGE ONE READING\n\nPAGE TWO READING\n\nPAGE THREE READING');
 const uploadedUrl='/m3/teacher/materials/'+uploaded.id;
 await navigate(uploadedUrl);await until(`document.body.textContent.includes('PAGE THREE READING')`);
 await send('Page.reload');await until(`document.body.textContent.includes('PAGE TWO EDITED READING')`);
 await click('Materials');await until(`document.body.textContent.includes('My Uploaded Materials')`);
 await navigate(uploadedUrl);await until(`document.body.textContent.includes('PAGE THREE READING')`);
 await click('Sign out');await until(`document.body.textContent.includes('Sign in as fixture Teacher')`);await click('Sign in as fixture Teacher');await until(`document.body.textContent.includes('PAGE TWO EDITED READING')`);
 assert.equal(uploaded.content_text,approved);passed('Real three-page PDF extraction, Teacher edit and save survive refresh, navigation and fixture sign-out/sign-in');
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:reports,limitations:'Fixture auth, Gemini, and database transport; real database migration/RLS tested separately.'},null,2));
 console.log('BROWSER_REPORT:',output);
}finally{
 await send('Browser.close').catch(()=>{});ws.close();chrome.kill();
 await vite.close();await new Promise(r=>apiServer.close(r));
}
