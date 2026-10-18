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


try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5178/diagnostic/en/result'});
  await until('!!window.review');
  for (const [language,count,title] of [['en',5,'The Gift'],['fil',5,'Ang Matanda']]) {
    await evaluate('sessionStorage.clear()');
    await send('Page.navigate',{url:'http://127.0.0.1:5178/diagnostic/'+language+'/reading'});
    await until('!!document.querySelector(".diagnostic-story-card")');
    assert.ok(await evaluate('document.body.textContent.includes('+JSON.stringify(title)+')'));
    await evaluate('(async()=>{const {requireDiagnosticAssessment}=await import("/src/modules/module2/data/diagnosticData.ts");const a=requireDiagnosticAssessment('+JSON.stringify(language)+');const {diagnosticSessionKey,serializeDiagnosticSession}=await import("/src/modules/module2/services/diagnosticSession.ts");const {calculateOralReadingMetrics}=await import("/src/modules/module2/services/diagnosticScoring.ts");const text=a.passage.paragraphs.join(" ");sessionStorage.setItem(diagnosticSessionKey("test-reader",a),serializeDiagnosticSession({assessmentId:a.id,assessmentVersion:a.version,answers:{},questionIndex:0,reading:{language:a.language,transcription:{text},oralReadingMetrics:calculateOralReadingMetrics(text,text,60,a.language)}},"test-reader"));})()');
    await send('Page.navigate',{url:'http://127.0.0.1:5178/diagnostic/'+language+'/questions'});
    for(let i=0;i<count;i++) {
      await until('document.querySelector(".diagnostic-question-counter")?.textContent.trim()==='+JSON.stringify('Question '+(i+1)+' of '+count));
      await evaluate('(async()=>{const {requireDiagnosticAssessment}=await import("/src/modules/module2/data/diagnosticData.ts");const q=requireDiagnosticAssessment('+JSON.stringify(language)+').questions['+i+'];document.querySelector("input[value="+q.correctChoiceId+"]").click();})()');
      if(i===1) {await send('Page.reload');await until('!!document.querySelector("input:checked")');}
      await evaluate('document.querySelector(".diagnostic-actions button").click()');
    }
    await until('location.pathname==='+JSON.stringify('/diagnostic/'+language+'/result')+' && !!document.querySelector("#diagnostic-result-title")');
    assert.equal(await evaluate('document.querySelector("#diagnostic-result-title").textContent'),(language==='fil'?'Filipino':'English')+' Reading Result');
    await send('Page.reload');await until('!!document.querySelector("#diagnostic-result-title") && !document.body.textContent.includes("Loading Your Reading Result")');
    const saved=await evaluate('JSON.parse(sessionStorage.getItem("review-results"))');
    assert.equal(saved.length,1);assert.equal(saved[0].language,language);assert.equal(saved[0].comprehension_score,100);assert.equal(saved[0].assessment_type,'initial');
    console.log(language+': reading route, '+count+' question counters, refresh, save and result route passed');
  }
  assert.deepEqual(errors,[]);
} finally { await send('Page.close').catch(()=>{});ws.close(); }
