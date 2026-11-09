import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAdminClassroomLabels } from '../src/modules/module7/services/adminClassroomLabels.ts';
import { adminSystem } from './fixtures/m7Performance.ts';
import type { AdminSystemData } from '../src/modules/module7/services/m7Service.ts';
const ids = ['0081dff8-2b57-40cd-a973-622a0b1174cf', '1181dff8-2b57-40cd-a973-622a0b1174cf', '2281dff8-2b57-40cd-a973-622a0b1174cf'];
function details() {
  return { ...adminSystem.details,
    classroomOptions: ids.map(id => ({id,name:'Grade 5'})),
    classroomComparisons: ids.map((id,index) => ({...adminSystem.details.classroomComparisons[index],id,name:'Grade 5',teacherName:index === 2 ? 'Another Teacher' : 'Rose Ansay'})),
  } as AdminSystemData['details'];
}
test('Admin labels use real codes only for identical classroom/teacher names, retaining IDs and all metrics', async () => {
  const data = details(), before = structuredClone(data), requested:string[] = [];
  const labels = await loadAdminClassroomLabels(data, async id => {requested.push(id);return {id,room_code:id === ids[0] ? 'ABC123' : 'XYZ789'};});
  assert.deepEqual(labels.map(r=>r.id),ids);
  assert.deepEqual(labels.map(r=>r.label), ['Grade 5 \u2014 Rose Ansay \u00b7 Room ABC123','Grade 5 \u2014 Rose Ansay \u00b7 Room XYZ789','Grade 5 \u2014 Another Teacher']);
  assert.deepEqual(requested,ids.slice(0,2));
  for (const label of labels) for (const id of ids) assert.ok(!label.label.includes(id));
  assert.deepEqual(data,before);
});
test('Scoped comparisons retain all authorized filter labels and cached room codes', async () => {
  const data = details();
  const labels = await loadAdminClassroomLabels(data, async id => ({id,room_code:id === ids[0] ? 'ABC123':'XYZ789'}));
  const filtered = {...data,classroomComparisons:data.classroomComparisons.slice(1,2)};
  const again = await loadAdminClassroomLabels(filtered, async()=>{throw Error('must use cached codes');}, labels);
  assert.deepEqual(again, labels);
});
test('Denied, mismatched or invalid room metadata never exposes IDs or adds unauthorized rooms', async () => {
  for (const loader of [async()=>{throw Error('Denied');}, async()=>({id:'unauthorized',room_code:'SECRET'}), async(id:string)=>({id,room_code:id})]) {
    const labels = await loadAdminClassroomLabels(details(),loader);
    assert.deepEqual(labels.map(r=>r.id),ids);
    assert.equal(new Set(labels.map(r=>r.label)).size,3);
    assert.match(labels[0].label,/Classroom 1 \(room code unavailable\)/);
    assert.match(labels[1].label,/Classroom 2 \(room code unavailable\)/);
    assert.ok(!labels.some(r=>r.label.includes('SECRET') || ids.some(id=>r.label.includes(id))));
  }
});
