import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const output = process.env.READFLOW_M2_BROWSER_OUTPUT || path.join(os.tmpdir(),'readflow-m3-learner-ui');
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch('http://127.0.0.1:9226/json/new?about:blank',{method:'PUT'})).json();
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


const section = label => 'document.querySelector('+JSON.stringify('section[aria-label="'+label+'"]')+')';
async function go(route){await send('Page.navigate',{url:'http://127.0.0.1:5179'+route});await until('!!document.querySelector(".m3-language-selector")',30000);}
async function choose(language){await evaluate('[...document.querySelectorAll(".m3-language-selector button")].find(b=>b.textContent.includes('+JSON.stringify(language)+')).click()');}
const cards = label => section(label)+'.querySelectorAll(".basa-module-card").length';
const reports=[];
try {
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 for(const [width,height] of [[1440,900],[1366,768],[768,1024],[390,844]]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<520});
  await go('/materials');
  await until(cards('Recommended for You')+'===1');
  assert.equal(await evaluate(section('English reading placement')+'.textContent.includes("Instructional")'),true);
  assert.equal(await evaluate(section('Recommended for You')+'.textContent.includes("en Medium story")'),true);
  assert.equal(await evaluate(cards('All Reading Materials')),3);
  for(const language of ['Filipino','English']) {
   await choose(language);const prefix=language==='English'?'en':'fil';
   await until(section(language+' reading placement')+'!==null');
   assert.equal(await evaluate(section('Recommended for You')+'.textContent.includes('+JSON.stringify(prefix+' '+(prefix==='en'?'Medium':'Hard')+' story')+')'),true);
   assert.equal(await evaluate(section(language+' reading placement')+'.textContent.includes('+JSON.stringify(prefix==='en'?'Instructional':'Independent')+')'),true);
   assert.equal(await evaluate(section('All Reading Materials')+'.textContent.includes('+JSON.stringify((prefix==='en'?'fil':'en')+' ') +')'),false);
   for(const difficulty of ['Easy','Medium','Hard','All']) {
    await evaluate('[...document.querySelectorAll(".m3-catalog-filters button")].find(b=>b.textContent==='+JSON.stringify(difficulty)+').click()');
    assert.equal(await evaluate(cards('All Reading Materials')),difficulty==='All'?3:1);
    if(difficulty!=='All') assert.equal(await evaluate(section('All Reading Materials')+'.textContent.includes('+JSON.stringify(prefix+' '+difficulty+' story')+')'),true);
   }
  }
  assert.ok(await evaluate('document.documentElement.scrollWidth') <= width, 'No horizontal overflow at '+width);
  assert.equal(await evaluate('document.querySelectorAll(".m3-language-selector button[aria-pressed=true]").length'),1);
  await evaluate('document.querySelectorAll(".m3-language-selector button")[1].focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(section('Filipino reading placement')+'!==null');
  assert.equal(await evaluate('document.body.textContent.includes("Draft hidden")||document.body.textContent.includes("Archive hidden")'),false);
  if(width===390) {const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(output,'materials-mobile.png'),Buffer.from(shot.data,'base64'));}
  reports.push('language, placement, recommendations, catalog, filters, keyboard and layout '+width+'x'+height);
 }
 for(const language of ['en','fil']) for(const status of ['missing','loading','error']) {
  await go('/materials?'+language+'='+status);await choose(language==='en'?'English':'Filipino');
  const placement=section((language==='en'?'English':'Filipino')+' reading placement');
  await until(placement+'.textContent.includes('+JSON.stringify(status==='missing'?'Not completed':status==='loading'?'Loading':'try again')+')');
  assert.equal(await evaluate(cards('Recommended for You')),0);assert.equal(await evaluate(cards('All Reading Materials')),3);
  assert.equal(await evaluate('document.body.textContent.includes("private database detail")'),false);
  if(status==='missing') assert.equal(await evaluate(placement+'.querySelector("a").getAttribute("href")'),'/diagnostic/'+language+'/reading');
  if(status==='loading')assert.equal(await evaluate(section('Recommended for You')+'.textContent.includes("No recommended")'),false);
 }
 await go('/materials?noMatch=1');await until(section('Recommended for You')+'.textContent.includes("No recommended stories are available for this level yet.")');assert.equal(await evaluate(cards('All Reading Materials')),2);
 await go('/dashboard');await until(section('English reading placement')+'.textContent.includes("Instructional")');assert.equal(await evaluate(section('Filipino reading placement')+'.textContent.includes("Independent")'),true);
 await go('/dashboard?fil=missing');await until(section('Filipino reading placement')+'.textContent.includes("Not completed")');
 assert.deepEqual(errors,[]);reports.push('both language missing/loading/error, no match and separate dashboard placements');
 console.log(reports.join('\nPASS '));
} finally {fs.writeFileSync(path.join(output,'learner-report.json'),JSON.stringify({reports,errors},null,2));await send('Page.close').catch(()=>{});ws.close();}
