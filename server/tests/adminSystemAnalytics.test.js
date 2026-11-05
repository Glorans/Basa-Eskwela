const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAdminAnalytics, getAdminSystemAnalytics, parseFilters } = require('../services/adminSystemAnalytics');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const empty = () => ({ profiles: [], rooms: [], enrollments: [], readings: [], quizzes: [], assignments: [], attempts: [], interventions: [] });
const all = parseFilters();
function fixture() {
  return { ...empty(), profiles: [
    {id:'s',role:'student',full_name:'Learner',email:'private@example.test'},
    {id:'empty',role:'student',full_name:'No results'},
    {id:'t1',role:'teacher',teacher_status:'approved',full_name:'Teacher A'},
    {id:'t2',role:'teacher',teacher_status:'approved',full_name:'Teacher B'},
  ], rooms:[{id:A,room_name:'A',teacher_id:'t1'},{id:B,room_name:'B',teacher_id:'t2'}],
  enrollments:[{student_id:'s',room_id:A},{student_id:'s',room_id:B},{student_id:'empty',room_id:A}],
  quizzes:[50,50,50].map((score,i) => ({id:`q${i}`,userId:'s',roomId:null,status:'completed',score,completedAt:`2026-10-0${i+1}T00:00:00Z`})),
  interventions:[{id:'i',teacher_id:'t1',student_id:'s',status:'planned',notes:'Confidential notes'}] };
}
test('admin analytics rejects nonadmins before any data access', async () => {
  for (const role of [undefined,'student','teacher','general_user']) {
    await assert.rejects(getAdminSystemAnalytics({profile:{role}}, {}, {rows:()=>assert.fail('must not query')}), e => e.statusCode === 403);
  }
});
test('filter validation rejects invalid dates, ranges, classroom IDs, and array query parameters', () => {
  for (const filters of [{startDate:'2026-02-30'},{endDate:'not-a-date'},{startDate:'2026-10-02',endDate:'2026-10-01'},{roomId:'bad'},{roomId:[A]},{startDate:['2026-10-01']}]) assert.throws(()=>parseFilters(filters),e=>e.statusCode===400);
  assert.throws(()=>buildAdminAnalytics(empty(),parseFilters({roomId:A})), /Classroom not found/);
});
test('empty analytics returns no synthetic scores, trends or classifications', () => {
  const result = buildAdminAnalytics(empty(),all);
  assert.equal(result.comprehensionScore,null);
  assert.deepEqual(result.details.trends,[]);
  assert.equal(result.details.completion.completionRate,null);
  assert.equal(result.details.participation.participationRate,null);
  assert.equal(Object.values(result.details.riskCounts).reduce((a,b)=>a+b,0),0);
});
test('risk counts unique students, excludes unassessed, and ignores period cutoff', () => {
  const result = buildAdminAnalytics(fixture(),parseFilters({startDate:'2026-10-20'}));
  assert.equal(result.details.performance.completedQuizzes,0);
  assert.equal(result.completedQuizzes,3);
  assert.equal(result.details.riskCounts['Needs Support'],1);
  assert.equal(result.details.riskCounts['No assessment data'],1);
  assert.equal(result.details.supportStudents[0].contexts.length,2);
  assert.equal(result.details.supportStudents[0].interventions.planned,1);
  const payload = JSON.stringify(result);
  assert.ok(!payload.includes('Confidential notes'));
  assert.ok(!payload.includes('private@example.test'));
});
test('classroom filtering respects saved room attribution and each teacher risk scope', () => {
  const data = fixture();
  data.quizzes.forEach(q => q.roomId=B);
  data.readings = [{id:'r',user_id:'s',room_id:B,completed_at:'2026-10-02T00:00:00Z',pronunciation_accuracy:80,reading_speed_wpm:90}];
  const result = buildAdminAnalytics(data,parseFilters({roomId:A}));
  assert.equal(result.readingAttempts,1);
  assert.equal(result.details.performance.readingAttempts,0);
  assert.equal(result.details.classroomComparisons.length,1);
  assert.equal(result.details.classroomComparisons[0].enrolledStudents,2);
  assert.equal(result.details.riskCounts['Needs Support'],0);
  assert.equal(result.details.riskCounts['No assessment data'],2);
});
test('PHT inclusive dates include boundary records and omit next-day records', () => {
  const data = fixture();
  data.readings = ['2026-10-01T15:59:59Z','2026-10-01T16:00:00Z','2026-10-02T15:59:59.999Z','2026-10-02T16:00:00Z']
    .map((completed_at,i)=>({id:`r${i}`,user_id:'s',room_id:A,completed_at,pronunciation_accuracy:80,reading_speed_wpm:100}));
  const result = buildAdminAnalytics(data,parseFilters({startDate:'2026-10-02',endDate:'2026-10-02'}));
  assert.equal(result.details.performance.readingAttempts,2);
  assert.equal(result.details.participation.participatingStudents,1);
  assert.equal(result.details.trends[0].weekStart,'2026-09-28');
});
test('completion requires matching student and linked saved assessment, not status alone', () => {
  const data = fixture();
  data.assignments = [
    {id:'a1',student_id:'s',room_id:A,material_id:'m',assigned_at:'2026-10-02T00:00:00Z',status:'completed'},
    {id:'a2',student_id:'empty',room_id:A,material_id:'m',assigned_at:'2026-10-02T00:00:00Z',status:'completed'},
  ];
  data.readings = [{id:'r',user_id:'s',room_id:A,material_id:'m',activity_assignment_id:'a1',completed_at:'2026-10-03T00:00:00Z'}];
  data.attempts = [{id:'q',user_id:'s',room_id:A,material_id:'m',activity_assignment_id:'a1',oral_reading_attempt_id:'r',status:'completed'}];
  const result = buildAdminAnalytics(data,parseFilters({startDate:'2026-10-02',endDate:'2026-10-02'}));
  assert.deepEqual(result.details.completion,{assigned:2,completed:1,incomplete:1,completionRate:50});
});
test('admin report uses two-score recovery and the highest-priority context', () => {
  const data = fixture();
  data.quizzes.push({id:'pass1',userId:'s',roomId:null,status:'completed',score:75,completedAt:'2026-10-04T00:00:00Z'});
  assert.equal(buildAdminAnalytics(data,all).details.riskCounts['Needs Support'],1);
  data.quizzes.push({id:'pass2',userId:'s',roomId:null,status:'completed',score:80,completedAt:'2026-10-05T00:00:00Z'});
  assert.equal(buildAdminAnalytics(data,all).details.riskCounts['On Track'],1);
  data.quizzes.push({id:'low1',userId:'s',roomId:B,status:'completed',score:70,completedAt:'2026-10-06T00:00:00Z'});
  assert.equal(buildAdminAnalytics(data,all).details.riskCounts['At Risk'],1);
  assert.equal(buildAdminAnalytics(data,parseFilters({roomId:A})).details.riskCounts['On Track'],1);
});
test('admin service loads only existing tables and excludes private intervention fields', async () => {
  const calls=[];
  const report=await getAdminSystemAnalytics({profile:{role:'admin'}},{},{rows:async(table,columns)=>{calls.push({table,columns});return [];},quizzes:async()=>[]});
  assert.equal(report.students,0);
  assert.ok(calls.every(c=>c.table !== 'm7_risk_events' && c.table !== 'm7_risk_queue'));
  assert.equal(calls.find(c=>c.table==='m7_interventions').columns,'id,teacher_id,student_id,status');
});

test('malformed evidence outside period preserves period metrics but makes full-history risk unavailable',()=>{
  const data=fixture();
  data.quizzes.push({id:'bad',userId:'s',roomId:null,completedAt:'2026-09-01T00:00:00Z',score:null,dataQuality:'Invalid evidence'});
  const result=buildAdminAnalytics(data,parseFilters({startDate:'2026-10-01'}));
  assert.equal(result.details.performance.comprehensionScore,50);
  assert.equal(result.details.riskCounts['Evaluation unavailable'],1);
  assert.equal(result.details.riskCounts['On Track'],0);
  assert.equal(result.comprehensionScore,null);
});
test('malformed evidence in another teacher classroom does not affect selected classroom risk',()=>{
  const data=fixture();
  data.quizzes.push({id:'bad',userId:'s',roomId:B,completedAt:null,score:null,dataQuality:'Invalid evidence'});
  const result=buildAdminAnalytics(data,parseFilters({roomId:A}));
  assert.equal(result.details.riskCounts['Needs Support'],1);
  assert.equal(result.details.riskCounts['Evaluation unavailable'],0);
  assert.equal(buildAdminAnalytics(data,all).details.riskCounts['Evaluation unavailable'],1);
});
