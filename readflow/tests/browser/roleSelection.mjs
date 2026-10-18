// Isolated real-browser UI checks. Auth/RPC boundaries are mocked; no accounts or codes are created.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'readflow-role-layout-'));
const server = await createServer({ root, configFile: false,
  server: { host: '127.0.0.1', port: 5187, strictPort: true }, plugins: [{
    name: 'role-selection-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === '/role-fixture.tsx') return '\0role-fixture.tsx';
      if (id.endsWith('/auth/useAuth')) return '\0auth-mock';
      if (id.endsWith('/services/authProfile')) return '\0profile-mock';
    },
    load(id) {
      if (id === '\0auth-mock') return `const profile={role:null}; export const useAuth=()=>({profile,loading:false,refreshProfile:async()=>({role:window.assignedRole})});`;
      if (id === '\0profile-mock') return `export const getPostAuthenticationPath=async p=>p.role?'/setup-profile':'/select-role';export const assignOwnRoleOnce=async(role,code)=>{window.submissions.push({role,code});window.assignedRole=role;};`;
      if (id === '\0role-fixture.tsx') return `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Page from '/src/modules/module1/pages/RoleSelectionPage.tsx';import '/src/index.css';window.submissions=[];createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Page)));`;
    },
    configureServer(vite) { vite.middlewares.use(async(req,res,next)=>{
      if (!req.url.startsWith('/role-check')) return next();
      res.setHeader('Content-Type','text/html');
      res.end(await vite.transformIndexHtml('/role-check', '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/role-fixture.tsx"></script></body></html>'));
    }); },
  },react()] });
let chrome, ws;
try {
  await server.listen();
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9237',`--user-data-dir=${join(artifacts,'profile')}`,'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let target;
  for (let i=0;i<100;i++) {
    try { target=await(await fetch('http://127.0.0.1:9237/json/new?about:blank',{method:'PUT'})).json();break; }
    catch { await new Promise(r=>setTimeout(r,100)); }
  }
  assert.ok(target,'Chrome debugging endpoint did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let id=0;const pending=new Map();
  ws.addEventListener('message', event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error(`Timed out: ${expression}`);};
  const select=async role=>{await evaluate(`document.getElementById('role-${role}').click()`);await until(`document.getElementById('role-${role}').checked`);};
  await send('Page.enable');
  for(const [width,height] of [[1366,768],[1280,720],[1280,620],[390,844],[640,360]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'http://127.0.0.1:5187/role-check'});
    await until('!!document.querySelector(".role-option")');
    await evaluate('document.fonts.ready');
    for(const role of ['student','teacher','general_user']) {
      await select(role);
      const bounds=await evaluate(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {scroll:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,back:rect('.role-selection-back'),cards:[...document.querySelectorAll('.role-option')].map(n=>({top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom})),invite:!!document.getElementById('teacherInviteCode'),gap:document.querySelector('.role-selection-invite')?rect('.role-selection-invite').top-rect('.role-selection-options').bottom:null};})()`);
      assert.equal(bounds.invite,role==='teacher');assert.ok(bounds.width<=width,JSON.stringify(bounds));
      if(width>=1000){assert.ok(bounds.scroll<=height,JSON.stringify(bounds));assert.ok(bounds.back.bottom<=height);assert.ok(bounds.cards.every(r=>r.top>=0&&r.bottom<=height));}
      if(role==='teacher') {
        assert.equal(bounds.gap,20);
        assert.equal(await evaluate('document.getElementById("teacherInviteCode").checkValidity()'),false);
        await evaluate('document.querySelector("form").requestSubmit()');
        assert.equal(await evaluate('window.submissions.length'),0);
        assert.equal(await evaluate('document.getElementById("teacherInviteCode").getAttribute("aria-describedby")'),'teacher-invite-help');
        const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
        await writeFile(join(artifacts,`${width}x${height}.png`),Buffer.from(shot.data,'base64'));
      }
    }
    if(width<1000) {
      await select('teacher');
      assert.ok(await evaluate('document.documentElement.scrollHeight>innerHeight'));
      await evaluate('document.querySelector(".role-selection-back").scrollIntoView({block:"end"})');
      await until('document.querySelector(".role-selection-back").getBoundingClientRect().bottom<=innerHeight+1');
    }
    console.log(`PASS layout and teacher requirement ${width}x${height}`);
  }
  // Keyboard arrow navigation retains the native radio-group behavior.
  await evaluate('document.getElementById("role-student").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await until('document.getElementById("role-teacher").checked');
  for(const role of ['student','teacher','general_user']) {
    await send('Page.navigate',{url:'http://127.0.0.1:5187/role-check'});
    await until('!!document.querySelector(".role-option")');await select(role);
    if(role==='teacher') await evaluate(`(()=>{const n=document.getElementById('teacherInviteCode');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'fixture-only-not-a-real-code');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate('document.querySelector("form").requestSubmit()');
    await until('window.submissions.length===1');
    assert.equal(await evaluate('window.submissions[0].role'),role);
  }
  console.log('PASS keyboard navigation and all three role submissions; screenshots:', artifacts);
  await send('Browser.close');
} finally { ws?.close();chrome?.kill();await server.close(); }
