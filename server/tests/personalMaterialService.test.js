const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,add,owner,story}=require('./fixtures/personalMaterialDatabase');
const {id}=require('./fixtures/m5M6SecurityDatabase');
const {loadPersonalReadingSource,generatePersonalQuestions,personalMaterialAccess}=require('../services/personalMaterialService');
const requester={user:{id:owner},profile:{role:'general_user'}};
function client(db) { return { async rpc(name,args) {
  const keys=Object.keys(args);
  try {
   const {rows}=await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));
   return {data:rows[0].result,error:null};
  } catch(e) {return {data:null,error:{code:e.code,message:e.message}};}
 }}; }
const generated=()=>Array.from({length:9},(_,i)=>({type:['literal','inferential','critical'][Math.floor(i/3)],questionText:`What happens ${i}?`,
 options:['She reads.','She sleeps.','She swims.','She sings.'],correctAnswer:'She reads.',scaffoldingHint:'Look at the first sentence.',
 answerExplanation:'Ana reads a book.',supportingEvidence:'Ana reads a book.'}));
test('production personal source/generator: authenticated ownership, mixed contexts, failed quota, concurrent requests and safe reuse',async()=>{
 const db=await fixture(); let calls=0;
 try {
  const mat=await add(db); const deps={getSupabaseAdmin:()=>client(db),generate:async input=>{calls++;assert.equal(input.contentText,story);assert.equal(input.language,'en');return generated();}};
  const source=await loadPersonalReadingSource(requester,mat,{},deps); assert.equal(source.passage,story);
  for(const key of ['roomId','activityAssignmentId','moduleId','passageId','assignmentId']) await assert.rejects(loadPersonalReadingSource(requester,mat,{[key]:id(100)},deps),/without classroom/);
  await assert.rejects(loadPersonalReadingSource({user:{id:id(1)},profile:{role:'general_user'}},mat,{},deps),/unavailable/);
  await assert.rejects(loadPersonalReadingSource({user:{id:owner},profile:{role:'teacher'}},mat,{},deps),/Personal practice/);
  await assert.rejects(generatePersonalQuestions(requester,mat,{...deps,generate:async()=>{throw Error('Mock timeout');}}),/Mock timeout/);
  assert.equal((await db.query('select count(*)::int n from public.personal_material_question_sets')).rows[0].n,0);
  const both=await Promise.allSettled([generatePersonalQuestions(requester,mat,deps),generatePersonalQuestions(requester,mat,deps)]);
  assert.equal(both.filter(r=>r.status==='fulfilled').length,1); assert.equal(calls,1);
  const reuse=await generatePersonalQuestions(requester,mat,deps); assert.equal(reuse.reused,true);assert.equal(calls,1);
  const status=await personalMaterialAccess(requester,mat,'status',{},deps);
  for(const value of [status,reuse,both.find(r=>r.status==='fulfilled').value]) {
   assert.doesNotMatch(JSON.stringify(value),/correctOption|explanation|supportingEvidence|questions"/i);
  }
 }finally{await db.close();}
});
