import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const output = process.env.READFLOW_M2_BROWSER_OUTPUT || path.join(os.tmpdir(),'readflow-m2-completion-audit');
fs.mkdirSync(output, { recursive: true });
const longRecording = process.env.READFLOW_M2_LONG_RECORDING === '1';
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
const stats=async()=>await(await fetch('http://127.0.0.1:5019/stats')).json();
const click=async label=>evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes(${JSON.stringify(label)})).click()`);
const state=()=>evaluate(`({requests:review.microphoneRequests,recorders:review.recorders.map(r=>r.state),contexts:review.contexts.map(c=>({state:c.state,sampleRate:c.sampleRate})),tracks:review.stream?.getTracks().map(t=>t.readyState),browserStarts:review.browserRecognitionStarts,visualRead:document.querySelectorAll('[data-reading-state=read]').length,status:document.querySelector('.diagnostic-recording-status')?.textContent})`);

const reports=[];
async function navigate(route){await send('Page.navigate',{url:'http://127.0.0.1:5178'+route});await until("!!window.review && !!document.querySelector('h1')");}
async function reset(){await navigate('/diagnostic/en/result');await evaluate('sessionStorage.clear()');await navigate('/diagnostic/en/reading');await until("!!document.querySelector('.diagnostic-record-button')");}
async function doubleClick(label){await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)}));b.click();b.click()})()`)}

