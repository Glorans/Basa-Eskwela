const test = require('node:test');
const assert = require('node:assert/strict');
const { quizzes } = require('../services/m7Analytics');
const question = {id:'question',type:'literal',options:['a','b','c','d'],correctOptionIndex:0};
const valid = {id:'valid',user_id:'student',room_id:'room',completed_at:'2026-10-02T00:00:00Z',status:'completed',question_snapshot:[question]};
const response = {attempt_id:'valid',question_id:'question',first_option_index:0,resolved:true};
function loader(attempts, responses=[response]) {
  return async (table, columns, filters) => table === 'm6_comprehension_attempts' ? attempts : responses.filter(r => filters.attempt_id.includes(r.attempt_id));
}
test('valid assessments retain scores; malformed evidence has no synthetic score', async () => {
  for (const patch of [{question_snapshot:null},{question_snapshot:[]},{completed_at:null},{question_snapshot:[question,question]}]) {
    const result=await quizzes({}, {rows:loader([valid,{...valid,...patch,id:'bad'}])});
    assert.equal(result.find(q=>q.id==='valid').score,100);
    assert.equal(result.find(q=>q.id==='bad').score,null);
    assert.ok(result.find(q=>q.id==='bad').dataQuality);
  }
  const incomplete=await quizzes({}, {rows:loader([valid],[])});
  assert.ok(incomplete[0].dataQuality);
});
test('scope predicates run before response retrieval and scoring', async () => {
  const bad={...valid,id:'bad',room_id:'other',question_snapshot:null};
  const load=loader([valid,bad]);
  const result=await quizzes({}, {include:a=>a.room_id==='room',rows:async(table,columns,filters)=>{
    if(table==='m6_comprehension_responses') assert.deepEqual(filters.attempt_id,['valid']);
    return load(table,columns,filters);
  }});
  assert.equal(result.length,1);assert.equal(result[0].score,100);
});
test('retrieval failures remain errors rather than missing assessments', async()=>{
  await assert.rejects(quizzes({}, {rows:async(table)=>{if(table==='m6_comprehension_attempts') return [valid];throw Error('network');}}),/network/);
});
