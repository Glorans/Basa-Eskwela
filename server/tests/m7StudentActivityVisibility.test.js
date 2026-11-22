// Student "Progress & Result" activities must match what the Student may open: an activity is listed only for a
// Learning Room the Student is still enrolled in (the rule assignedReadingSource.js uses to open it). Saved readings
// stay in the Student's own history. Database access is stubbed; the real M7 and open-activity code runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../services/supabaseAdmin');
const original = admin.getSupabaseAdmin;
let tables;
const db = () => ({from(table) {
  const filters=[]; let limit=100,offset=0;
  const run=()=>(tables[table]??[]).filter(row=>filters.every(f=>f(row))).sort((a,b)=>a.id.localeCompare(b.id));
  return {
    select(){return this;},order(){return this;},limit(n){limit=n;return this;},range(a,b){offset=a;limit=b-a+1;return this;},
    gt(key,value){filters.push(row=>row[key]>value);return this;},
    eq(key,value){filters.push(row=>row[key]===value);return this;},
    is(key,value){filters.push(row=>(row[key]??null)===value);return this;},
    in(key,values){filters.push(row=>values.includes(row[key]));return this;},
    maybeSingle(){return Promise.resolve({data:run()[0]??null,error:null});},
    then(resolve){return Promise.resolve(resolve({data:run().slice(offset,offset+limit),error:null}));},
  };
}});
admin.getSupabaseAdmin = db;
const { personal, teacher } = require('../services/m7Analytics');
const { loadAssignedReadingSource } = require('../services/assignedReadingSource');
test.after(()=>{admin.getSupabaseAdmin=original;});

// UUIDs so the real open-activity check (which validates IDs) can run on the same rows.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const LEARNER=id(1), OTHER=id(2), SCHOOL2=id(3);
const ROOM=id(10), LEFT_ROOM=id(11), OTHER_ROOM=id(12), SCHOOL2_ROOM=id(13), ARCHIVED=id(14);
const MAT=id(20), MAT2=id(21);
const asStudent = (userId) => ({ user: { id: userId }, profile: { role: 'student' } });
const titles = async (userId) => (await personal(userId)).activities.map(a => a.title).sort();

test.beforeEach(()=>{
  tables={
    rooms:[{id:ROOM,teacher_id:'teacher'},{id:LEFT_ROOM,teacher_id:'teacher',archived_at:'2026-11-16T07:54:07Z'},{id:OTHER_ROOM,teacher_id:'teacher'},
      {id:SCHOOL2_ROOM,teacher_id:'teacher-2'},{id:ARCHIVED,teacher_id:'teacher',archived_at:'2026-11-10T00:00:00Z'}],
    // the learner is in ROOM and in the ARCHIVED room (enrollment kept), and was removed from LEFT_ROOM (no enrollment).
    enrollments:[{id:'e1',room_id:ROOM,student_id:LEARNER},{id:'e2',room_id:ARCHIVED,student_id:LEARNER},
      {id:'e3',room_id:OTHER_ROOM,student_id:OTHER},{id:'e4',room_id:SCHOOL2_ROOM,student_id:SCHOOL2}],
    profiles:[{id:LEARNER,role:'student',full_name:'Learner A'},{id:OTHER,role:'student',full_name:'Other'},{id:SCHOOL2,role:'student',full_name:'School 2'}],
    uploaded_materials:[{id:MAT,title:'Ang Ilog sa Aming Nayon',content_text:'Ang ilog ay malinis.',language:'fil',extraction_status:'completed'},
      {id:MAT2,title:'Assigned story',content_text:'The river is clean.',language:'en',extraction_status:'completed'}],
    reading_activity_assignments:[
      {id:id(30),student_id:LEARNER,room_id:LEFT_ROOM,material_id:MAT,status:'assigned',read_aloud_only:true,question_set_id:null}, // the reported case
      {id:id(31),student_id:LEARNER,room_id:ROOM,material_id:MAT2,status:'assigned',read_aloud_only:true,question_set_id:null},    // valid
      {id:id(32),student_id:OTHER,room_id:OTHER_ROOM,material_id:MAT,status:'assigned',read_aloud_only:true,question_set_id:null},
      {id:id(33),student_id:SCHOOL2,room_id:SCHOOL2_ROOM,material_id:MAT,status:'assigned',read_aloud_only:true,question_set_id:null},
      {id:id(34),student_id:LEARNER,room_id:ARCHIVED,material_id:MAT2,status:'completed',read_aloud_only:true,question_set_id:null}, // archived, still enrolled
    ],
    oral_reading_attempts:[
      // A legitimate earlier reading of the activity in the room the learner later left.
      {id:'r-left',user_id:LEARNER,room_id:LEFT_ROOM,material_id:MAT,activity_assignment_id:id(30),completed_at:'2026-11-15T00:00:00Z',pronunciation_accuracy:88,reading_speed_wpm:70},
      {id:'r-arch',user_id:LEARNER,room_id:ARCHIVED,material_id:MAT2,activity_assignment_id:id(34),completed_at:'2026-11-09T00:00:00Z',pronunciation_accuracy:90,reading_speed_wpm:75},
    ],
    m6_comprehension_attempts:[],m6_comprehension_responses:[],m7_risk_events:[],m7_interventions:[],room_modules:[],modules:[],
  };
});

