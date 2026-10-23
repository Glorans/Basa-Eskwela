const test = require('node:test');
const assert = require('node:assert/strict');
const { listWeeklyReports, getSavedWeeklyReport } = require('../services/weeklyReportStorage');
const { createWeeklyReportsRouter } = require('../routes/weeklyReports');
const { SupabaseAuthenticationError } = require('../services/supabaseAdmin');
const { OralReadingAuthorizationError } = require('../services/oralReadingAttemptService');
const owner = {user:{id:'teacher'}};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function rows(count) {
  return Array.from({length:count},(_,i)=>({id:id(i),teacher_id:'teacher',created_at:'2026-10-22T00:00:00.123456+00:00',period_start:'2026-10-01',period_end:'2026-10-07',report_data:{snapshot:i}}));
}
function database(records, fail = false, cap = Infinity, failOnRead = Infinity) {
  let reads = 0;
  return {from() {
    const filters=[];let limit=Infinity;
    const query={
      select(){return this;},eq(key,value){filters.push(r=>r[key]===value);return this;},order(){return this;},limit(n){limit=n;return this;},
      or(expression){
        const match=/^created_at.lt.(.+),and\(created_at.eq.(.+),id.lt.([^)]*)\)$/.exec(expression);
        assert.ok(match);assert.equal(match[1],match[2]);
        filters.push(r=>r.created_at<match[1] || (r.created_at===match[1] && r.id<match[3]));return this;
      },
      result(){return fail || ++reads === failOnRead ? {data:null,error:{message:'offline'}} : {data:records.filter(r=>filters.every(f=>f(r))).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,Math.min(limit,cap)),error:null};},
      then(resolve){return Promise.resolve(resolve(this.result()));},
      async maybeSingle(){const result=this.result();return {...result,data:result.data?.[0]??null};},
    };return query;
  }};
}
const deps = records => ({getSupabaseAdmin:()=>database(records)});

test('more than 100 reports are reachable once, with stable ties and microsecond cursor precision',async()=>{
  const records=rows(123);records.push({...rows(1)[0],id:id(999),teacher_id:'other'});
  let cursor;const seen=[];const sizes=[];
  do {
    const page=await listWeeklyReports(owner,deps(records),{cursor});
    sizes.push(page.reports.length);seen.push(...page.reports.map(r=>r.id));
    cursor=page.nextCursor;
    if(cursor) assert.equal(JSON.parse(Buffer.from(cursor,'base64url')).createdAt,'2026-10-22T00:00:00.123456+00:00');
  } while(cursor);
  assert.deepEqual(sizes,[50,50,23]);assert.equal(new Set(seen).size,123);
  assert.deepEqual(seen,rows(123).reverse().map(r=>r.id));
  const oldest=await getSavedWeeklyReport(owner,id(0),deps(records));
  assert.deepEqual(oldest.report,{snapshot:0});
});

test('new inserts and deletion of the boundary row do not shift or duplicate older pages',async()=>{
  const records=rows(105);const first=await listWeeklyReports(owner,deps(records));
  records.push({...rows(1)[0],id:id(1000),created_at:'2026-10-23T00:00:00.000001+00:00'});
  records.splice(records.findIndex(r=>r.id===first.reports.at(-1).id),1);
  const second=await listWeeklyReports(owner,deps(records),{cursor:first.nextCursor});
  assert.deepEqual(second.reports.map(r=>r.id),rows(55).reverse().slice(0,50).map(r=>r.id));
  assert.ok(second.reports.every(r=>!first.reports.some(previous=>previous.id===r.id)));
});

test('empty histories and exact page boundaries have correct continuation metadata',async()=>{
  for(const count of [0,1,49,50,51,100]) {
    const records=rows(count);let cursor;let total=0;
    do {
      const page=await listWeeklyReports(owner,deps(records),{cursor});total+=page.reports.length;cursor=page.nextCursor;
      assert.equal(Boolean(cursor),total<count);
    } while(cursor);
    assert.equal(total,count);
  }
});

