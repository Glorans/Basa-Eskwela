const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMaterialsRouter } = require('../routes/materials');
const { QuestionGenerationError } = require('../services/questionGenerationService');
const personal = require('../services/personalMaterialService');
const id = '11111111-1111-4111-8111-111111111111';
const friendly = "We couldn't generate a new question set. Please try again.";
test('both saved-set and private-generation routes hide provider diagnostics and log safe codes', async t => {
 let current = new QuestionGenerationError('GEMINI_TIMEOUT', 504, 'Gemini secret=unsafe', new Error('API_KEY=secret'));
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
 t.mock.method(personal,'generatePersonalQuestions',async()=>{throw current;});
 const app=express();app.use(express.json());
 app.use('/api/materials',createMaterialsRouter({
  authorizeMaterialRequest:async()=>({user:{id},profile:{role:'general_user'}}),
  generateMaterialQuestionSet:async()=>{throw current;},
  personalGenerationLimiter:{take:()=>({allowed:true})},
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/materials/${id}`;
 for(const endpoint of ['/question-sets','/personal-practice/generate']) {
  for(const [code,status] of [['GEMINI_TIMEOUT',504],['GEMINI_REQUEST_FAILED',502],['MISSING_GEMINI_API_KEY',503],['INVALID_GEMINI_RESPONSE',502],['MALFORMED_GEMINI_RESPONSE',502],['QUESTION_LANGUAGE_MISMATCH',422]]) {
   current=new QuestionGenerationError(code,status,'Gemini secret=unsafe');
   const response=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   assert.equal(response.status,status);assert.deepEqual(await response.json(),{success:false,message:friendly});
  }
  current=new QuestionGenerationError('MISSING_CONTENT_TEXT',400,'raw internal message');
  const response=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal((await response.json()).message,'Reviewed material text is required before generating questions.');
 }
 assert.match(JSON.stringify(logs),/GEMINI_TIMEOUT/);
 assert.doesNotMatch(JSON.stringify(logs),/secret|unsafe|API_KEY=/);
});
test('unexpected failures keep a useful but sanitized developer log and a friendly response', async t => {
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
 const token='x'.repeat(40);
 const app=express();app.use(express.json());
 app.use('/api/materials',createMaterialsRouter({
  authorizeMaterialRequest:async()=>({user:{id},profile:{role:'teacher'}}),
  generateMaterialQuestionSet:async()=>{const e=new TypeError(`Cannot read properties of undefined (reading 'rows') api_key=AIzaSECRET bearer ${token}`);e.code='ERR_X';throw e;},
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/materials/${id}/question-sets`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,500);
 assert.deepEqual(await response.json(),{success:false,message:friendly});
 const logged=JSON.stringify(logs);
 assert.match(logged,/TypeError/);assert.match(logged,/ERR_X/);assert.match(logged,/reading 'rows'/);
 assert.doesNotMatch(logged,/AIzaSECRET/);assert.doesNotMatch(logged,new RegExp(token));
});
test('a database refusal during personal generation is logged (sanitized) and the learner sees the friendly message', async t => {
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
 t.mock.method(personal,'generatePersonalQuestions',async()=>{throw new personal.PersonalMaterialError('Invalid private question or evidence');});
 const app=express();app.use(express.json());
 app.use('/api/materials',createMaterialsRouter({
  authorizeMaterialRequest:async()=>({user:{id},profile:{role:'general_user'}}),
  personalGenerationLimiter:{take:()=>({allowed:true})},
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/materials/${id}/personal-practice/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,409);
 assert.equal((await response.json()).message,'Invalid private question or evidence');
 const logged=JSON.stringify(logs);
 assert.match(logged,/Personal question generation refused/);assert.match(logged,/"statusCode":409/);assert.match(logged,/Invalid private question or evidence/);
});
