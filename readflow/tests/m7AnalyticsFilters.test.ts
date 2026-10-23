import test from 'node:test';
import assert from 'node:assert/strict';
import { bounds, periodDates, filterRecords, allTime } from '../src/modules/module7/services/analyticsFilters.ts';
test('Philippine Monday week rolls across UTC Sunday and year boundary',()=>{
 assert.deepEqual(periodDates('weekly',new Date('2025-12-28T16:00:00Z')),{startDate:'2025-12-29',endDate:'2026-01-04'});
});
test('calendar month and quarter handle leap years and year end',()=>{
 assert.deepEqual(periodDates('monthly',new Date('2024-02-15T00:00:00Z')),{startDate:'2024-02-01',endDate:'2024-02-29'});
 assert.deepEqual(periodDates('quarterly',new Date('2026-12-15T00:00:00Z')),{startDate:'2026-10-01',endDate:'2026-12-31'});
});
test('inclusive end day, exclusive next midnight, and saved classroom isolation',()=>{
 const scope={roomId:'a',startDate:'2026-10-01',endDate:'2026-10-01'};
 const records=[{roomId:'a',completedAt:'2026-09-30T16:00:00Z'},{roomId:'a',completedAt:'2026-10-01T15:59:59.999Z'},{roomId:'a',completedAt:'2026-10-01T16:00:00Z'},{roomId:'b',completedAt:'2026-10-01T00:00:00Z'},{roomId:null,completedAt:'2026-10-01T00:00:00Z'}];
 assert.deepEqual(filterRecords(records,scope),records.slice(0,2));
 assert.deepEqual(filterRecords(records,allTime),records);
});
test('invalid and reversed dates reject; malformed timestamps never enter a period',()=>{
 assert.throws(()=>bounds({...allTime,startDate:'2026-02-30',endDate:'2026-03-01'}));
 assert.throws(()=>bounds({...allTime,startDate:'2026-03-02',endDate:'2026-03-01'}));
 assert.deepEqual(filterRecords([{completedAt:'bad'}],{...allTime,startDate:'2026-03-01',endDate:'2026-03-01'}),[]);
});