test('1. an activity of a room the Student is no longer enrolled in is not listed (the reported "Ilog sa Aming Nayon" case)', async()=>{
  assert.ok(!(await titles(LEARNER)).includes('Ang Ilog sa Aming Nayon'));
});
test('2. a valid assignment in a current room is listed and opens', async()=>{
  assert.ok((await titles(LEARNER)).includes('Assigned story'));
  const source = await loadAssignedReadingSource(asStudent(LEARNER), MAT2, { roomId: ROOM, activityAssignmentId: id(31) }, { getSupabaseAdmin: db });
  assert.equal(source.title, 'Assigned story');
});
test("3 and 4. another Student's or another school's activity is never listed", async()=>{
  tables.enrollments.push({id:'e5',room_id:OTHER_ROOM,student_id:LEARNER}); // even when the learner shares the other Student's room
  assert.deepEqual((await titles(LEARNER)).filter(t => t === 'Ang Ilog sa Aming Nayon'), []);
  assert.deepEqual(await titles(OTHER), ['Ang Ilog sa Aming Nayon']);
  assert.deepEqual(await titles(SCHOOL2), ['Ang Ilog sa Aming Nayon']);
});
test('5. direct URL without permission is still refused (left room, another Student, another school)', async()=>{
  const open = (user, ctx) => loadAssignedReadingSource(asStudent(user), MAT, ctx, { getSupabaseAdmin: db });
  await assert.rejects(open(LEARNER, { roomId: LEFT_ROOM, activityAssignmentId: id(30) }), /not available to your account/);
  await assert.rejects(open(LEARNER, { roomId: OTHER_ROOM, activityAssignmentId: id(32) }), /not available to your account/);
  await assert.rejects(open(LEARNER, { roomId: SCHOOL2_ROOM, activityAssignmentId: id(33) }), /not available to your account/);
});
test("6. the Student's own completed reading stays in their history after leaving the room", async()=>{
  const data = await personal(LEARNER);
  assert.ok(data.readings.some(r => r.id === 'r-left'), 'own reading kept');
  assert.equal(data.summary.readingAttempts, 2);
});
test('7. an archived room the Student is still enrolled in keeps its activity (existing read-only history rule)', async()=>{
  const listed = (await personal(LEARNER)).activities.find(a => a.id === id(34));
  assert.ok(listed, 'archived-room activity still listed');
  assert.equal(listed.status, 'Completed');
});
test("8. the Teacher view is unchanged: enrolled Students' activities and results still show", async()=>{
  const view = await teacher('teacher');
  const learner = view.students.find(s => s.id === LEARNER);
  assert.ok(learner, 'the learner still in the Teacher list');
  assert.ok(learner.activities.some(a => a.id === id(31)), 'current activity shown to the Teacher');
  assert.ok(!learner.activities.some(a => a.id === id(30)), 'left-room activity not shown');
  assert.ok(view.students.find(s => s.id === OTHER).activities.some(a => a.id === id(32)));
});
test('Independent Learners get no classroom activities (unchanged)', async()=>{
  assert.deepEqual((await personal(LEARNER, { includeActivities: false })).activities, []);
});

