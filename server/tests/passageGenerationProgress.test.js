const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAdminModulePassagesRouter } = require('../routes/adminModulePassages');
const { QuestionGenerationError } = require('../services/questionGenerationService');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const collection = {id:'module',revision:7,status:'draft',publishedAt:null,language:'en',passages:[{id:'passage',passageText:'A story.'}]};
async function serve(t,deps) {
  const app=express();app.use(express.json());app.use('/modules',createAdminModulePassagesRouter({authenticate:async()=>({id:'admin'}),...deps}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}/modules/module/passages/passage`;
  return {post:()=>fetch(base+'/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:7})}),
    status:()=>fetch(base+'/generation-status?revision=7')};
}
test('progress is real, concurrent clicks generate once, cached status still requires Admin access',async t=>{
  const generation=deferred(),save=deferred(),started=deferred(),saving=deferred();let calls=0,denied=false;
  const api=await serve(t,{
    client:{rpc:async name=>{if(name==='m3_admin_collection')return denied?{error:{}}:{data:collection};saving.resolve();await save.promise;return {data:8};}},
    generate:async()=>{calls++;started.resolve();await generation.promise;return [];},
  });
  const first=api.post();await started.promise;
  assert.equal((await (await api.status()).json()).state,'generating');
  assert.equal((await api.post()).status,409);assert.equal(calls,1);
  generation.resolve();await saving.promise;
  assert.equal((await (await api.status()).json()).state,'saving');
  save.resolve();assert.equal((await first).status,200);
  assert.equal((await (await api.status()).json()).state,'saved');
  assert.equal((await api.post()).status,409);assert.equal(calls,1);
  denied=true;assert.equal((await api.status()).status,403);
});
test('provider timeout has neutral text and no automatic second request',async t=>{
  let calls=0;
  const api=await serve(t,{client:{rpc:async()=>({data:collection})},generate:async()=>{
    calls++;throw new QuestionGenerationError('GEMINI_TIMEOUT',504,'Gemini secret-provider detail');
  }});
  const response=await api.post();assert.equal(response.status,504);
  const body=await response.json();assert.doesNotMatch(body.message,/Gemini|secret-provider/);
  assert.equal(calls,1);assert.equal((await (await api.status()).json()).state,'failed');
});
test('lost database save response remains uncertain and cannot trigger another generation',async t=>{
  let calls=0;
  const api=await serve(t,{client:{rpc:async name=>name==='m3_admin_collection'?{data:collection}:{error:{message:'fetch failed'}}},
    generate:async()=>{calls++;return [];}});
  const body=await (await api.post()).json();assert.equal(body.state,'unknown');
  assert.doesNotMatch(body.message,/No questions were saved|fetch|API/);
  assert.equal((await api.post()).status,409);assert.equal(calls,1);
  assert.equal((await (await api.status()).json()).state,'unknown');
});
