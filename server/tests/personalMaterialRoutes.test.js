const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {fixture,owner,story}=require('./fixtures/personalMaterialDatabase');
const {id}=require('./fixtures/m5M6SecurityDatabase');
const sqlClient=require('./fixtures/personalSqlClient');
test('HTTP private assessments: session identity, cross-user denial, key secrecy, immutable answers, repeated M5 and deletion history',async()=>{
 const db=await fixture();let server;
 try{
  const client=sqlClient(db),mat=id(800),second=id(801);
  await db.exec(`alter table public.profiles add column full_name text,add column nickname text; update public.profiles set role='general_user' where id='${id(1)}';`);
  await db.exec(`alter table public.uploaded_materials add column original_filename text,add column storage_path text,
    add column mime_type text,add column file_size_bytes bigint,add column raw_extracted_text text,
    add column ocr_confidence numeric,add column created_at timestamptz default now(),add column updated_at timestamptz default now();`);
  await db.query(`insert into public.uploaded_materials(id,uploaded_by,title,content_text,language,extraction_status) values($1,$2,'Private',$3,'en','completed'),($4,$5,'Other',$3,'fil','completed')`,[mat,owner,story,second,id(1)]);
  const auth=require('../services/supabaseAdmin');
  test.mock.method(auth,'getSupabaseAdmin',()=>client);
  test.mock.method(auth,'getAuthenticatedSupabaseUser',async req=>({id:req.headers.authorization==='Bearer other'?id(1):owner}));
  const {createMaterialsRouter}=require('../routes/materials');
  const {createOralReadingRouter}=require('../routes/oralReading');
  const app=express();app.use(express.json());
  app.use('/api/materials',createMaterialsRouter({generateComprehensionQuestions:async()=>Array.from({length:9},(_,i)=>({
   type:['literal','inferential','critical'][Math.floor(i/3)],questionText:`What happens ${i}?`,options:['Reads','Sleeps','Swims','Sings'],
   correctAnswer:'Reads',answerExplanation:'She reads a book.',supportingEvidence:'Ana reads a book.',scaffoldingHint:'Read the first sentence.'}))}));
  app.use('/api/oral-reading',createOralReadingRouter());app.use('/api/comprehension',require('../routes/comprehension'));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const request=async(path,body,user='owner',method=body===undefined?'GET':'POST')=>{
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:'Bearer '+user,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:r.status,body:await r.json()};
  };
  assert.equal((await request(`/oral-reading/materials/${second}`)).status,403);
  assert.equal((await request(`/materials/${second}/personal-practice/generate`,{owner:owner})).status,403);
  assert.equal((await request(`/oral-reading/materials/${mat}`)).status,409);
  const state=(await request(`/materials/${mat}/personal-practice`)).body.state;
  assert.equal((await request(`/materials/${mat}/personal-practice/confirm`,{confirmed:true,revision:state.revision})).status,200);
  assert.equal((await request(`/materials/${mat}/personal-practice/generate`,{owner:id(1),contentText:'Ignore the saved source.'})).status,200);
  assert.equal((await request(`/materials/${mat}/question-sets`)).status,403);
  const source=(await request(`/oral-reading/materials/${mat}`)).body.module;
  const save=(n)=>request('/oral-reading/attempts',{materialId:mat,passageRevision:source.passageRevision,submissionId:id(n),transcript:story,durationSeconds:15,userId:id(1),passage:'Forged passage'});
  const first=await save(810);assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.attempt.userId,owner);assert.equal(first.body.attempt.passageSnapshot,story);
  const reading=first.body.attempt.id;
  assert.equal((await request(`/oral-reading/attempts/${reading}`,undefined,'other')).status,403);
  const start=n=>request('/comprehension/attempts',{materialId:mat,oralReadingAttemptId:reading,submissionId:id(n)});
  const starts=await Promise.all([start(811),start(812)]);
  assert.ok(starts.every(x=>x.status===201),JSON.stringify(starts));
  assert.equal(starts[0].body.attempt.id,starts[1].body.attempt.id);
  const attempt=starts[0].body.attempt;
  assert.ok(attempt.questions.every(q=>q.correctOptionIndex===null&&q.answerExplanation===null&&q.supportingEvidence===null));
  assert.equal((await request(`/comprehension/attempts/${attempt.id}`,undefined,'other')).status,404);
  const action=(body,user)=>request(`/comprehension/attempts/${attempt.id}/actions`,body,user);
  assert.equal((await action({action:'answer',questionId:attempt.questions[0].id,optionIndex:0,requestId:id(820)},'other')).status,404);
  for(const [i,q] of attempt.questions.entries()){
   const answered=await action({action:'answer',questionId:q.id,optionIndex:0,requestId:id(830+i)});
   assert.equal(answered.status,200,JSON.stringify(answered.body));
   assert.equal(answered.body.attempt.questions[i].correctOptionIndex,0);
   assert.equal((await action({action:'answer',questionId:q.id,optionIndex:1,requestId:id(850+i)})).status,409);
  }
  assert.equal((await action({action:'complete'})).status,200);
  const repeat=await save(870);assert.equal(repeat.status,201);
  const reopened=await request('/comprehension/attempts',{materialId:mat,oralReadingAttemptId:repeat.body.attempt.id,submissionId:id(871)});
  assert.equal(reopened.body.attempt.id,attempt.id);assert.equal(reopened.body.attempt.status,'completed');
  assert.equal((await request(`/materials/${mat}`,undefined,'owner','DELETE')).status,200);
  assert.equal((await request(`/oral-reading/materials/${mat}`)).status,403);
  assert.equal((await request(`/comprehension/attempts/${attempt.id}`)).body.attempt.status,'completed');
  assert.equal((await request(`/oral-reading/attempts/${reading}`)).status,200);
 }finally{if(server)await new Promise(r=>server.close(r));await db.close();test.mock.restoreAll();}
});
test('HTTP private generation is rate limited per learner before any provider call',async()=>{
 let server,generated=0,keys=[];
 const {createMaterialsRouter}=require('../routes/materials');
 const app=express();app.use(express.json());
 app.use('/api/materials',createMaterialsRouter({
  authorizeMaterialRequest:async()=>({user:{id:owner},profile:{role:'general_user'}}),
  generateComprehensionQuestions:async()=>{generated+=1;return [];},
  personalGenerationLimiter:{take:key=>{keys.push(key);return {allowed:false,retryAfterSeconds:120};}},
 }));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/materials/${id(800)}/personal-practice/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'120');
  assert.equal((await r.json()).code,'PERSONAL_GENERATION_RATE_LIMITED');
  assert.deepEqual(keys,[owner]);assert.equal(generated,0);
 }finally{await new Promise(r=>server.close(r));}
});