test('invalid cursors are rejected before database access',async()=>{
  for(const cursor of ['',[],{},'garbage',Buffer.from(JSON.stringify({id:id(1),createdAt:'x),teacher_id.eq.other'})).toString('base64url')]) {
    await assert.rejects(listWeeklyReports(owner,{getSupabaseAdmin:()=>{throw Error('unexpected query');}},{cursor}),{statusCode:400});
  }
});

test('a cursor never overrides ownership; foreign report IDs cannot be opened',async()=>{
  const records=rows(70);const page=await listWeeklyReports(owner,deps(records));
  const other={user:{id:'other'}};
  assert.deepEqual((await listWeeklyReports(other,deps(records),{cursor:page.nextCursor})).reports,[]);
  await assert.rejects(getSavedWeeklyReport(other,id(1),deps(records)),{statusCode:404});
});

test('history database failures remain errors',async()=>{
  await assert.rejects(listWeeklyReports(owner,{getSupabaseAdmin:()=>database([],true)}),/Unable to load/);
});

function response() {return {statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
test('listing and detail routes enforce authentication and approved teacher authorization before storage',async()=>{
  for(const error of [new SupabaseAuthenticationError('Sign in'),new OralReadingAuthorizationError('Approved Teacher access is required.')]) {
    const router=createWeeklyReportsRouter({authorizeTeacherOralReadingRequest:async()=>{throw error;},listWeeklyReports:async()=>{assert.fail('Unauthorized listing');},getSavedWeeklyReport:async()=>{assert.fail('Unauthorized detail');}});
    for(const path of ['/','/:reportId']) {
      const handler=router.stack.find(layer=>layer.route?.path===path && layer.route.methods.get).route.stack[0].handle;
      const res=response();await handler({query:{},params:{reportId:id(0)}},res);
      assert.equal(res.statusCode,error instanceof SupabaseAuthenticationError ? 401 : 403);
    }
  }
});

test('listing route forwards cursor and returns page metadata',async()=>{
  const records=rows(51);const first=await listWeeklyReports(owner,deps(records));
  const router=createWeeklyReportsRouter({...deps(records),authorizeTeacherOralReadingRequest:async()=>owner});
  const handler=router.stack.find(layer=>layer.route?.path==='/' && layer.route.methods.get).route.stack[0].handle;
  const res=response();await handler({query:{cursor:first.nextCursor}},res);
  assert.equal(res.body.success,true);assert.equal(res.body.reports.length,1);assert.equal(res.body.nextCursor,null);
});

test('reduced caps preserve complete authorized history and exact boundaries', async () => {
  for (const cap of [1, 7, 25, 50]) {
    for (const count of [0, 1, 49, 50, 51, 100, 123]) {
      const records = rows(count);
      records.forEach((row, index) => {
        if (index >= 60) row.created_at = '2026-10-23T00:00:00.123456+00:00';
      });
      const expected = [...records].reverse().map(row => row.id);
      records.push({...rows(1)[0], id:id(999), teacher_id:'other'});
      const dependencies = {getSupabaseAdmin: () => database(records, false, cap)};
      let cursor;
      const seen = [];
      do {
        const page = await listWeeklyReports(owner, dependencies, {cursor});
        assert.equal(page.reports.length, Math.min(50, count - seen.length));
        seen.push(...page.reports.map(row => row.id));
        cursor = page.nextCursor;
        assert.equal(Boolean(cursor), seen.length < count);
      } while (cursor);
      assert.deepEqual(seen, expected);
      assert.equal(new Set(seen).size, count);
    }
  }
});

test('later reads and lookahead failures reject the entire page and allow retry', async () => {
  const records = rows(123);
  const first = await listWeeklyReports(owner, deps(records));
  for (const cursor of [undefined, first.nextCursor]) {
    for (const failOnRead of [2, 8]) {
      await assert.rejects(listWeeklyReports(owner, {
        getSupabaseAdmin: () => database(records, false, 7, failOnRead),
      }, {cursor}), /Unable to load/);
      const retry = await listWeeklyReports(owner, {
        getSupabaseAdmin: () => database(records, false, 7),
      }, {cursor});
      assert.equal(retry.reports.length, 50);
      assert.ok(retry.nextCursor);
      assert.deepEqual(retry, await listWeeklyReports(owner, deps(records), {cursor}));
    }
  }
});
