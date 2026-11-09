// Isolated real-browser acceptance checks. Services are mocked; no staging or paid API calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import Teacher from '/src/modules/module4/pages/ClassroomDetailsPage.tsx';
import Admin from '/src/modules/module4/pages/AdminClassroomDetailsPage.tsx';
import '/src/index.css';
createRoot(document.getElementById('root')).render(<BrowserRouter><Routes>
<Route path='/teacher/:roomId' element={<Teacher/>}/><Route path='/admin/:roomId' element={<Admin/>}/>
</Routes></BrowserRouter>);`;
const service = `
export {parseOptionalDueDate,formatDueDateTime,currentDueDateMinimum,dueDateIssue,getReadingActivityError,supportsRoomArchive,isRoomArchived}
  from '/src/modules/module4/services/classroomService.ts?actual';
window.calls=[];
let roster=Array.from({length:30},(_,i)=>({enrollment_id:'enrollment-'+i,student_id:'student-'+i,
  display_name:'Test Student '+i,full_name:'Test Student '+i,enrolled_at:'2026-11-01T08:00:00Z'}));
let assigned=[];
// Only the 'archive-room' fixture has rooms.archived_at (the archive migration).
let archivedAt=null;
export const getClassroomById=async id=>({id,teacher_id:'teacher',room_name:'Room '+id,section:'Grade 5',
  description:'Test room',room_code:'TESTCODE',subject:id.startsWith('english')||id==='archive-room'?'en':id==='filipino'?'fil':null,
  ...(id==='archive-room'?{archived_at:archivedAt,archived_by:archivedAt?'teacher':null}:{})});
export const setClassroomArchived=async(id,archive)=>{window.calls.push(['archive',id,archive]);archivedAt=archive?'2026-11-04T00:00:00Z':null;return true;};
// Admin removal exists only for the 'english-admin' fixture (the m4_admin_classroom_actions gate).
export const getAdminClassroomActions=async()=>location.pathname.endsWith('/english-admin')?['remove_enrollment']:[];
export const adminRemoveEnrolledStudent=async id=>{window.calls.push(['adminRemove',id]);roster=roster.filter(s=>s.enrollment_id!==id);return true;};
export const getRoomEnrollments=async()=>roster;
export const getPublishedModules=async()=>[{id:'en-module',title:'English published',language:'en',status:'published'},
  {id:'fil-module',title:'Filipino published',language:'fil',status:'published'}];
export const getAssignedModules=async()=>assigned;
export const getUploadedReadingMaterials=async()=>[];
export const getClassroomReadingActivities=async()=>[];
export const supportsOptionalColumn=async(_table,column)=>column==='due_at';
export const removeEnrolledStudent=async id=>{window.calls.push(['remove',id]);roster=roster.filter(s=>s.enrollment_id!==id);};
export const updateClassroom=async(id,input)=>{window.calls.push(['edit',input]);return {...await getClassroomById(id),
  room_name:input.roomName,section:input.section,description:input.description};};
export const assignModuleToRoom=async(room,id,actor,due)=>{window.calls.push(['assign',room,id,actor,due]);
  assigned=[{assignment_id:'assignment',module_id:id,title:id==='en-module'?'English published':'Filipino published',
  assigned_at:'2026-11-01T08:00:00Z',due_at:due,removed_at:null}];};
export const assignReadingActivity=async()=>{throw Error('Not part of this browser fixture');};
export const setReadingActivityRemoved=async()=>{throw Error('Not part of this browser fixture');};
export const setRoomModuleRemoved=async()=>{throw Error('Not part of this browser fixture');};
// Legacy subject conversion: 'legacy' behaves like staging today (no database support).
export const getLegacyRoomSubjectOptions=async id=>id==='legacy-fil'?{subject:null,contentLanguages:['fil'],choices:['fil'],canSet:true}
  :id==='legacy-mixed'?{subject:null,contentLanguages:['en','fil'],choices:[],canSet:false}:null;
