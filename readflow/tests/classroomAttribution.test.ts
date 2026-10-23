import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeClassroomAttempts } from '../src/modules/module7/services/classroomAttribution.ts';
const memberships = new Map([['single', new Set(['a'])], ['multi', new Set(['a','b'])]]);
test('stored classroom attributes single and multiple classroom learners exactly once', () => {
  const a = {id:'1',learnerId:'single',roomId:'a'};
  const result = attributeClassroomAttempts([a,a,{id:'2',learnerId:'multi',roomId:'b'}], memberships);
  assert.deepEqual(result.attemptsByClass.get('a'), [a]);
  assert.equal(result.attemptsByClass.get('b')?.length,1);
  assert.equal(result.unattributedReadingAttempts,0);
});
test('independent and legacy unattributed activities never inherit enrollment classroom', () => {
  const result = attributeClassroomAttempts([{id:'1',learnerId:'single',roomId:null},{id:'2',learnerId:'multi'}],memberships);
  assert.equal(result.attemptsByClass.size,0);
  assert.equal(result.unattributedReadingAttempts,2);
});
test('foreign classroom and removed enrollment records are excluded from all totals', () => {
  const result = attributeClassroomAttempts([{id:'1',learnerId:'single',roomId:'b'},{id:'2',learnerId:'removed',roomId:'a'}],memberships);
  assert.equal(result.attemptsByClass.size,0);
  assert.equal(result.unattributedReadingAttempts,0);
});
