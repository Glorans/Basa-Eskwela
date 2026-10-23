const test=require('node:test');
const assert=require('node:assert/strict');
const {rows,quizzes}=require('../services/m7Analytics');
const {getTeacherCompletionAnalytics}=require('../services/teacherCompletionAnalytics');
const id=n=>String(n).padStart(6,'0');
function database(tables,cap=7,failure) {
 const calls=[];
 return {calls,from(table){
  const filters=[];let cursor=null,limit=100;
  return {
   select(){return this},order(k,o){assert.equal(k,'id');assert.equal(o.ascending,true);return this},limit(n){limit=n;return this},
   eq(k,v){filters.push(r=>r[k]===v);return this},
   in(k,vs){assert.ok(vs.length<=50);assert.equal(new Set(vs).size,vs.length);filters.push(r=>vs.includes(r[k]));return this},
   gt(k,v){cursor=v;filters.push(r=>r[k]>v);return this},
   then(resolve){calls.push({table,cursor});return Promise.resolve(resolve(failure?.(table,cursor)?{data:null,error:{message:'offline'}}:{data:(tables[table]||[]).filter(r=>filters.every(f=>f(r))).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Math.min(cap,limit)),error:null}));},
  };
 }};
}
test('keyset reads continue through capped and exact-boundary pages to empty results',async()=>{
 for(const cap of [1,7,37]) for(const count of [0,1,7,14,105]) {
  const expected=Array.from({length:count},(_,i)=>({id:id(i),owner:'allowed'}));
  const db=database({records:[...expected,{id:'foreign',owner:'other'}]},cap);
  assert.deepEqual(await rows('records','*',{owner:'allowed'},db),expected);
  assert.equal(db.calls.length,Math.ceil(count/cap)+1);
 }
});
test('large IN filters retain intersections, bound batch sizes and prevent duplicates',async()=>{
 const records=Array.from({length:123},(_,i)=>({id:id(i),room:`r${i}`,student:`s${i}`,role:i===122?'other':'student'}));
 const result=await rows('records','*',{room:[...records.map(r=>r.room).reverse(),'r1'],student:records.map(r=>r.student),role:'student'},database({records},3));
 assert.deepEqual(result,records.slice(0,122));
 const db=database({records});assert.deepEqual(await rows('records','*',{room:[]},db),[]);assert.equal(db.calls.length,0);
});
test('quiz attempts and responses are complete under caps without changing scores',async()=>{
 const attempts=Array.from({length:113},(_,i)=>({id:id(i),user_id:'s',status:'completed',completed_at:'2026-10-22T00:00:00Z',question_snapshot:[{id:'question',type:'literal',options:['a','b','c','d'],correctOptionIndex:0}]}));
 const responses=attempts.map((a,i)=>({id:id(i),attempt_id:a.id,question_id:'question',first_option_index:i%2,resolved:true}));
 const db=database({m6_comprehension_attempts:[...attempts,{...attempts[0],id:'pending',status:'in_progress'}],m6_comprehension_responses:responses});
 const result=await quizzes({user_id:'s'},{rows:(t,c,f)=>rows(t,c,f,db)});
 assert.equal(result.length,113);assert.ok(result.every((q,i)=>q.score===(i%2===0?100:0)));
});
test('later-page failures and stalled cursors cannot return partial analytics',async()=>{
 await assert.rejects(rows('records','*',{},database({records:[{id:'a'},{id:'b'}]},1,(_,c)=>c!==null)),/Unable to load/);
 const query={select(){return this},order(){return this},limit(){return this},gt(){return this},then(resolve){return Promise.resolve(resolve({data:[{id:'a'}],error:null}))}};
 await assert.rejects(rows('records','*',{}, {from:()=>query}),/Invalid pagination/);
});
function fixture(){
 const t={rooms:[{id:'room',teacher_id:'teacher',room_name:'Room'}],enrollments:[],profiles:[],reading_activity_assignments:[],oral_reading_attempts:[],m6_comprehension_attempts:[]};
 for(let i=0;i<123;i++) {
  const key=id(i),student=`s${key}`;
  t.enrollments.push({id:key,room_id:'room',student_id:student});t.profiles.push({id:student,role:'student'});
  t.reading_activity_assignments.push({id:key,student_id:student,room_id:'room',material_id:'material',status:'assigned',read_aloud_only:false});
  const oral={id:key,user_id:student,room_id:'room',material_id:'material',activity_assignment_id:key};
  if(i%3!==0)t.oral_reading_attempts.push(oral);
  if(i%3===2)t.m6_comprehension_attempts.push({...oral,oral_reading_attempt_id:key,status:'completed'});
 }
 return t;
}
const requester={user:{id:'teacher'},profile:{role:'teacher',teacher_status:'approved'}};
test('completion counts all capped assignments and linked evidence while excluding unauthorized records',async()=>{
 const t=fixture();t.reading_activity_assignments.push({id:'foreign',student_id:'other',room_id:'room',status:'completed'});
 const result=await getTeacherCompletionAnalytics(requester,{getSupabaseAdmin:()=>database(t)});
 assert.equal(result.totalAssignments,123);assert.equal(result.students.length,123);
 for(const field of ['notStartedAssignments','inProgressAssignments','completedAssignments'])assert.equal(result[field],41);
 assert.equal(result.completionRate,33.33);assert.equal(result.classrooms[0].totalAssignments,123);
 assert.deepEqual(result,await getTeacherCompletionAnalytics(requester,{getSupabaseAdmin:()=>database(t),weeklyReportStrict:true}));
});
test('empty completion results remain empty and later-page errors fail closed',async()=>{
 const empty=await getTeacherCompletionAnalytics(requester,{getSupabaseAdmin:()=>database({rooms:[]})});
 assert.equal(empty.totalAssignments,0);assert.equal(empty.completionRate,null);assert.deepEqual(empty.students,[]);
 const db=database(fixture(),7,(t,c)=>t==='reading_activity_assignments'&&c!==null);
 await assert.rejects(getTeacherCompletionAnalytics(requester,{getSupabaseAdmin:()=>db}),/Unable to load classroom completion analytics/);
});