export const setLegacyRoomSubject=async(id,subject)=>{window.calls.push(['setSubject',id,subject]);return subject;};
// Module targeting: enabled only for the 'english-targeting' room (the database gate in this fixture).
export const getModuleTargetingEnabled=async()=>location.pathname.endsWith('/english-targeting');
export const assignModuleToSelectedStudents=async(room,id,students,due)=>{window.calls.push(['assignSelected',room,id,students,due]);
  assigned=[{assignment_id:'targeted',module_id:id,title:'English published',assigned_at:'2026-11-01T08:00:00Z',due_at:due,removed_at:null,
  targeting:'selected_students',recipient_ids:students}];return 'targeted';};`;
const server = await createServer({root,configFile:false,envDir:fileURLToPath(new URL('.',import.meta.url)),
  server:{host:'127.0.0.1',port:5182,strictPort:true},plugins:[{
    name:'m4-offline-fixture',enforce:'pre',
    resolveId(id) {
      if(id==='/m4-fixture.tsx') return '\0fixture';
      if(id.endsWith('/services/classroomService')) return '\0classroom';
      if(id.endsWith('/services/materialService')) return '\0material';
      if(id.endsWith('/lib/supabaseClient')) return '\0supabase';
    },
    async load(id) {
      if(id==='\0fixture') return (await transformWithEsbuild(fixture,'fixture.tsx',{loader:'tsx',jsx:'automatic'})).code;
      if(id==='\0classroom') return service;
      if(id==='\0material') return 'export const getMaterialQuestionSets=async()=>[];export const getMaterialServiceError=(e,f)=>f;';
      if(id==='\0supabase') return "export const supabase={auth:{getUser:async()=>({data:{user:{id:'teacher'}}})}};";
    },
    configureServer(s) { s.middlewares.use(async(req,res,next)=>{
      if(!/^\/(teacher|admin)\//.test(req.url)) return next();
      res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/fixture.html',
        '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/m4-fixture.tsx"></script></body></html>'));
    });},
  },react()]});
const profile=await mkdtemp(join(tmpdir(),'basa-m4-prototype3-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--disable-background-networking',
  '--remote-debugging-port=9228',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  await server.listen();
  let target;
  for(let i=0;i<100;i++) {try {target=await(await fetch('http://127.0.0.1:9228/json/new?about:blank',{method:'PUT'})).json();break;} catch {await new Promise(r=>setTimeout(r,100));}}
  assert.ok(target,'Headless Chrome started');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let next=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout: '+expression+' ERRORS: '+errors.join(' | ')+'\n'+await evaluate('document.body.innerText'));};
  const click=async(label,selector='button')=>{await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);};
  const input=async(selector,value)=>{await evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);};
  const select=async(selector,value)=>{await evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);};
  const navigate=async route=>{await send('Page.navigate',{url:'http://127.0.0.1:5182'+route});await until('document.querySelector("#enrolledStudentsButton")');};
  const triggerSelector = 'button[aria-label="Learning Room actions"]';
  const openActions=async()=>{
    await evaluate(`document.querySelector('${triggerSelector}').click()`);
    await until('document.querySelector("[role=menu]")');
  };
  const key=async(key,code=key,modifiers=0)=>{
    const windowsVirtualKeyCode={Enter:13,' ':32,Tab:9,Escape:27,ArrowDown:40,ArrowUp:38,Home:36,End:35}[key];
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r'}:key===' '?{text:' '}:{})});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode});
  };
  const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const mouse=async(selector,type='mouseMoved')=>send('Input.dispatchMouseEvent',{type,...await point(selector),...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
  await send('Runtime.enable');
  await send('Network.enable');
  // Block external page resources even if an accidental real client import is introduced.
  await send('Network.setBlockedURLs',{urls:['https://*','http://localhost:*']});

  // Real pointer, focus, touch, layout and existing-action checks for the header menu.
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await navigate('/teacher/archive-room');
  assert.ok(await evaluate('!document.querySelector("#roomArchiveHeading")'),'old archive panel removed');
  assert.ok(await evaluate(`(()=>{const t=document.querySelector('${triggerSelector}').getBoundingClientRect();const h=document.querySelector('h1').getBoundingClientRect();return t.x>h.right && t.y<=h.bottom})()`),'actions stay at top right');
  assert.ok(await evaluate(`(()=>{const overview=document.querySelector('#enrolledStudentsButton').parentElement;const modules=overview.nextElementSibling;return modules.textContent.includes('Assigned Reading Modules') && modules.getBoundingClientRect().top-overview.getBoundingClientRect().bottom===24})()`),'modules follow overview with normal spacing');
  await mouse(triggerSelector);
  await until('document.querySelector("[role=menu]")');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("[role=menuitem]")].map(e=>e.textContent.trim())'),['Edit Learning Room','Archive Learning Room']);
  assert.ok(await evaluate(`(()=>{const t=document.querySelector('${triggerSelector}').getBoundingClientRect();const m=document.querySelector('[role=menu]').getBoundingClientRect();return Math.abs(m.right-t.right)<1 && m.top>=t.bottom})()`),'menu below and aligned right');
  // Cross the transparent gap into the portaled menu, then remain there.
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...await evaluate(`(()=>{const r=document.querySelector('${triggerSelector}').getBoundingClientRect();return {x:r.x+20,y:r.bottom+4}})()`)});
  await mouse('[role=menuitem]');
  await new Promise(r=>setTimeout(r,300));
  assert.ok(await evaluate('!!document.querySelector("[role=menu]")'),'hover crossing remains open');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
  await until('!document.querySelector("[role=menu]")');
  // Hover followed by a real click pins the menu; a second click closes it.
  await mouse(triggerSelector);await mouse(triggerSelector,'mousePressed');await mouse(triggerSelector,'mouseReleased');
  assert.ok(await evaluate('!!document.querySelector("[role=menu]")'));
  await mouse(triggerSelector,'mousePressed');await mouse(triggerSelector,'mouseReleased');
  await until('!document.querySelector("[role=menu]")');
  await openActions();await key('Escape');
  await until('!document.querySelector("[role=menu]")');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Learning Room actions');
  await openActions();
  await mouse('h1','mousePressed');await mouse('h1','mouseReleased');
  await until('!document.querySelector("[role=menu]")');
  await evaluate(`document.querySelector('${triggerSelector}').focus()`);
  await key('ArrowDown');
  assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Edit Learning Room');
  await key('End');
  assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Archive Learning Room');
  await key('ArrowDown');
  assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Edit Learning Room');
  await key('ArrowUp');await key('Home');
  assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Edit Learning Room');
  await key('Tab');await until('!document.querySelector("[role=menu]")');
  assert.equal(await evaluate('document.activeElement.id'),'enrolledStudentsButton');
  await evaluate(`document.querySelector('${triggerSelector}').focus()`);
  await key(' ', 'Space');await key('Tab','Tab',8);
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Learning Room actions');
  await key('ArrowUp');
  assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Archive Learning Room');
  await key('Escape');await key('Enter');
  await until('document.activeElement.getAttribute("role")==="menuitem"');
  await key('Enter');
  await until('document.querySelector("#roomName")');
  assert.equal(await evaluate('document.querySelector("#roomName").value'),'Room archive-room');
  assert.ok(await evaluate('!document.querySelector("[role=menu]")'));
  await click('Cancel');
  // A clipping ancestor cannot clip a menu portaled into document.body.
  await evaluate(`document.querySelector('${triggerSelector}').parentElement.style.overflow='hidden'`);
  await openActions();
  assert.ok(await evaluate(`(()=>{const m=document.querySelector('[role=menu]');const r=m.getBoundingClientRect();return m.parentElement.parentElement===document.body && m.contains(document.elementFromPoint(r.x+20,r.bottom-20))})()`));
  await key('Escape');
  const menuShots=await mkdtemp(join(tmpdir(),'basa-m4-room-actions-'));
  for(const width of [1280,768,375,320]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<1000});
    await send('Emulation.setTouchEmulationEnabled',{enabled:width<1000});
    await navigate('/teacher/archive-room');
    if(width<1000){
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...await point(triggerSelector),radiusX:2,radiusY:2}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await until('document.querySelector("[role=menu]")');
    }else await openActions();
    assert.ok(await evaluate(`(()=>{const t=document.querySelector('${triggerSelector}').getBoundingClientRect();const r=document.querySelector('[role=menu]').getBoundingClientRect();return t.width>=44 && t.height>=44 && r.left>=0 && r.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth})()`),'menu and touch target fit at '+width);
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(join(menuShots,`actions-${width}.png`),Buffer.from(shot.data,'base64'));
    if(width<1000){
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...await point('[role=menuitem]'),radiusX:2,radiusY:2}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await until('document.querySelector("#roomName")');await click('Cancel');
    }else await key('Escape');
  }
  await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('PASS room actions: hover/click, gap crossing, outside/Escape, keyboard/focus, edit form, clipping, panel removal/spacing, 1280/768/375/320px and touch. Screenshots: '+menuShots);
  for(const [room,label] of [['english','English'],['filipino','Filipino']]) {
    await navigate('/teacher/'+room); await click('Assign Module');
    await until('document.querySelector("#moduleLanguage")');
    assert.equal(await evaluate('document.querySelector("#moduleLanguage").textContent'),label);
    assert.equal(await evaluate('document.querySelector("#moduleLanguage").tagName'),'P');
    await click('Assign Activity');
    await until('document.querySelector("#activityLanguage")');
    assert.equal(await evaluate('document.querySelector("#activityLanguage").textContent'),label);
    assert.deepEqual(await evaluate('[...document.querySelector("#readingModule").options].slice(1).map(o=>o.value)'),[room==='english'?'en-module':'fil-module']);
  }
  await navigate('/teacher/legacy');await click('Assign Module');
  await until('document.querySelector("select#moduleLanguage")');
  assert.ok(await evaluate('document.body.innerText.includes("older learning room has no saved subject")'));
  await select('#moduleLanguage','fil');
  await until('document.querySelector("#readingModule").options.length===2');
  assert.equal(await evaluate('document.querySelector("#readingModule").options[1].value'),'fil-module');
  assert.ok(await evaluate('!document.body.innerText.includes("Save Classroom Subject")'),'no conversion offered without database support');

  // Archive / Restore (only where rooms.archived_at exists).
  await navigate('/teacher/english');
  await openActions();
  assert.ok(await evaluate('!document.body.innerText.includes("Archive Learning Room")'),'no archive control without the migration');
  await navigate('/teacher/archive-room');
  await openActions();await click('Archive Learning Room');await until('document.querySelector("dialog[open]")');
  assert.ok(await evaluate('document.querySelector("dialog[open]").textContent.includes("Nothing is deleted")'));
  await click('Cancel','dialog button');await until('!document.querySelector("dialog")');
  assert.deepEqual(await evaluate('window.calls.filter(c=>c[0]==="archive")'),[],'Cancel keeps the room active');
  await openActions();await click('Archive Learning Room');await until('document.querySelector("dialog[open]")');await click('Confirm','dialog button');
  await until('document.body.innerText.includes("This learning room is archived")');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Assign Module").disabled'),true);
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Assign Activity").disabled'),true);
  for(const width of [1280,375]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<520});
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'archived banner fits at '+width);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await openActions();await click('Restore Learning Room');await until('document.querySelector("dialog[open]")');await click('Confirm','dialog button');
  await until('!document.querySelector("dialog") && !document.body.innerText.includes("This learning room is archived")');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Assign Module").disabled'),false);
  assert.deepEqual(await evaluate('window.calls.filter(c=>c[0]==="archive").map(c=>c[2])'),[true,false]);

  // Module targeting (only where the database gate is on).
  await navigate('/teacher/english');await click('Assign Module');
  assert.ok(await evaluate('!document.body.innerText.includes("Assign to")'),'no targeting choice without the gate');
  await navigate('/teacher/english-targeting');await click('Assign Module');
  await until('document.querySelector("input[name=moduleTargeting]")');
  await select('#readingModule','en-module');
  await evaluate('document.querySelector("input[value=selected_students]").click()');
  await until('document.querySelectorAll("#moduleStudents input[type=checkbox]").length===30');
  await click('Assign Module','form button[type=submit]');
  await until('document.body.innerText.includes("Select at least one student, or choose Whole Class.")');
  assert.deepEqual(await evaluate('window.calls.filter(c=>c[0]==="assignSelected")'),[],'empty selection is rejected before saving');
  await evaluate('document.querySelectorAll("#moduleStudents input[type=checkbox]")[0].click()');
  await evaluate('document.querySelectorAll("#moduleStudents input[type=checkbox]")[2].click()');
  await until('document.body.innerText.includes("2 students selected.")');
  for(const width of [1280,375]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<520});
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'targeting form fits at '+width);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await click('Assign Module','form button[type=submit]');
  await until('document.body.innerText.includes("Selected students · 2")');
  assert.deepEqual(await evaluate('window.calls.filter(c=>c[0]==="assignSelected").map(c=>c.slice(1,4))'),[['english-targeting','en-module',['student-0','student-2']]]);

  // Legacy subject conversion, once the database supports it.
  const shots=await mkdtemp(join(tmpdir(),'m4-legacy-subject-'));
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(shots,name+'.png'),Buffer.from(r.data,'base64'));};
  for(const width of [1280,375]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<520});
    await navigate('/teacher/legacy-mixed');
    await until('document.body.innerText.includes("has both English and Filipino readings, so a single subject cannot be saved")');
    assert.ok(await evaluate('!document.body.innerText.includes("Save Classroom Subject")'));
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no overflow at '+width);
    await shot('mixed-'+width);
    await navigate('/teacher/legacy-fil');
    await until('document.body.innerText.includes("Save Classroom Subject")');
    assert.equal(await evaluate('document.querySelector("#legacyRoomSubject").value'),'fil');
    assert.deepEqual(await evaluate('[...document.querySelector("#legacyRoomSubject").options].map(o=>o.value)'),['fil'],'only the allowed subject is offered');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no overflow at '+width);
    await shot('filipino-only-'+width);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await click('Save Classroom Subject');await until('document.querySelector("dialog[open]")');
  assert.ok(await evaluate('document.querySelector("dialog[open]").textContent.includes("cannot be changed later")'));
  await click('Cancel','dialog button');await until('!document.querySelector("dialog")');
  assert.deepEqual(await evaluate('window.calls.filter(c=>c[0]==="setSubject")'),[],'Cancel saves nothing');
  await click('Save Classroom Subject');await until('document.querySelector("dialog[open]")');
  await click('Confirm','dialog button');
  await until('!document.body.innerText.includes("Save Classroom Subject")');
  assert.deepEqual(await evaluate('window.calls.filter(c=>c[0]==="setSubject")'),[['setSubject','legacy-fil','fil']]);
  await click('Assign Module');await until('document.querySelector("p#moduleLanguage")');
  assert.equal(await evaluate('document.querySelector("#moduleLanguage").textContent'),'Filipino');
  await click('Assign Activity');await until('document.querySelector("p#activityLanguage")');
  assert.equal(await evaluate('document.querySelector("#activityLanguage").textContent'),'Filipino');
  console.log('Legacy subject screenshots: '+shots);

  await navigate('/teacher/english');await click('Assign Module');
  await select('#readingModule','en-module');await input('#moduleDueAtDate','2020-01-01');
  await until('document.querySelector("#moduleDueAtIssue").textContent.includes("Choose a due time")');
  await input('#moduleDueAtTime','09:00');
  await until('document.querySelector("#moduleDueAtDate").getAttribute("aria-invalid")==="true"');
  assert.ok(await evaluate('document.querySelector("#moduleDueAtIssue").textContent.includes("already passed")'));
  assert.deepEqual(await evaluate('window.calls'),[]);
  await input('#moduleDueAtDate','2099-11-09');await input('#moduleDueAtTime','15:30');
  await until('document.querySelector("#moduleDueAtDate").getAttribute("aria-invalid")==="false"');
  await click('Assign Module','form button');
  await until('window.calls.some(c=>c[0]==="assign")');
  assert.deepEqual(await evaluate('window.calls.find(c=>c[0]==="assign")'),['assign','english','en-module','teacher','2099-11-09T07:30:00.000Z']);

  for(const width of [1280,375]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<600});
    await evaluate('document.querySelector("#enrolledStudentsButton").click()');
    await until('document.querySelector("#enrolledStudentsPanel")');
    assert.equal(await evaluate('document.querySelectorAll("#enrolledStudentsPanel li").length'),30);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=${width}`),'no horizontal overflow');
    assert.ok(await evaluate('document.querySelector("#enrolledStudentsPanel").getBoundingClientRect().height<=812'),'panel fits screen');
    assert.ok(await evaluate('(()=>{const e=document.querySelector("#enrolledStudentsPanel .overflow-y-auto");return e.scrollHeight>e.clientHeight})()'),'long roster scrolls');
    await click('Close');await until('!document.querySelector("#enrolledStudentsPanel")');
  }
  await evaluate('document.querySelector("#enrolledStudentsButton").click()');
  await until('document.querySelector("#enrolledStudentsPanel")');
  await click('Remove');await until('document.querySelector("dialog[open]")');
  await click('Cancel','dialog button');await until('!document.querySelector("dialog")');
  assert.equal(await evaluate('window.calls.filter(c=>c[0]==="remove").length'),0);
  assert.equal(await evaluate('document.querySelectorAll("#enrolledStudentsPanel li").length'),30);
  await click('Remove');await until('document.querySelector("dialog[open]")');
  await click('Confirm','dialog button');await until('document.querySelectorAll("#enrolledStudentsPanel li").length===29');
  assert.deepEqual(await evaluate('window.calls.filter(c=>c[0]==="remove")'),[['remove','enrollment-0']]);
  await click('Close');
  await navigate('/admin/english');await evaluate('document.querySelector("#enrolledStudentsButton").click()');
  await until('document.querySelector("#enrolledStudentsPanel")');
  assert.equal(await evaluate('[...document.querySelectorAll("#enrolledStudentsPanel button")].filter(b=>b.textContent==="Remove").length'),0);
  assert.equal(await evaluate('document.querySelectorAll("#enrolledStudentsPanel li").length'),30);

  // Even an installed Admin removal capability must not expose the action.
  await navigate('/admin/english-admin');await evaluate('document.querySelector("#enrolledStudentsButton").click()');
  await until('document.querySelector("#enrolledStudentsPanel")');
  assert.equal(await evaluate('[...document.querySelectorAll("#enrolledStudentsPanel button")].filter(b=>b.textContent==="Remove").length'),0);
  assert.equal(await evaluate('window.calls.some(c=>c[0]==="adminRemove")'),false);
  assert.deepEqual(errors,[]);
  console.log('PASS browser: English/Filipino subjects, legacy fallback, legacy subject conversion (gate, mixed refusal, Filipino-only Cancel/Confirm, both forms locked), module targeting (gate, empty refusal, selected students, 1280/375px), archive/restore (gate, Cancel, banner, disabled assignment, 1280/375px), Admin removal withheld even with installed capability, matching module options, Philippine due date, 1280/375px roster, removal Cancel/Confirm, Admin view-only roster.');
} finally {ws?.close();chrome.kill();await server.close();}
