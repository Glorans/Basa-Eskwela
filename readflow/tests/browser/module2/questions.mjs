import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const output = process.env.READFLOW_M2_BROWSER_OUTPUT || path.join(os.tmpdir(),'readflow-m2-completion-audit');
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch('http://127.0.0.1:9225/json/new?about:blank',{method:'PUT'})).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let nextId=0; const pending=new Map(); const errors=[];
ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression,timeout=10000){for(let elapsed=0;elapsed<timeout;elapsed+=50){if(await evaluate(expression))return;await pause(50);}throw new Error('Timed out: '+expression+' errors: '+errors.join('\n'));}

const reports=[];
async function seedQuestion(index) {
  await evaluate(`(async()=>{
    const {englishDiagnosticAssessment:assessment}=await import('/src/modules/module2/data/assessments/englishDiagnosticAssessment.ts');
    const {diagnosticSessionKey,serializeDiagnosticSession}=await import('/src/modules/module2/services/diagnosticSession.ts');
    const {calculateOralReadingMetrics}=await import('/src/modules/module2/services/diagnosticScoring.ts');
    const answers=Object.fromEntries(assessment.questions.slice(0,${index}+1).map(q=>[q.id,q.choices[0].id]));
    sessionStorage.clear();sessionStorage.setItem('review-save-error','1');
    sessionStorage.setItem(diagnosticSessionKey('test-reader',assessment),serializeDiagnosticSession({assessmentId:assessment.id,assessmentVersion:assessment.version,answers,questionIndex:${index},reading:{language:'en',transcription:{text:'the colorfully wrapped box'},oralReadingMetrics:calculateOralReadingMetrics(assessment.passage.paragraphs.join(' '),'the colorfully wrapped box',5)}},'test-reader'));
  })()`);
  await send('Page.navigate',{url:'http://127.0.0.1:5178/diagnostic/en/questions'});
  await until(`document.querySelector('.diagnostic-question-counter')?.textContent.includes('Question ${index+1} ')`);
  await evaluate('document.fonts.ready');
}
try {
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5178/diagnostic/en/result'});
  await until('!!window.review');
  for(const [width,height] of [[1440,900],[1366,768],[768,1024],[390,844],[1366,500]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<520});
    for(let index=0;index<5;index++) {
      await seedQuestion(index);
      if(index===4) {
        await evaluate("(()=>{const button=document.querySelector('.diagnostic-actions button');button.click();button.click()})()");
        await until("!!document.querySelector('.diagnostic-save-error')");
        assert.equal(await evaluate('review.saves'),1);
        assert.equal(await evaluate('review.scoreAudits.length'),0,'A failed save is not a completed assessment');
        assert.equal(await evaluate("document.querySelector('.diagnostic-actions button').textContent"),'Try Saving Again');
        assert.equal(await evaluate("!!document.querySelector('input:checked')"),true);
        assert.equal(await evaluate("document.body.textContent.includes('42703')"),false);
      }
      const metrics=await evaluate(`(()=>{
        const panel=document.querySelector('.diagnostic-questions-panel');const card=document.querySelector('.diagnostic-question-card');const button=document.querySelector('.diagnostic-actions button');
        return {scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,scrollbar:getComputedStyle(panel).scrollbarWidth,overflow:getComputedStyle(panel).overflowY,cardOverflow:getComputedStyle(card).overflowY,horizontal:document.documentElement.scrollWidth>innerWidth,buttonBottom:button.getBoundingClientRect().bottom,panelBottom:panel.getBoundingClientRect().bottom};
      })()`);
      assert.equal(metrics.scrollbar,'none');assert.equal(metrics.overflow,'auto');assert.equal(metrics.cardOverflow,'visible');assert.equal(metrics.horizontal,false);
      if(width>=1000 && height>=768) {assert.ok(metrics.scrollHeight<=metrics.clientHeight+1,JSON.stringify({width,height,index,metrics}));assert.ok(metrics.buttonBottom<=metrics.panelBottom);}
      else {await evaluate("document.querySelector('.diagnostic-questions-panel').scrollTop=10000");assert.equal(await evaluate("document.querySelector('.diagnostic-actions button').getBoundingClientRect().bottom<=document.querySelector('.diagnostic-questions-panel').getBoundingClientRect().bottom"),true);}
      reports.push({width,height,question:index+1,...metrics});
    }
    console.log(`PASS all five questions and save-error retry at ${width}x${height}`);
  }
  await evaluate("sessionStorage.removeItem('review-save-error');document.querySelector('.diagnostic-actions button').click()");
  await until("document.querySelector('h1')?.textContent==='English Reading Result'");
  assert.equal(await evaluate('review.saves'),2);
  assert.equal(await evaluate('review.scoreAudits.length'),1,'Exactly one developer audit after successful retry');
  const audit=await evaluate('review.scoreAudits[0]');
  assert.equal(audit.googleFinalTranscript,'the colorfully wrapped box');
  assert.deepEqual(audit.normalizedTranscriptTokens,['the','colorfully','wrapped','box']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.diagnostic-practice-list li > span')].map(word=>word.textContent)"),audit.practiceWords);
  assert.equal(await evaluate("document.body.textContent.includes('[M2 SCORE AUDIT]')"),false);
  await send('Page.reload');await until("document.querySelector('h1')?.textContent==='English Reading Result'");
  assert.equal(await evaluate('review.scoreAudits.length'),0,'Refreshing a result must not emit another completion audit');
  assert.deepEqual(errors,[]);
  console.log('PASS failed save preserves answers, suppresses duplicate submission, hides database errors, and succeeds on retry');
  console.log('PASS one development-only completion audit matches the final transcript and displayed practice words; result refresh emits none');
} finally {fs.writeFileSync(path.join(output,'questions-report.json'),JSON.stringify({reports,errors},null,2));await fetch('http://127.0.0.1:9225/json/close/'+target.id);ws.close();}
