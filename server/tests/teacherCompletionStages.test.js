const test = require('node:test');
const assert = require('node:assert/strict');
const { getTeacherCompletionAnalytics } = require('../services/teacherCompletionAnalytics');
const requester = { user: { id: 'teacher' }, profile: { role: 'teacher', teacher_status: 'approved' } };
function fixture() {
  const tables = {
    rooms: [{id:'a',room_name:'A',teacher_id:'teacher'},{id:'b',room_name:'B',teacher_id:'teacher'}],
    enrollments: [{id:'e1',room_id:'a',student_id:'s'},{id:'e2',room_id:'b',student_id:'s'},{id:'e3',room_id:'a',student_id:'s'}],
    profiles: [{id:'s',role:'student'}],
    reading_activity_assignments: [{id:'assignment',student_id:'s',room_id:'a',material_id:'material',status:'completed',read_aloud_only:false}],
    oral_reading_attempts: [], m6_comprehension_attempts: [],
  };
  const db = {from(table) {
    const filters=[]; let start=0,end=Infinity;
    return {
      select(){return this;},order(){return this;},limit(n){end=n;return this;},range(a,b){start=a;end=b+1;return this;},
      eq(k,v){filters.push(r=>r[k]===v);return this;},in(k,vs){filters.push(r=>vs.includes(r[k]));return this;},gt(k,v){filters.push(r=>r[k]>v);return this;},
      then(resolve){return Promise.resolve(resolve(tables[table] ? {data:[...new Map(tables[table].map(r=>[r.id,r])).values()].filter(r=>filters.every(f=>f(r))).sort((a,b)=>a.id.localeCompare(b.id)).slice(start,end),error:null} : {data:null,error:{message:'Unavailable'}}));},
    };
  }};
  const oral = {id:'oral',user_id:'s',room_id:'a',material_id:'material',activity_assignment_id:'assignment',completed_at:'2026-10-01'};
  const comprehension = {...oral,id:'quiz',oral_reading_attempt_id:'oral',status:'in_progress'};
  return {tables,oral,comprehension,get:()=>getTeacherCompletionAnalytics(requester,{getSupabaseAdmin:()=>db})};
}
function stages(row) {return [row.notStartedAssignments,row.inProgressAssignments,row.completedAssignments];}
function consistent(result) {
  for(const row of [result,...result.classrooms,...result.students,...result.students.flatMap(s=>s.classrooms)]) {
    assert.equal(row.totalAssignments,stages(row).reduce((a,b)=>a+b,0));
    assert.equal(row.incompleteAssignments,row.notStartedAssignments+row.inProgressAssignments);
    assert.equal(row.completionRate,row.totalAssignments ? Math.round(row.completedAssignments/row.totalAssignments*10000)/100 : null);
  }
  assert.equal(result.totalAssignments,result.students.reduce((sum,s)=>sum+s.totalAssignments,0));
  assert.equal(result.totalAssignments,result.classrooms.reduce((sum,c)=>sum+c.totalAssignments,0));
}

test('saved evidence drives all stages despite stale assignment statuses and repeated practice',async()=>{
  const f=fixture();
  for(const status of ['assigned','in_progress','completed']) {
    f.tables.reading_activity_assignments[0].status=status;
    const result=await f.get();assert.deepEqual(stages(result),[1,0,0]);consistent(result);
  }
  f.tables.oral_reading_attempts.push(f.oral);
  assert.deepEqual(stages(await f.get()),[0,1,0]);
  f.tables.m6_comprehension_attempts.push(f.comprehension);
  assert.deepEqual(stages(await f.get()),[0,1,0]);
  f.comprehension.status='completed';
  f.tables.reading_activity_assignments[0].status='in_progress';
  f.tables.oral_reading_attempts.push({...f.oral,id:'practice'});
  f.tables.m6_comprehension_attempts.push({...f.comprehension,id:'later-quiz',status:'in_progress'});
  const result=await f.get();assert.deepEqual(stages(result),[0,0,1]);consistent(result);
});

test('oral-only completion needs both saved reading evidence and explicit completion',async()=>{
  const f=fixture();const assignment=f.tables.reading_activity_assignments[0];assignment.read_aloud_only=true;
  assert.deepEqual(stages(await f.get()),[1,0,0]);
  assignment.status='assigned';f.tables.oral_reading_attempts.push(f.oral);
  f.tables.m6_comprehension_attempts.push({...f.comprehension,status:'completed'});
  assert.deepEqual(stages(await f.get()),[0,1,0]);
  assignment.status='completed';const result=await f.get();assert.deepEqual(stages(result),[0,0,1]);consistent(result);
});

test('missing, foreign or unlinked comprehension evidence cannot complete an assignment',async()=>{
  for(const patch of [{user_id:'other'},{room_id:'b'},{material_id:'other'},{activity_assignment_id:'other'},{oral_reading_attempt_id:'missing'}]) {
    const f=fixture();f.tables.oral_reading_attempts.push(f.oral);
    f.tables.m6_comprehension_attempts.push({...f.comprehension,status:'completed',...patch});
    const result=await f.get();assert.deepEqual(stages(result),[0,1,0]);consistent(result);
  }
  const f=fixture();f.tables.m6_comprehension_attempts.push({...f.comprehension,status:'completed'});
  assert.deepEqual(stages(await f.get()),[1,0,0]);
});

test('mixed student/classroom totals count each assignment once and retain enrollment scope',async()=>{
  const f=fixture();
  f.tables.reading_activity_assignments.push({...f.tables.reading_activity_assignments[0]}); // repeated row
  f.tables.reading_activity_assignments.push({id:'second',student_id:'s',room_id:'b',material_id:'material',status:'assigned'});
  f.tables.reading_activity_assignments.push({id:'third',student_id:'s',room_id:'a',material_id:'material',status:'completed'});
  f.tables.reading_activity_assignments.push({id:'unauthorized',student_id:'other',room_id:'a',material_id:'material',status:'completed'});
  f.tables.oral_reading_attempts.push(f.oral,{...f.oral,id:'oral-b',room_id:'b',activity_assignment_id:'second'});
  f.tables.m6_comprehension_attempts.push({...f.comprehension,status:'completed'});
  const before=structuredClone(f.tables);const result=await f.get();
  assert.deepEqual(stages(result),[1,1,1]);assert.equal(result.students.length,1);
  assert.deepEqual(stages(result.classrooms[0]),[1,0,1]);assert.deepEqual(stages(result.classrooms[1]),[0,1,0]);
  consistent(result);assert.deepEqual(f.tables,before);
  f.tables.enrollments=f.tables.enrollments.filter(e=>e.room_id!=='a');
  const removed=await f.get();assert.deepEqual(stages(removed),[0,1,0]);consistent(removed);
});

test('empty assignment histories return zero counts and null completion; missing evidence tables fail closed',async()=>{
  const f=fixture();f.tables.reading_activity_assignments=[];
  const result=await f.get();assert.deepEqual(stages(result),[0,0,0]);assert.deepEqual(result.students,[]);consistent(result);
  delete f.tables.m6_comprehension_attempts;
  await assert.rejects(f.get(),/Unable to load classroom completion analytics/);
});

test('teacher approval is required before reading progress data',async()=>{
  for(const profile of [{role:'student'},{role:'admin'},{role:'teacher',teacher_status:'pending'}]) {
    await assert.rejects(getTeacherCompletionAnalytics({...requester,profile},{getSupabaseAdmin:()=>{throw Error('Unexpected data access');}}),{statusCode:403});
  }
});
