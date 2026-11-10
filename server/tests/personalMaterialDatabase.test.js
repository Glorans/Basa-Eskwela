const test = require('node:test');
const assert = require('node:assert/strict');
const {id,asUser,sqlFile}=require('./fixtures/m5M6SecurityDatabase');
const {fixture,add,generate,bank,owner,story}=require('./fixtures/personalMaterialDatabase');
const other=id(1);
test('private SQL: authorization, explicit review, partial extraction, bank secrecy, lease fencing and rolling quota', async () => {
 const db=await fixture();
 try {
  const mat=await add(db);
  await assert.rejects(db.query(`select public.personal_material_access($1,$2,'source')`,[other,mat]), /access denied/);
  await assert.rejects(asUser(db,owner,`select * from public.personal_material_question_sets`), /permission denied/);
  await assert.rejects(asUser(db,owner,`select public.personal_material_generation('${owner}','${mat}','begin')`), /permission denied/);
  await db.query(`select public.personal_material_access($1,$2,'metadata',null,'[2,4]')`,[owner,mat]);
  const status=(await db.query(`select public.personal_material_access($1,$2,'status') s`,[owner,mat])).rows[0].s;
  assert.deepEqual(status.missingPages,[2,4]); assert.equal(status.questions,undefined);
  const first=(await db.query(`select public.personal_material_generation($1,$2,'begin') s`,[owner,mat])).rows[0].s;
  await assert.rejects(db.query(`select public.personal_material_generation($1,$2,'begin')`,[owner,mat]),/already running/);
  await assert.rejects(db.query(`select public.personal_material_generation($1,$2,'finish',$3,$4)`,[owner,mat,id(999),JSON.stringify(bank())]),/expired/);
  await db.query(`select public.personal_material_generation($1,$2,'fail',$3)`,[owner,mat,first.token]);
  const saved=await generate(db,mat); assert.ok(saved.id); assert.equal(saved.questions,undefined);
  assert.equal((await db.query(`select public.personal_material_generation($1,$2,'begin') s`,[owner,mat])).rows[0].s.reused,true);
  for(let i=1;i<5;i++) await generate(db,await add(db,500+i,i===1?'fil':'en'));
  const sixth=await add(db,505);
  await assert.rejects(db.query(`select public.personal_material_generation($1,$2,'begin')`,[owner,sixth]),/Five new/);
  await db.exec(`update public.personal_material_question_sets set created_at=clock_timestamp()-interval '25 hours'`);
  await generate(db,sixth);
  await db.query(`select public.personal_material_access($1,$2,'delete')`,[owner,mat]);
  await assert.rejects(db.query(`select public.personal_material_access($1,$2,'source')`,[owner,mat]),/deleted/);
  assert.equal((await db.query(`select count(*)::int n from public.personal_material_question_sets where material_id=$1`,[mat])).rows[0].n,1);
  await assert.rejects(db.query(`delete from public.uploaded_materials where id=$1`,[mat]),/foreign key/);
 } finally { await db.close(); }
});


