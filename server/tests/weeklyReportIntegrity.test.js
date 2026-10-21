const test = require('node:test');
const assert = require('node:assert/strict');
const { reportRows } = require('../services/weeklyReportRows');
const { generateTeacherWeeklyReport } = require('../services/weeklyReportGenerator');
const { createWeeklyReportsRouter } = require('../routes/weeklyReports');
const requester = {user:{id:'teacher'},profile:{role:'teacher',teacher_status:'approved'}};
const period = {startDate:'2026-10-01',endDate:'2026-10-07'};
const id = i => String(i).padStart(6,'0');
function fixture(size=1) {
  const tables={rooms:[{id:'room',teacher_id:'teacher',room_name:'Room'}],enrollments:[],profiles:[],modules:[],oral_reading_attempts:[],m6_comprehension_attempts:[],m6_comprehension_responses:[],reading_activity_assignments:[]};
  for(let i=0;i<size;i++) {
    const key=id(i), student=`s${key}`, module=`m${key}`, oral=`o${key}`, quiz=`q${key}`;
    tables.enrollments.push({id:`e${key}`,student_id:student,room_id:'room'});
    tables.profiles.push({id:student,role:'student',full_name:'Fixture learner'});
    tables.modules.push({id:module,title:'Fixture story'});
    tables.oral_reading_attempts.push({id:oral,user_id:student,module_id:module,room_id:'room',completed_at:'2026-10-02T00:00:00Z',pronunciation_accuracy:90,reading_speed_wpm:100});
    const questions=['literal','inferential','critical'].map((type,j)=>({id:`question-${j}`,type,options:['A','B','C','D'],correctOptionIndex:0}));
    tables.m6_comprehension_attempts.push({id:quiz,user_id:student,module_id:module,room_id:'room',oral_reading_attempt_id:oral,status:'completed',created_at:'2026-10-02T00:00:01Z',completed_at:'2026-10-02T00:01:00Z',question_snapshot:questions});
    questions.forEach((q,j)=>tables.m6_comprehension_responses.push({id:`r${key}-${j}`,attempt_id:quiz,question_id:q.id,first_option_index:0,resolved:true}));
  }
  return tables;
}
function database(tables, failure) {
  const calls=[];
  return {calls,from(table) {
    const filters=[];let cursor=null,limit=1000;
    const query={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},in(k,values){assert.ok(values.length<=50);filters.push(r=>values.includes(r[k]));return this;},gt(k,v){cursor=v;filters.push(r=>r[k]>v);return this;},order(){return this;},limit(n){limit=n;return this;},
      async then(resolve,reject) {
        try {
          calls.push({table,cursor});
          const error=failure?.(table,cursor);
          if(error === 'network') throw new Error('Simulated network failure');
          const data=(tables[table]||[]).filter(r=>filters.every(f=>f(r))).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Math.min(limit,37));
          return resolve(error ? {data:null,error:{message:error}} : {data,error:null});
        } catch(e) {return reject(e);}
      }};
    return query;
  }};
}
const generate = db => generateTeacherWeeklyReport(requester,period,{getSupabaseAdmin:()=>db});
test('weekly reports retrieve >1000 learners, modules, readings, quizzes and responses despite a smaller server cap',async()=>{
  const db=database(fixture(1205));
  const report=await generate(db);
  assert.equal(report.reading.totalAttempts,1205);
  assert.equal(report.reading.studentsWithAttempts,1205);
  assert.equal(report.comprehension.completedAssessments,1205);
  assert.equal(report.comprehension.averageScore,100);
  assert.ok(db.calls.some(c=>c.table==='enrollments' && c.cursor));
  assert.ok(db.calls.some(c=>c.table==='m6_comprehension_responses' && c.cursor));
});
test('keyset pagination retrieves every room and completion assignment under a lower cap',async()=>{
  const tables=fixture();
  tables.rooms=Array.from({length:1101},(_,i)=>({id:`room${id(i)}`,teacher_id:'teacher'}));
  const db=database(tables);
  assert.equal((await reportRows(db,'rooms','id',{teacher_id:'teacher'})).length,1101);
  const data=fixture();
  data.reading_activity_assignments=Array.from({length:1101},(_,i)=>({id:`a${id(i)}`,room_id:'room',student_id:'s000000',material_id:'material',status:'assigned'}));
  assert.equal((await generate(database(data))).currentCompletionSnapshot.totalAssignments,1101);
});
test('database and network failures from each contributing table abort generation',async()=>{
  for(const table of Object.keys(fixture())) {
    await assert.rejects(generate(database(fixture(),current=>current===table ? 'query failed':null)), /Unable to retrieve/);
  }
  await assert.rejects(generate(database(fixture(),table=>table==='m6_comprehension_responses' ? 'network':null)), /network/);
  await assert.rejects(generate(database(fixture(60),(table,cursor)=>table==='enrollments' && cursor ? 'later page failed':null)), /Unable to retrieve/);
});
test('absent and in-progress assessments remain legitimate; incomplete completed evidence fails',async()=>{
  const missing=fixture();missing.m6_comprehension_attempts=[];missing.m6_comprehension_responses=[];
  assert.equal((await generate(database(missing))).comprehension.completedAssessments,0);
  const progress=fixture();progress.m6_comprehension_attempts[0].status='in_progress';progress.m6_comprehension_attempts[0].completed_at=null;progress.m6_comprehension_responses=[];
  assert.equal((await generate(database(progress))).comprehension.completedAssessments,0);
  for(const mutate of [t=>t.m6_comprehension_responses.pop(),t=>{t.m6_comprehension_responses[0].resolved=false;},t=>{t.m6_comprehension_attempts[0].completed_at=null;},t=>{t.m6_comprehension_responses.push({...t.m6_comprehension_responses[0],id:'duplicate'});}]) {
    const tables=fixture();mutate(tables);await assert.rejects(generate(database(tables)));
  }
});
test('weekly report POST never calls storage after retrieval failure or unavailable results',async()=>{
  for(const extra of [
    {getSupabaseAdmin:()=>database(fixture(),t=>t==='m6_comprehension_responses'?'failed':null)},
    {loadWeeklyComprehensions:async()=>[],listTeacherOralReadingAttempts:async()=>[{comprehension:{status:'unavailable'}}],getTeacherCompletionAnalytics:async()=>({})},
  ]) {
    let saved=false;
    const router=createWeeklyReportsRouter({...extra,authorizeTeacherOralReadingRequest:async()=>requester,saveWeeklyReport:async()=>{saved=true;}});
    const route=router.stack.find(layer=>layer.route?.methods.post).route.stack[0].handle;
    const response={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await route({body:{period}},response);
    assert.equal(saved,false);assert.equal(response.statusCode,500);assert.equal(response.body.success,false);
  }
});

test('new reports restrict reading and completion to the current student/classroom membership', async () => {
  const tables=fixture();
  tables.reading_activity_assignments=[{id:'assignment',room_id:'room',student_id:'s000000',material_id:'material',status:'assigned'}];
  const active=await generate(database(tables));
  assert.equal(active.reading.totalAttempts,1);
  assert.equal(active.currentCompletionSnapshot.totalAssignments,1);
  // Enrollment elsewhere under the same teacher must not grant the former room.
  tables.rooms.push({id:'room2',teacher_id:'teacher',room_name:'Second'});
  tables.enrollments[0].room_id='room2';
  const moved=await generate(database(tables));
  assert.equal(moved.reading.totalAttempts,0);
  assert.equal(moved.currentCompletionSnapshot.totalAssignments,0);
  assert.deepEqual(moved.currentCompletionSnapshot.students,[]);
  tables.enrollments=[];
  const removed=await generate(database(tables));
  assert.equal(removed.reading.totalAttempts,0);
  assert.equal(removed.currentCompletionSnapshot.totalAssignments,0);
  tables.enrollments=[{id:'e',student_id:'s000000',room_id:'room'}];
  tables.rooms[0].teacher_id='other-teacher';
  const foreign=await generate(database(tables));
  assert.equal(foreign.reading.totalAttempts,0);
  assert.equal(foreign.currentCompletionSnapshot.totalAssignments,0);
});

test('reports count every quiz ID once even with a shared reading and duplicate enrollment', async()=>{
  const tables=fixture();
  tables.enrollments.push({...tables.enrollments[0],id:'extra-enrollment'});
  tables.m6_comprehension_attempts.push({...tables.m6_comprehension_attempts[0],id:'second'});
  tables.m6_comprehension_responses.push(...tables.m6_comprehension_responses.map(r=>({...r,id:`second-${r.id}`,attempt_id:'second'})));
  const report=await generate(database(tables));
  assert.equal(report.reading.totalAttempts,1);
  assert.equal(report.comprehension.completedAssessments,2);
  assert.equal(new Set(report.comprehension.assessments.map(a=>a.attemptId)).size,2);
  assert.equal(report.comprehension.averageScore,100);
});
test('quiz completion dates use inclusive PHT days independently of reading dates',async()=>{
  const tables=fixture();
  tables.oral_reading_attempts[0].completed_at='2026-09-01T00:00:00Z';
  const base=tables.m6_comprehension_attempts[0], answers=tables.m6_comprehension_responses;
  tables.m6_comprehension_attempts=[];tables.m6_comprehension_responses=[];
  ['2026-09-30T15:59:59Z','2026-09-30T16:00:00Z','2026-10-07T15:59:59.999Z','2026-10-07T16:00:00Z'].forEach((completed_at,i)=>{
    const key=`boundary-${i}`;
    tables.m6_comprehension_attempts.push({...base,id:key,completed_at,question_snapshot:i===0||i===3?null:base.question_snapshot});
    tables.m6_comprehension_responses.push(...answers.map(r=>({...r,id:`${key}-${r.id}`,attempt_id:key})));
  });
  const report=await generate(database(tables));
  assert.equal(report.reading.totalAttempts,0);
  assert.deepEqual(report.comprehension.assessments.map(a=>a.attemptId),['boundary-1','boundary-2']);
});
test('report quiz loader rejects wrong roles and excludes unauthorized classroom evidence',async()=>{
  const {loadWeeklyComprehensions}=require('../services/weeklyReportComprehension');
  for(const role of ['student','admin','general_user']) {
    await assert.rejects(loadWeeklyComprehensions({profile:{role}}, {}, {getSupabaseAdmin:()=>assert.fail('must not query')}),e=>e.statusCode===403);
  }
  const tables=fixture();
  tables.m6_comprehension_attempts.push({...tables.m6_comprehension_attempts[0],id:'foreign',room_id:'foreign-room',question_snapshot:null});
  assert.equal((await generate(database(tables))).comprehension.completedAssessments,1);
});

test('non-report teacher review retrieves every learner and response above server caps',async()=>{
  const {listTeacherOralReadingAttempts}=require('../services/oralReadingAttemptService');
  const tables=fixture(1205);
  const db=database(tables);
  const results=await listTeacherOralReadingAttempts(requester,{getSupabaseAdmin:()=>db});
  assert.equal(results.length,1205);
  assert.ok(results.every(r=>r.comprehension.status==='completed' && r.comprehension.firstAttemptPercentage===100));
  assert.equal(new Set(results.map(r=>r.id)).size,1205);
  assert.ok(db.calls.some(c=>c.table==='oral_reading_attempts' && c.cursor));
  assert.ok(db.calls.some(c=>c.table==='m6_comprehension_responses' && c.cursor));
});
test('non-report review keeps one completed quiz per reading and fails closed on later response errors',async()=>{
  const {listTeacherOralReadingAttempts}=require('../services/oralReadingAttemptService');
  const tables=fixture(60);
  tables.m6_comprehension_attempts.push({...tables.m6_comprehension_attempts[0],id:'second',created_at:'2026-10-03T00:00:00Z'});
  tables.m6_comprehension_responses.push(...tables.m6_comprehension_responses.filter(r=>r.attempt_id==='q000000').map(r=>({...r,id:`second-${r.id}`,attempt_id:'second'})));
  const results=await listTeacherOralReadingAttempts(requester,{getSupabaseAdmin:()=>database(tables)});
  assert.equal(results.length,60);
  assert.ok(results.every(r=>r.comprehension.status==='completed'));
  const failed=await listTeacherOralReadingAttempts(requester,{getSupabaseAdmin:()=>database(tables,(table,cursor)=>table==='m6_comprehension_responses' && cursor?'later page failed':null)});
  assert.ok(failed.every(r=>r.comprehension.status==='unavailable'));
});
