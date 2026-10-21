const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRisk } = require('../services/m7Risk');
const quizzes = scores => scores.map((score,i) => ({ id: String(i).padStart(3,'0'), score, status:'completed', completedAt: new Date(Date.UTC(2026,0,i+1)).toISOString() }));
test('M7 boundaries and consecutive scores', () => {
  for (const [scores,expected] of [ [[74],'On Track'], [[74,74],'Early Warning'], [[74,74,74],'At Risk'], [[59,59,59],'Needs Support'], [[60,60,60],'At Risk'], [[74,75,74],'On Track'], [[75,75,75],'On Track'] ]) assert.equal(classifyRisk(quizzes(scores)).classification,expected);
});
test('M7 risk persists until two consecutive passing scores and can recur', () => {
  for (const initial of [59,74]) {
    assert.equal(classifyRisk(quizzes([initial,initial,initial,75])).classification,initial === 59 ? 'Needs Support':'At Risk');
    assert.equal(classifyRisk(quizzes([initial,initial,initial,75,74,75])).classification,initial === 59 ? 'Needs Support':'At Risk');
    assert.equal(classifyRisk(quizzes([initial,initial,initial,75,75])).classification,'On Track');
    assert.equal(classifyRisk(quizzes([initial,initial,initial,75,75,74,74])).classification,'Early Warning');
  }
});
test('M7 evaluates all completed attempts chronologically and emits deterministic transitions', () => {
  const input = quizzes([74,74,74,75,75]);
  input.push({...input[0],id:'incomplete',status:'in_progress',score:0});
  const result = classifyRisk([...input].reverse());
  assert.deepEqual(result,classifyRisk(input));
  assert.deepEqual(result.events.map(e => e.classification),['Early Warning','At Risk','On Track']);
  assert.equal(new Set(result.events.map(e => `${e.attempt_id}:${e.classification}`)).size,3);
});
test('M7 needs support takes priority and does not downgrade on one better score', () => {
  assert.equal(classifyRisk(quizzes([74,74,74,59,59,59])).classification,'Needs Support');
  assert.equal(classifyRisk(quizzes([59,59,59,65,65,65])).classification,'Needs Support');
  assert.equal(classifyRisk([]).classification,'On Track');
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
  assert.equal(before.events[0].attempt_id,input[2].id);
  assert.equal(before.events[0].classification,'Early Warning');
  assert.equal(after.events[0].attempt_id,input[1].id);
  assert.equal(after.events[1].classification,'At Risk');
  assert.ok(!after.events.some(e => e.attempt_id === input[2].id && e.classification === 'Early Warning'));
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
