const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../services/supabaseAdmin');
const original = admin.getSupabaseAdmin;
let tables;
// Stub only database access; exercise the actual teacher scope, quiz scoring,
// and Student Support response builder without changing the risk engine.
admin.getSupabaseAdmin = () => ({from(table) {
  const filters=[]; let limit=100;
  return {
    select(){return this;},order(){return this;},limit(n){limit=n;return this;},
    gt(key,value){filters.push(row=>row[key]>value);return this;},
    eq(key,value){filters.push(row=>row[key]===value);return this;},
    in(key,values){filters.push(row=>values.includes(row[key]));return this;},
    then(resolve){return Promise.resolve(resolve({data:tables[table].filter(row=>filters.every(f=>f(row))).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit),error:null}));},
  };
}});
const { teacher } = require('../services/m7Analytics');
test.after(()=>{admin.getSupabaseAdmin=original;});
test.beforeEach(()=>{
  tables={rooms:[{id:'room',teacher_id:'teacher'}],enrollments:[{id:'enrollment',room_id:'room',student_id:'student'}],
    profiles:[{id:'student',role:'student',full_name:'Learner'}],oral_reading_attempts:[],m6_comprehension_attempts:[],m6_comprehension_responses:[],m7_risk_events:[],m7_interventions:[]};
});
function addQuiz(patch={}, answer=0) {
  const quiz={id:`quiz-${tables.m6_comprehension_attempts.length}`,user_id:'student',room_id:'room',status:'completed',completed_at:'2026-10-22T00:00:00Z',question_snapshot:[{id:'question',type:'literal',options:['a','b','c','d'],correctOptionIndex:0}],...patch};
  tables.m6_comprehension_attempts.push(quiz);
  tables.m6_comprehension_responses.push({id:`response-${quiz.id}`,attempt_id:quiz.id,question_id:'question',first_option_index:answer,resolved:true});
}
const student = async()=> (await teacher('teacher')).students[0];

test('empty histories return No assessment data with zero quizzes and null score',async()=>{
  const result=await student();assert.equal(result.classification,'No assessment data');
  assert.equal(result.completedQuizzes,0);assert.equal(result.comprehensionScore,null);
});
test('in-progress and foreign-classroom quizzes do not count as assessment evidence',async()=>{
  addQuiz({status:'in_progress'});addQuiz({room_id:'foreign',question_snapshot:null});
  const result=await student();assert.equal(result.classification,'No assessment data');assert.equal(result.completedQuizzes,0);
});
test('malformed eligible completed evidence remains Evaluation unavailable',async()=>{
  addQuiz({question_snapshot:null});
  const result=await student();assert.equal(result.classification,'Evaluation unavailable');
  assert.equal(result.completedQuizzes,1);assert.equal(result.comprehensionScore,null);
});
test('valid completed quizzes preserve evaluated On Track, including one low score',async()=>{
  addQuiz({},1);
  let result=await student();assert.equal(result.classification,'On Track');assert.equal(result.comprehensionScore,0);
  tables.m6_comprehension_responses[0].first_option_index=0;
  result=await student();assert.equal(result.classification,'On Track');assert.equal(result.comprehensionScore,100);
});
test('independent work remains eligible and existing risk thresholds still apply',async()=>{
  addQuiz({room_id:null},1);addQuiz({},1);
  assert.equal((await student()).classification,'Early Warning');
  addQuiz({},1);assert.equal((await student()).classification,'Needs Support');
});
test('response classification does not rewrite historical events or notifications',async()=>{
  tables.m7_risk_events.push({id:'event',teacher_id:'teacher',student_id:'student',classification:'At Risk',occurred_at:'2026-10-01T00:00:00Z',evidence:[]});
  const before=structuredClone(tables);const result=await teacher('teacher');
  assert.equal(result.students[0].classification,'No assessment data');
  assert.deepEqual(result.students[0].history,before.m7_risk_events);
  assert.deepEqual(result.notifications,before.m7_risk_events);assert.deepEqual(tables,before);
});
