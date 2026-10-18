import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const root=path.resolve('readflow');
process.chdir(root);
const output=path.join(os.tmpdir(),'readflow-m6-compact');
fs.mkdirSync(output,{recursive:true});
const harness=path.join(root,'tests/browser/module6/compactHarness.tsx').replaceAll('\\','/');
const vite=await createServer({root,configFile:false,envFile:false,optimizeDeps:{entries:['tests/browser/module6/compactHarness.tsx']},plugins:[{
 name:'m6-layout-fixture',enforce:'pre',resolveId(id){
   if(['/services/comprehensionService','/hooks/useAuthenticatedProfile','/services/authService'].some(s=>id.endsWith(s)))return harness;
   if(id.endsWith('/components/OralReadingSummary'))return '\0oral-summary';
 },load(id){if(id==='\0oral-summary')return 'export default function Summary(){return null}';},
 configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.startsWith('/dashboard/')){
 res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/tests/browser/module6/compactHarness.tsx"></script></body></html>'));}else next();});}
},react()],server:{host:'127.0.0.1',port:5187,strictPort:true}});
await vite.listen();
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=9241','--user-data-dir='+path.join(output,'chrome-profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let target;
for(let i=0;i<100;i++){try{target=await(await fetch('http://127.0.0.1:9241/json/new?about:blank',{method:'PUT'})).json();break;}catch{await pause(100);}}
assert.ok(target,'Headless Chrome must start');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let next=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function until(expression){for(let i=0;i<200;i++){if(await evaluate(expression))return;await pause(50);}throw Error('Timeout '+expression+' '+errors.join(' | '));}
const click=async text=>{await evaluate(`(()=>{const el=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Missing control');el.click()})()`);};
const navigate=async url=>{await send('Page.navigate',{url:'http://127.0.0.1:5187'+url});};

const check=async (width,height,question,desktop=true)=>{
 const metrics=await evaluate(`(()=>{const content=document.querySelector('.basa-content');const card=document.querySelector('.m6-question-card');
 const options=[...document.querySelectorAll('.m6-option')];const nav=card.querySelector('.m6-actions');
 return {scroll:content.scrollHeight-content.clientHeight, overflow:document.documentElement.scrollWidth-innerWidth,
 options:options.length,bottom:nav.getBoundingClientRect().bottom,limit:content.getBoundingClientRect().bottom,
 clipped:[card,...options,nav].some(e=>['hidden','clip'].includes(getComputedStyle(e).overflowY)),
 font:parseFloat(getComputedStyle(options[0]).fontSize)};})()`);
 assert.equal(metrics.options,4);assert.equal(metrics.overflow,0);assert.equal(metrics.clipped,false);assert.ok(metrics.font>=16);
 if(desktop){assert.ok(metrics.scroll<=1,JSON.stringify({width,height,question,...metrics}));assert.ok(metrics.bottom<=metrics.limit);}
 else {
  await evaluate(`document.querySelector('.m6-actions').scrollIntoView({block:'end'})`);
  assert.equal(await evaluate(`document.querySelector('.m6-actions').getBoundingClientRect().bottom<=innerHeight`),true);
 }
};
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const [width,height] of [[1366,768],[1280,720],[1600,900],[390,844],[320,568],[640,360]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await navigate('/dashboard/comprehension/fixture');
  await until(`document.querySelectorAll('.m6-option').length===4`);
  await evaluate('document.fonts.ready.then(()=>true)');
  assert.equal(await evaluate(`document.querySelectorAll('.m6-resource').length`),0);
  assert.equal(await evaluate(`/Review saved oral reading|Open oral reading result|Review passage|Maya's Garden/.test(document.body.textContent)`),false);
  assert.equal(await evaluate(`document.querySelector('.m6-page > h1').nextElementSibling.matches('.m6-question-card')`),true);
  for(let i=0;i<6;i++){
   await check(width,height,i+1,width>=1000);
   await evaluate(`document.querySelector('input[type=radio]').focus()`);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
   await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
   await until(`document.querySelector('input[type=radio]').checked`);
   await click(i===5?'Submit':'Check answer');
   if(i<5){await until(`!!document.querySelector('.m6-answer-details')`);await check(width,height,i+1,width>=1000);
    if(i===1){await click('Previous Question');await until(`document.querySelector('.m6-question-progress').textContent.includes('Question 1 of')`);
     assert.equal(await evaluate(`document.querySelector('input[type=radio]').checked`),true);await click('Next Question');}
    await click('Next Question');await until(`document.querySelector('.m6-question-progress').textContent.includes('Question ${i+2} of')`);
   } else await until(`document.body.textContent.includes('Completed result')`);
  }
  console.log(`PASS: ${width}x${height}, all six questions, keyboard selection, Previous/Next/Submit`);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 await navigate('/dashboard/comprehension/fixture?long=1');await until(`document.querySelectorAll('.m6-option').length===4`);
 assert.equal(await evaluate(`document.querySelector('.basa-content').scrollHeight>document.querySelector('.basa-content').clientHeight`),true);
 await evaluate(`document.querySelector('.m6-actions').scrollIntoView({block:'end'})`);
 assert.equal(await evaluate(`document.querySelector('.m6-actions').getBoundingClientRect().bottom<=innerHeight`),true);
 console.log('PASS: long-content scrolling fallback keeps navigation reachable');
 await navigate('/dashboard/comprehension/fixture');await until(`document.querySelectorAll('.m6-option').length===4`);
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'1280x720.png'),Buffer.from(shot.data,'base64'));
 assert.deepEqual(errors,[]);
 console.log('SCREENSHOT: '+path.join(output,'1280x720.png'));
}finally{await send('Browser.close').catch(()=>{});ws.close();chrome.kill();await vite.close();}
