const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRisk } = require('../services/m7Risk');
const quizzes = scores => scores.map((score,i) => ({ id: String(i).padStart(3,'0'), score, status:'completed', completedAt: new Date(Date.UTC(2026,0,i+1)).toISOString() }));
test('M7 thresholds: benchmark 75, Needs Support below 60 or two in a row below 75', () => {
  for (const [scores,expected] of [ [[74],'At Risk'], [[60],'At Risk'], [[59],'Needs Support'], [[75],'Early Warning'], [[79],'Early Warning'], [[80],'On Track'], [[100],'On Track'],
    [[74,74],'Needs Support'], [[74,75,74],'At Risk'], [[80,70],'At Risk'], [[80,70,70],'Needs Support'], [[77,85],'On Track'], [[85,77],'Early Warning'] ]) assert.equal(classifyRisk(quizzes(scores)).classification,expected,String(scores));
});
test('M7 risk persists until two consecutive scores reach the benchmark, then follows the latest score, and can recur', () => {
  for (const [initial,state] of [[59,'Needs Support'],[74,'At Risk']]) {
    assert.equal(classifyRisk(quizzes([initial,80])).classification,state,'one recovery score does not clear it');
    assert.equal(classifyRisk(quizzes([initial,80])).recoveryCount,1);
    assert.equal(classifyRisk(quizzes([initial,80,74,75])).classification,initial === 59 ? 'Needs Support' : 'At Risk','a low score restarts recovery');
    assert.equal(classifyRisk(quizzes([initial,75,80])).classification,'On Track');
    assert.equal(classifyRisk(quizzes([initial,80,75])).classification,'Early Warning');
    assert.equal(classifyRisk(quizzes([initial,80,80])).recoveryCount,0);
    assert.equal(classifyRisk(quizzes([initial,80,80,70])).classification,'At Risk');
    assert.equal(classifyRisk(quizzes([initial,80,80,70,70])).classification,'Needs Support');
  }
});
test('M7 evaluates all completed attempts chronologically and emits deterministic transitions', () => {
  const input = quizzes([85,77,74,70,80,80]);
  input.push({...input[0],id:'incomplete',status:'in_progress',score:0});
  const result = classifyRisk([...input].reverse());
  assert.deepEqual(result,classifyRisk(input));
  assert.deepEqual(result.events.map(e => e.classification),['Early Warning','At Risk','Needs Support','On Track']);
  assert.deepEqual(result.events.map(e => e.previous_classification),['On Track','Early Warning','At Risk','Needs Support']);
  assert.equal(new Set(result.events.map(e => `${e.attempt_id}:${e.classification}`)).size,4);
});
test('M7 needs support takes priority and never drops to At Risk; no evidence is No assessment data', () => {
  assert.equal(classifyRisk(quizzes([74,59])).classification,'Needs Support');
  assert.equal(classifyRisk(quizzes([59,65])).classification,'Needs Support');
  assert.equal(classifyRisk(quizzes([59,80,65])).classification,'Needs Support');
  assert.deepEqual(classifyRisk([]),{classification:'No assessment data',recoveryCount:0,events:[]});
  assert.equal(classifyRisk([{id:'x',status:'completed',completedAt:'2026-01-01T00:00:00Z',score:null}]).classification,'No assessment data','invalid evidence is not a low score');
});

const { authorizeAdminRequest } = require('../services/adminUserService');
const { authorizeTeacherOralReadingRequest, authorizeOralReadingRequest } = require('../services/oralReadingAttemptService');
function authDependencies(profile) {
  const query = { select() { return this; }, eq() { return this; }, async single() {return {data:profile,error:null};} };
  return { getAuthenticatedSupabaseUser: async () => ({id:'current-user'}), getSupabaseAdmin: () => ({from:() => query}) };
}
test('M7 reused authorization rejects wrong roles and unapproved teachers', async () => {
  for (const role of ['student','general_user','teacher']) await assert.rejects(authorizeAdminRequest({},authDependencies({role})), /Admin access/);
  for (const profile of [{role:'student'},{role:'admin'},{role:'teacher',teacher_status:'pending'}]) await assert.rejects(authorizeTeacherOralReadingRequest({},authDependencies(profile)), /Approved Teacher/);
  await assert.rejects(authorizeOralReadingRequest({},authDependencies({role:'teacher'})));
  assert.equal((await authorizeAdminRequest({},authDependencies({role:'admin'}))).user.id,'current-user');
  assert.equal((await authorizeTeacherOralReadingRequest({},authDependencies({role:'teacher',teacher_status:'approved'}))).user.id,'current-user');
  assert.equal((await authorizeOralReadingRequest({},authDependencies({role:'student'}))).user.id,'current-user');
});

test('M7 chronology respects timezone offsets and PostgreSQL sub-millisecond timestamps', () => {
  const { compareCompletedQuizzes } = require('../services/m7Risk');
  const input = [
    {id:'a',completedAt:'2026-01-01T00:00:00.000002+00:00'},
    {id:'z',completedAt:'2026-01-01T08:00:00.000001+08:00'},
    {id:'b',completedAt:'2026-01-01T00:00:00+00:00'},
  ];
  assert.deepEqual(input.sort(compareCompletedQuizzes).map(q => q.id),['b','z','a']);
});

test('M7 late older completion can supersede a formerly valid transition', () => {
  const input = quizzes([74,74,74]);
  const before = classifyRisk([input[0],input[2]]);
  const after = classifyRisk(input);
  assert.equal(before.events[1].attempt_id,input[2].id);
  assert.equal(before.events[1].classification,'Needs Support');
  assert.equal(after.events[1].attempt_id,input[1].id);
  assert.equal(after.events[1].classification,'Needs Support');
  assert.ok(!after.events.some(e => e.attempt_id === input[2].id));
});

test('M7 worker sends only queue identity/version and retries failed database evaluation', async () => {
  const { drainRiskQueue } = require('../services/m7RiskWorker');
  const calls = [], retries = [];
  let fail = true;
  const db = {
    from(table) {
      assert.equal(table,'m7_risk_queue');
      return {
        select() { return this; }, order() { return this; },
        async limit() {return {data:[{id:'student-id',generation:7}],error:null};},
        update(value) {retries.push(value);return this;}, eq() {return this;},
      };
    },
    async rpc(name,args) {calls.push({name,args});return {data:!fail,error:fail ? {message:'retry'} : null};},
  };
  await drainRiskQueue({getSupabaseAdmin:()=>db});
  fail = false;
  await drainRiskQueue({getSupabaseAdmin:()=>db});
  assert.equal(retries.length,1);
  assert.equal(calls.length,2);
  for (const call of calls) assert.deepEqual(call,{name:'m7_save_evaluation',args:{target_student:'student-id',expected_generation:7}});
});