async function checkStoryScroll(width, height, reducedMotion) {
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<520});
 await send('Emulation.setTouchEmulationEnabled',{enabled:width<520});
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reducedMotion?'reduce':'no-preference'}]});
 await reset();
 // The shorter replacement passage can fit on desktop. Constrain only the test
 // viewport so this overflow-specific check still exercises automatic scrolling.
 await evaluate("Object.assign(document.querySelector('.diagnostic-story-card').style,{height:'240px',maxHeight:'240px'})");
 await click('Start recording');await pause(1600);
 await until("document.querySelectorAll('[data-reading-state=read]').length===4");
 await evaluate(`(()=>{
   const card=document.querySelector('.diagnostic-story-card');
   const words=[...card.querySelectorAll('.diagnostic-story-word')];
   review.words=words;review.scrollCalls=[];
   review.outerScroll=[scrollX,scrollY,document.querySelector('.diagnostic-shell__panel').scrollTop];
   const nativeScroll=card.scrollTo.bind(card);
   card.scrollTo=options=>{review.scrollCalls.push({...options,index:words.findLastIndex(w=>w.dataset.readingState==='read')});nativeScroll(options)};
   review.readTo=(index,suffix='')=>review.sockets.findLast(s=>s.url.includes('/ws/diagnostic/speech') && s.readyState===1).dispatchEvent(
     new MessageEvent('message',{data:JSON.stringify({type:'interim',text:words.slice(4,index+1).map(w=>w.textContent).join(' ')+suffix})}));
 })()`);
 const boundary=await evaluate(`review.words.findIndex(w=>w.getBoundingClientRect().bottom-document.querySelector('.diagnostic-story-card').getBoundingClientRect().top-document.querySelector('.diagnostic-story-card').clientTop>=document.querySelector('.diagnostic-story-card').clientHeight*.68)`);
 assert.ok(boundary>4);
 async function readTo(index) {
   await evaluate(`review.readTo(${index})`);
   await until(`review.words[${index}].dataset.readingState==='read'`);
 }
 async function settleScroll() {
   await until("!review.scrollCalls.length || Math.abs(document.querySelector('.diagnostic-story-card').scrollTop-review.scrollCalls.at(-1).top)<2");
 }
 await readTo(boundary-1);
 assert.equal(await evaluate('review.scrollCalls.length'),0,'Comfortably visible words must not scroll');
 await readTo(boundary);
 await until('review.scrollCalls.length===1');
 assert.equal(await evaluate('review.scrollCalls[0].behavior'),reducedMotion?'auto':'smooth');
 // Rapid progression along one line must not repeatedly restart its animation.
 const sameLineEnd=await evaluate(`review.words.findLastIndex(w=>Math.abs(w.getBoundingClientRect().bottom-review.words[${boundary}].getBoundingClientRect().bottom)<1)`);
 await readTo(sameLineEnd);
 await settleScroll();
 assert.equal(await evaluate('review.scrollCalls.length'),1);
 for(const suffix of ['', ' unrecognizedword', '']) {
   await evaluate(`review.readTo(${sameLineEnd},${JSON.stringify(suffix)})`);await pause(60);
 }
 assert.equal(await evaluate('review.scrollCalls.length'),1,'Duplicate/revised transcripts must not scroll again');

 const beforeWheel=await evaluate("document.querySelector('.diagnostic-story-card').scrollTop");
 const point=await evaluate("(()=>{const r=document.querySelector('.diagnostic-story-card').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:80});
 await until(`document.querySelector('.diagnostic-story-card').scrollTop>${beforeWheel}+10`);
 if(width<520) {
   const beforeTouch=await evaluate("document.querySelector('.diagnostic-story-card').scrollTop");
   await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
   for(let delta=10;delta<=60;delta+=10) {
     await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y+delta}]});
     await pause(30);
   }
   await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await until(`document.querySelector('.diagnostic-story-card').scrollTop<${beforeTouch}-10`);
 }
 assert.equal(await evaluate('review.scrollCalls.length'),1,'Native wheel/touch input must remain independent');

 const wordCount=await evaluate('review.words.length');
 for(let index=sameLineEnd+1;index<wordCount;index=Math.min(index+8,wordCount-1)) {
   const count=await evaluate('review.scrollCalls.length');
   await readTo(index);
   if(await evaluate('review.scrollCalls.length')>count)await settleScroll();
   const visibility=await evaluate(`(()=>{const c=document.querySelector('.diagnostic-story-card'),r=review.words[${index}].getBoundingClientRect();return {bottom:r.bottom-c.getBoundingClientRect().top-c.clientTop,height:c.clientHeight}})()`);
   assert.ok(visibility.bottom<=visibility.height+2,'Reading must keep following through later paragraphs');
   if(index===wordCount-1)break;
 }
 const calls=await evaluate('review.scrollCalls');
 assert.ok(calls.length>=1,'Overflow triggers scrolling; later words must stay visible without requiring redundant scrolls');
 assert.equal(new Set(calls.map(call=>call.index)).size,calls.length,'At most one scroll per advancing word index');
 assert.ok(calls.every((call,index)=>!index || call.top>calls[index-1].top));
 assert.deepEqual(await evaluate('[scrollX,scrollY,document.querySelector(".diagnostic-shell__panel").scrollTop]'),await evaluate('review.outerScroll'),'The browser and outer panel must not scroll');
 assert.equal((await state()).browserStarts,0);
 await click('Stop recording');await until("!!document.querySelector('.diagnostic-recording-review')");
 const stoppedCount=await evaluate('review.scrollCalls.length');
 await pause(200);assert.equal(await evaluate('review.scrollCalls.length'),stoppedCount);
 await click('Record Again');await until("document.querySelector('.diagnostic-story-card').scrollTop===0 && document.querySelectorAll('[data-reading-state=read]').length===0");
 assert.equal(await evaluate('review.scrollCalls.at(-1).behavior'),'auto');
 // A new attempt must be allowed to follow the same indexes again.
 await click('Start recording');await pause(1600);
 await readTo(boundary);await settleScroll();
 assert.ok(await evaluate("document.querySelector('.diagnostic-story-card').scrollTop>0"));
 await click('Stop recording');await until("!!document.querySelector('.diagnostic-recording-review')");
 reports.push(`story auto-scroll at ${width}x${height}, ${reducedMotion?'reduced':'normal'} motion: visibility, containment, duplicate/line suppression, manual input, reset and restart`);
 console.log('PASS '+reports.at(-1));
}
try {
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
 await reset();await navigate('/diagnostic/xx/questions');await until("location.pathname==='/diagnostic'");
 await navigate('/diagnostic/fil/reading');await until("document.querySelector('#diagnostic-story-title')?.textContent==='Ang Matanda'");
 await navigate('/diagnostic/en/questions');await until("location.pathname==='/diagnostic/en/reading'");
 reports.push('invalid language and direct questions redirect safely; active Filipino reading is available');
 const baseline=await stats();await fetch('http://127.0.0.1:5019/mode/success');
 await doubleClick('Start recording');await until("document.querySelectorAll('[data-reading-state=read]').length===4");
 await until("[...document.querySelectorAll('[data-reading-state=read]')].every(word=>getComputedStyle(word).backgroundColor==='rgb(255, 201, 92)')");
 const interimColors=await evaluate("[...document.querySelectorAll('[data-reading-state=read]')].map(word=>getComputedStyle(word).backgroundColor)");
 assert.deepEqual([...new Set(interimColors)], ['rgb(255, 201, 92)']);
 await pause(1000); // Mock Google finalizes the same words at one second.
 const finalColors=await evaluate("[...document.querySelectorAll('[data-reading-state=read]')].map(word=>getComputedStyle(word).backgroundColor)");
 assert.deepEqual(finalColors, interimColors);
 assert.equal(await evaluate("document.querySelectorAll('.diagnostic-story-word--current,.diagnostic-story-word--completed').length"),0);
 reports.push('interim trail and final trail retain the same single warm-yellow fill');
 await pause(longRecording ? 61000 : 1000);
 const continuous=await state();assert.equal(continuous.requests,1);assert.equal(continuous.recorders.length,longRecording ? 3 : 1);assert.equal(continuous.contexts.length,1);assert.deepEqual(continuous.tracks,['live']);
 assert.equal(continuous.browserStarts,0);
 reports.push(`${longRecording ? '62-second segmented' : 'short'} recording; one microphone/context/socket; finals do not stop recording`);console.log('PASS continuous real recorder and worklet test');
 await doubleClick('Stop recording');await until("!!document.querySelector('.diagnostic-recording-review')");await doubleClick('Continue to Questions');await until("!!document.querySelector('input[type=radio]')");
 assert.equal((await stats()).uploads-baseline.uploads,0);assert.equal((await stats()).sessions-baseline.sessions,1);
 assert.ok((await state()).contexts.every(c=>c.state==='closed'));assert.deepEqual((await state()).tracks,['ended']);
 await evaluate("document.querySelector('input[type=radio]').click()");await doubleClick('Next');await until("document.querySelector('.diagnostic-question-counter')?.textContent.includes('Question 2 ')");
 await send('Page.reload');await until("document.querySelector('.diagnostic-question-counter')?.textContent.includes('Question 2 ')");
 for(let question=2;question<=5;question++){
   await evaluate("document.querySelector('input[type=radio]').click()");await doubleClick(question===5?'View Result':'Next');
   if(question<5)await until(`document.querySelector('.diagnostic-question-counter')?.textContent.includes('Question ${question+1} ')`);
 }
 await until("document.querySelector('h1')?.textContent==='English Reading Result'");
 assert.equal(await evaluate('review.saves'),1);assert.equal(await evaluate("document.querySelectorAll('.diagnostic-result-card').length"),5);
 assert.equal(await evaluate('review.scoreAudits.length'),1);
 const saved=await evaluate("JSON.parse(sessionStorage.getItem('review-results'))[0]");
 assert.equal(saved.transcript,'The colorfully wrapped box was lying on the table');
 assert.equal(saved.oral_reading_metrics.numberOfWordsRead,9);
 assert.equal(await evaluate('review.scoreAudits[0].googleFinalTranscript'),saved.transcript);
 assert.equal(await evaluate('review.scoreAudits[0].wordRecognition'),saved.orv_score);
 assert.equal(saved.reading_speed_wpm,9/saved.oral_reading_metrics.recordingDurationSeconds*60);
 await send('Page.reload');await until("document.querySelector('h1')?.textContent==='English Reading Result'");
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'result-mobile.png'),Buffer.from(screenshot.data,'base64'));
 reports.push('duplicate Start/Stop/Continue/Next/save protection; no successful-path upload; question refresh; result refresh; five metrics; mobile fits');
 await reset();await fetch('http://127.0.0.1:5019/mode/failure');await click('Start recording');await until("document.querySelector('.diagnostic-recording-status')?.textContent.includes('Keep reading')");assert.deepEqual((await state()).tracks,['live']);
 await doubleClick('Stop recording');await until("!!document.querySelector('.diagnostic-recording-review')");const uploadBefore=(await stats()).uploads;await doubleClick('Continue to Questions');await until("!!document.querySelector('input[type=radio]')");assert.equal((await stats()).uploads-uploadBefore,1);
 reports.push('Google failure keeps recording alive; duplicate Continue makes exactly one fallback upload');
 await reset();await fetch('http://127.0.0.1:5019/mode/success');await click('Start recording');await pause(1600);await click('Stop recording');await until("!!document.querySelector('.diagnostic-recording-review')");await click('Record Again');assert.equal(await evaluate("document.querySelectorAll('[data-reading-state=read]').length"),0);await doubleClick('Start recording');await pause(1600);
 await evaluate('review.maximum()');await until("!!document.querySelector('.diagnostic-recording-review')");await pause(200);
 assert.equal((await state()).requests,2);assert.ok((await state()).contexts.every(c=>c.state==='closed'));
 reports.push('Record Again resets progress/resources; maximum-duration callback ends recording and drains stream');
 await click('Record Again');await click('Start recording');await pause(1600);await evaluate('review.unmount()');await pause(300);assert.deepEqual((await state()).tracks,['ended']);assert.ok((await state()).contexts.every(c=>c.state==='closed'));
 reports.push('StrictMode and true unmount release tracks, contexts and recorders');
 for(const [width,height] of [[1366,768],[390,844]]) {
   for(const reducedMotion of [false,true]) await checkStoryScroll(width,height,reducedMotion);
 }
 assert.deepEqual(errors,[]);console.log('PASS '+reports.join('\nPASS '));
} finally {fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({reports,errors},null,2));await fetch('http://127.0.0.1:9225/json/close/'+target.id);ws.close();}