test('real M5 scoring, English/Filipino repeats, private M6 immutable identity, completion isolation and retained history', async () => {
 const db=await fixture();
 try {
  const { buildAttemptInsert } = require('../services/oralReadingAttemptService');
  const { verifySavedReading } = require('../services/readingVerification');
  for (const [n,language] of [[600,'en'],[601,'fil']]) {
   const mat=await add(db,n,language); const set=await generate(db,mat);
   const requester={user:{id:owner},profile:{role:'general_user'}};
   const save=async (i) => {
    const payload=buildAttemptInsert(requester,{id:null,materialId:mat,activityAssignmentId:null,title:'Private',passageTitle:'Private',passage:story,language},
      {submissionId:id(n*10+i),transcript:story,durationSeconds:15});
    const keys=Object.keys(payload);
    const row=(await db.query(`insert into public.oral_reading_attempts(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,keys.map(k=>k==='word_metrics'?JSON.stringify(payload[k]):payload[k]))).rows[0];
    assert.equal(Number(row.pronunciation_accuracy),100);
    const skipped=await verifySavedReading(requester,row,{getSupabaseAdmin:()=>{throw Error('Personal practice must not enter M8');}});
    assert.equal(skipped.reason,'personal_practice'); return row.id;
   };
   const reading=await save(1); const repeated=await save(2); assert.notEqual(reading,repeated);
   const create=(submission,read=reading) => db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,material_id,oral_reading_attempt_id,passage_title,passage_text,language,question_snapshot,personal_question_set_id)
     values($1,$2,$3,$4,'Private',$5,$6,$7,$8) returning id`,[owner,submission,mat,read,story,language,JSON.stringify(bank()),set.id]);
   const result=(await create(id(n*10+3))).rows[0].id;
   await assert.rejects(create(id(n*10+4),repeated),/unique constraint/);
   await assert.rejects(db.query(`update public.uploaded_materials set content_text='Changed.' where id=$1`,[mat]),/practice has started/);
   await db.query(`select public.m6_assert_completion_access($1)`,[result]);
   for (const q of bank()) {
    await db.query(`select public.m6_apply_action($1,$2,$3,'answer',0,$4)`,[result,owner,q.id,id(n*100+Number(q.id.slice(-3)))]);
   }
   await db.query(`select public.m6_apply_action($1,$2,null,'complete',null,null)`,[result,owner]);
   assert.equal((await db.query(`select status from public.m6_comprehension_attempts where id=$1`,[result])).rows[0].status,'completed');
   assert.equal((await db.query('select count(*)::int n from public.m7_risk_queue')).rows[0].n,0);
   await db.query(`select public.personal_material_access($1,$2,'delete')`,[owner,mat]);
   assert.equal((await db.query(`select count(*)::int n from public.oral_reading_attempts where material_id=$1`,[mat])).rows[0].n,2);
   assert.equal((await db.query(`select question_snapshot from public.m6_comprehension_attempts where id=$1`,[result])).rows[0].question_snapshot.length,9);
   await assert.rejects(create(id(n*10+5)),/deleted/);
  }
 } finally { await db.close(); }
});

test('fingerprint verification, rollback restores installed functions; data-bearing rollback refuses',async()=>{
 const db=await fixture();
 try {
  await db.exec(sqlFile('supabase/proposed/personal_material_2_questions_VERIFY_READONLY.sql'));
  await db.exec(sqlFile('supabase/proposed/personal_material_2_questions_ROLLBACK_PROPOSED.sql'));
  await db.exec(sqlFile('supabase/proposed/personal_material_1_sources_ROLLBACK_PROPOSED.sql'));
  for(const [sig,fp] of require('./fixtures/personalMaterialInstalledFunctions.json')) {
   assert.equal((await db.query(`select md5(replace(pg_get_functiondef($1::regprocedure),chr(13),'')) fp`,['public.'+sig])).rows[0].fp,fp);
  }
  await db.exec(sqlFile('supabase/proposed/personal_material_1_sources_PROPOSED.sql'));
  await db.exec(sqlFile('supabase/proposed/personal_material_2_questions_PROPOSED.sql'));
  const mat=await add(db,700);await generate(db,mat);
  await assert.rejects(db.exec(sqlFile('supabase/proposed/personal_material_2_questions_ROLLBACK_PROPOSED.sql')),/Recovery required/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from public.personal_material_question_sets')).rows[0].n,1);
 }finally{await db.close();}
});

test('unconfirmed/failed text, expired leases, invalid banks and deleted unfinished answers fail closed',async()=>{
 const db=await fixture();
 try {
  const mat=await add(db,710);
  await db.query('update public.personal_material_state set reviewed_revision=null where material_id=$1',[mat]);
  await assert.rejects(db.query(`select public.personal_material_source($1,$2)`,[owner,mat]),/Review and confirm/);
  await db.query(`update public.uploaded_materials set extraction_status='failed' where id=$1`,[mat]);
  await assert.rejects(db.query(`select public.personal_material_source($1,$2,false)`,[owner,mat]),/Completed English/);
  await db.query(`update public.uploaded_materials set extraction_status='completed' where id=$1`,[mat]);
  const state=(await db.query(`select public.personal_material_access($1,$2,'status') s`,[owner,mat])).rows[0].s;
  await db.query(`select public.personal_material_access($1,$2,'confirm',$3)`,[owner,mat,state.revision]);
  const lease=(await db.query(`select public.personal_material_generation($1,$2,'begin') s`,[owner,mat])).rows[0].s;
  await db.exec(`update public.personal_material_generation_leases set expires_at=clock_timestamp()-interval '1 second'`);
  await assert.rejects(db.query(`select public.personal_material_generation($1,$2,'finish',$3,$4)`,[owner,mat,lease.token,JSON.stringify(bank())]),/expired/);
  const next=(await db.query(`select public.personal_material_generation($1,$2,'begin') s`,[owner,mat])).rows[0].s;
  await db.query(`select public.personal_material_generation($1,$2,'fail',$3)`,[owner,mat,lease.token]);
  assert.equal((await db.query('select token from public.personal_material_generation_leases')).rows[0].token,next.token);
  await assert.rejects(db.query(`select public.personal_material_generation($1,$2,'finish',$3,'[]')`,[owner,mat,next.token]),/Invalid private/);
  await db.query(`select public.personal_material_generation($1,$2,'fail',$3)`,[owner,mat,next.token]);
  const set=await generate(db,mat);
  const {buildAttemptInsert}=require('../services/oralReadingAttemptService');
  const payload=buildAttemptInsert({user:{id:owner}}, {id:null,materialId:mat,title:'Private',passage:story,language:'en'}, {submissionId:id(720),transcript:story,durationSeconds:10});
  const keys=Object.keys(payload);
  const reading=(await db.query(`insert into public.oral_reading_attempts(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning id`,keys.map(k=>k==='word_metrics'?JSON.stringify(payload[k]):payload[k]))).rows[0].id;
  const attempt=(await db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,material_id,oral_reading_attempt_id,passage_title,passage_text,language,question_snapshot,personal_question_set_id) values($1,$2,$3,$4,'Private',$5,'en',$6,$7) returning id`,[owner,id(721),mat,reading,story,JSON.stringify(bank()),set.id])).rows[0].id;
  await db.query(`select public.personal_material_access($1,$2,'delete')`,[owner,mat]);
  await assert.rejects(db.query(`select public.m6_apply_action($1,$2,$3,'answer',0,$4)`,[attempt,owner,bank()[0].id,id(722)]),/deleted/);
  assert.equal((await db.query('select status from public.m6_comprehension_attempts where id=$1',[attempt])).rows[0].status,'in_progress');
 }finally{await db.close();}
});
