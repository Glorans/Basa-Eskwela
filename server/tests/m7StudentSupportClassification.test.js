const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../services/supabaseAdmin');
const original = admin.getSupabaseAdmin;
let tables;
// Stub only database access; exercise the actual teacher scope, quiz scoring,
// and Student Support response builder without changing the risk engine.
admin.getSupabaseAdmin = () => ({from(table) {
  const filters=[]; let limit=100,offset=0;
  return {
    select(){return this;},order(){return this;},limit(n){limit=n;return this;},range(a,b){offset=a;limit=b-a+1;return this;},
    gt(key,value){filters.push(row=>row[key]>value);return this;},
    eq(key,value){filters.push(row=>row[key]===value);return this;},
    in(key,values){filters.push(row=>values.includes(row[key]));return this;},
    then(resolve){return Promise.resolve(resolve({data:(tables[table]??[]).filter(row=>filters.every(f=>f(row))).sort((a,b)=>a.id.localeCompare(b.id)).slice(offset,offset+limit),error:null}));},
  };
}});
const { teacher, personal } = require('../services/m7Analytics');
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
test('valid completed quizzes are evaluated: one score of 0 is Needs Support, one of 100 is On Track',async()=>{
  addQuiz({},1);
  let result=await student();assert.equal(result.classification,'Needs Support');assert.equal(result.comprehensionScore,0);
  tables.m6_comprehension_responses[0].first_option_index=0;
  result=await student();assert.equal(result.classification,'On Track');assert.equal(result.comprehensionScore,100);
});
test('independent work remains eligible for the risk thresholds',async()=>{
  addQuiz({room_id:null},1);addQuiz({},1);
  assert.equal((await student()).classification,'Needs Support');
  addQuiz({},1);assert.equal((await student()).classification,'Needs Support');
});
test('response classification does not rewrite historical events or notifications',async()=>{
  tables.m7_risk_events.push({id:'event',teacher_id:'teacher',student_id:'student',classification:'At Risk',occurred_at:'2026-10-01T00:00:00Z',evidence:[]});
  const before=structuredClone(tables);const result=await teacher('teacher');
  assert.equal(result.students[0].classification,'No assessment data');
  assert.deepEqual(result.students[0].history,before.m7_risk_events);
  assert.deepEqual(result.notifications,before.m7_risk_events);assert.deepEqual(tables,before);
});

test('Student and Teacher views show the same module and activity progress; removed work is left out',async()=>{
  Object.assign(tables,{
    room_modules:[{id:'rm',room_id:'room',module_id:'mod',assigned_at:'2026-10-01T00:00:00Z'},{id:'rm-gone',room_id:'room',module_id:'gone',assigned_at:'2026-10-01T00:00:00Z'},{id:'rm-off',room_id:'room',module_id:'mod2',assigned_at:'2026-10-01T00:00:00Z',removed_at:'2026-10-05T00:00:00Z'}],
    modules:[{id:'mod',title:'Mixed module',status:'published'},{id:'gone',title:'Deleted',status:'published',deleted_at:'2026-10-05T00:00:00Z'},{id:'mod2',title:'Removed',status:'published'}],
    module_passages:[{id:'q',module_id:'mod'},{id:'r',module_id:'mod'},{id:'r2',module_id:'mod'},{id:'x',module_id:'mod2'}],
    comprehension_questions:[{id:'cq',module_id:'mod',passage_id:'q',review_status:'reviewed'},{id:'cg',module_id:'mod',passage_id:'r',review_status:'generated'}],
    reading_activity_assignments:[{id:'act',student_id:'student',room_id:'room',material_id:'mat',status:'completed',read_aloud_only:true,question_set_id:null},{id:'off',student_id:'student',room_id:'room',material_id:'mat',status:'assigned',read_aloud_only:false,removed_at:'2026-10-05T00:00:00Z'}],
    uploaded_materials:[{id:'mat',title:'Read aloud story'}],
    oral_reading_attempts:[{id:'o1',user_id:'student',room_id:'room',module_id:'mod',passage_id:'r',assignment_id:'rm',completed_at:'2026-10-02T00:00:00Z',pronunciation_accuracy:90,reading_speed_wpm:80},
      {id:'o2',user_id:'student',room_id:'room',module_id:'mod',passage_id:'r',assignment_id:'rm',completed_at:'2026-10-03T00:00:00Z',pronunciation_accuracy:90,reading_speed_wpm:80},
      {id:'o3',user_id:'student',room_id:'room',material_id:'mat',activity_assignment_id:'act',completed_at:'2026-10-02T00:00:00Z',pronunciation_accuracy:90,reading_speed_wpm:80}],
  });
  const summary=(activities)=>activities.map(a=>[a.title,a.status,a.passagesCompleted,a.passagesTotal]);
  const expected=[['Read aloud story','Completed',undefined,undefined],['Mixed module','In Progress',1,3]];
  assert.deepEqual(summary((await personal('student')).activities),expected);
  assert.deepEqual(summary((await student()).activities),expected);
});
