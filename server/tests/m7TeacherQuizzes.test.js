const test = require('node:test');
const assert = require('node:assert/strict');
const { getTeacherQuizzes } = require('../services/m7TeacherQuizzes');
const requester = { user: { id: 'teacher' }, profile: { role: 'teacher', teacher_status: 'approved' } };
const question = { id: 'question', type: 'literal', options: ['a','b','c','d'], correctOptionIndex: 0 };
function fixture() {
  return {
    rooms: [{id:'room-a',teacher_id:'teacher'}, {id:'room-b',teacher_id:'teacher'}, {id:'foreign',teacher_id:'other'}],
    enrollments: [{id:'e1',room_id:'room-a',student_id:'student'}, {id:'e2',room_id:'room-a',student_id:'student'}, {id:'e3',room_id:'room-b',student_id:'student'}, {id:'e4',room_id:'room-a',student_id:'not-student'}],
    profiles: [{id:'student',role:'student',full_name:'Learner'}, {id:'not-student',role:'general_user'}],
    m6_comprehension_attempts: [], m6_comprehension_responses: [],
  };
}
function add(tables, id, room = 'room-a', patch = {}, correct = true) {
  tables.m6_comprehension_attempts.push({id,user_id:'student',room_id:room,oral_reading_attempt_id:'same-reading',status:'completed',completed_at:'2026-10-02T00:00:00Z',question_snapshot:[question],...patch});
  tables.m6_comprehension_responses.push({id:`r-${id}`,attempt_id:id,question_id:'question',first_option_index:correct ? 0 : 1,resolved:true});
}
function database(tables) {
  return { from(table) {
    const predicates=[]; let limit=100;
    return {
      select(){return this;}, order(){return this;}, limit(n){limit=n;return this;},
      eq(k,v){predicates.push(row=>row[k]===v);return this;},
      in(k,values){predicates.push(row=>values.includes(row[k]));return this;},
      gt(k,v){predicates.push(row=>row[k]>v);return this;},
      then(resolve){return Promise.resolve(resolve({data:tables[table].filter(row=>predicates.every(p=>p(row))).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Math.min(limit,2)),error:null}));},
    };
  }};
}
const load = tables => getTeacherQuizzes(requester,{getSupabaseAdmin:()=>database(tables)});

test('all quizzes sharing a reading survive pagination and duplicate enrollments; stored room determines attribution', async()=>{
  const tables=fixture();
  add(tables,'q1'); add(tables,'q2','room-a',{},false); add(tables,'q3','room-b'); add(tables,'q4',null);
  const results=await load(tables);
  // q4 has no classroom: a Student's personal practice is not attributed to any Teacher (2026-11-17).
  assert.deepEqual(results.map(q=>q.attemptId),['q1','q2','q3']);
  assert.deepEqual(results.map(q=>q.scorePercentage),[100,0,100]);
  assert.deepEqual(results.map(q=>q.roomId),['room-a','room-a','room-b']);
  assert.equal(results[0].studentName,'Learner');
});

test('foreign classrooms, former enrollment, nonstudent profiles and in-progress quizzes are excluded before evidence validation', async()=>{
  const tables=fixture(); add(tables,'valid');
  for (const [id,room,patch] of [
    ['foreign','foreign',{}], ['former','old-room',{}], ['wrong-role',null,{user_id:'not-student'}],
    ['outsider',null,{user_id:'outsider'}], ['pending','room-a',{status:'in_progress'}],
  ]) add(tables,id,room,{question_snapshot:null,...patch});
  assert.deepEqual((await load(tables)).map(q=>q.attemptId),['valid']);
  tables.enrollments=[];
  assert.deepEqual(await load(tables),[]);
});

test('duplicate attempt input is counted once by quiz ID, not reading ID', async()=>{
  const tables=fixture();add(tables,'q');
  const students=new Map([['student',tables.profiles[0]]]);students.roomsByStudent=new Map([['student',new Set(['room-a'])]]);
  const result=await getTeacherQuizzes(requester,{
    getSupabaseAdmin:()=>({}),loadTeacherStudentProfiles:async()=>students,
    reportRows:async(db,table)=>table==='m6_comprehension_attempts' ? [...tables[table],...tables[table]] : tables[table],
  });
  assert.equal(result.length,1);assert.equal(result[0].attemptId,'q');
});

test('malformed and incomplete completed evidence fails explicitly instead of returning zero or partial scores', async()=>{
  for (const mutate of [
    t=>{t.m6_comprehension_attempts[0].question_snapshot=null;},
    t=>{t.m6_comprehension_attempts[0].question_snapshot=[];},
    t=>{t.m6_comprehension_attempts[0].completed_at=null;},
    t=>{t.m6_comprehension_responses=[];},
    t=>{t.m6_comprehension_responses[0].resolved=false;},
    t=>{t.m6_comprehension_responses[0].first_option_index=9;},
    t=>{t.m6_comprehension_responses.push({...t.m6_comprehension_responses[0],id:'duplicate'});},
  ]) {
    const tables=fixture();add(tables,'bad');add(tables,'valid');mutate(tables);
    await assert.rejects(load(tables),error=>error.statusCode===422 && /evidence/.test(error.message));
  }
});

test('wrong roles and unapproved teachers are rejected before database access', async()=>{
  for(const profile of [{role:'admin'},{role:'student'},{role:'teacher',teacher_status:'pending'}]) {
    await assert.rejects(getTeacherQuizzes({...requester,profile},{getSupabaseAdmin:()=>{throw Error('Unexpected database access');}}),/Approved Teacher/);
  }
});

test('retrieval failures propagate rather than returning empty analytics', async()=>{
  await assert.rejects(getTeacherQuizzes(requester,{getSupabaseAdmin:()=>({}),loadTeacherStudentProfiles:async()=>{throw Error('database unavailable');}}),/database unavailable/);
});