// ---- School Admin report: the same eligibility (pending counts) ----
const { scopedAdminData, buildAdminStudents, buildAdminStudentDetail, buildAdminAnalytics, parseFilters } = require('../services/adminSystemAnalytics');
function adminData(members) {
  const t = tables;
  // the learner also completed a read-aloud activity in LEFT_ROOM before leaving (history must stay).
  const materialAssignments = [...t.reading_activity_assignments,
    { id: id(35), student_id: LEARNER, room_id: LEFT_ROOM, material_id: MAT2, status: 'completed', read_aloud_only: true, question_set_id: null, assigned_at: '2026-11-14T00:00:00Z' }];
  const readings = [...t.oral_reading_attempts,
    { id: 'r-done', user_id: LEARNER, room_id: LEFT_ROOM, material_id: MAT2, activity_assignment_id: id(35), completed_at: '2026-11-14T01:00:00Z', pronunciation_accuracy: 92, reading_speed_wpm: 80 }];
  return scopedAdminData(new Set(members), {
    profiles: [...t.profiles, { id: 'teacher', role: 'teacher' }, { id: 'teacher-2', role: 'teacher' }],
    rooms: t.rooms.map(r => ({ ...r, room_name: r.id })), enrollments: t.enrollments, readings, quizResults: [],
    materialAssignments: materialAssignments.map(a => ({ assigned_at: '2026-11-15T00:00:00Z', ...a })),
    attempts: [], interventions: [], roomModules: [], recipients: [], passages: [], modules: [], questions: [], materials: t.uploaded_materials,
  });
}
const SCHOOL1 = ['teacher', LEARNER, OTHER];
test('Admin: a no-longer-accessible unfinished activity is not counted as pending; current and completed ones are', () => {
  const data = adminData(SCHOOL1);
  const ids = data.assignments.filter(a => a.student_id === LEARNER).map(a => a.id).sort();
  assert.ok(!ids.includes(id(30)), 'left-room unfinished "Ilog sa Aming Nayon" excluded');
  assert.ok(ids.includes(id(31)), 'current assignment kept (pending)');
  assert.ok(ids.includes(id(35)), 'left-room COMPLETED activity kept (history)');
  assert.ok(ids.includes(id(34)), 'archived room, still enrolled: kept');
  const row = buildAdminStudents(data).find(s => s.id === LEARNER);
  assert.deepEqual([row.completion.assigned, row.completion.completed], [3, 2]);
  const detail = buildAdminStudentDetail(data, LEARNER, 'admin');
  assert.ok(!detail.activities.some(a => a.id === id(30)));
  assert.equal(detail.activities.find(a => a.id === id(35)).status, 'Completed');
});
test('Admin: school isolation unchanged (School 2 Student and assignments never in School 1 data)', () => {
  const data = adminData(SCHOOL1);
  assert.ok(!data.profiles.some(p => p.id === SCHOOL2));
  assert.ok(!data.assignments.some(a => a.student_id === SCHOOL2 || a.room_id === SCHOOL2_ROOM));
  const data2 = adminData(['teacher-2', SCHOOL2]);
  assert.deepEqual(data2.assignments.map(a => a.id), [id(33)]);
});
test('Admin: school totals no longer count the inaccessible activity', () => {
  const report = buildAdminAnalytics(adminData(SCHOOL1), parseFilters({}));
  assert.equal(report.overview?.assignedActivities ?? report.summary?.assignedActivities ?? report.assignedActivities, 4);
});
