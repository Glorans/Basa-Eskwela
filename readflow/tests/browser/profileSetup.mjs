// Real Profile Setup page and profile service, with an in-memory Supabase boundary.
// No real accounts, invitations or database writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'readflow-profile-age-'));
const server = await createServer({ root, configFile: false,
  server: { host: '127.0.0.1', port: 5189, strictPort: true }, plugins: [{
    name: 'profile-age-fixture', enforce: 'pre',
    resolveId(id) {
      if (id === '/age-fixture.tsx') return '\0age-fixture';
      if (id.endsWith('/auth/useAuth')) return '\0auth-mock';
      if (id.endsWith('/lib/supabaseClient')) return '\0supabase-mock';
      if (id.endsWith('/services/diagnosticDatabase')) return '\0diagnostic-mock';
    },
    load(id) {
      if (id === '\0diagnostic-mock') return `export const hasCompletedInitialDiagnostic=async()=>window.completed;`;
      if (id === '\0auth-mock') return `
        import {getAuthProfile} from '/src/modules/module1/services/authProfile.ts';
        export const useAuth=()=>({profile:window.profile,loading:false,refreshProfile:async()=>{
          window.profile=await getAuthProfile('self');return window.profile;
        }});`;
      if (id === '\0supabase-mock') return `export const supabase={
        from(table){
          if(table!=='profiles')throw Error('Unexpected table');
          let patch;
          const query={
            select(){return query;}, eq(key,id){if(key!=='id'||id!=='self')throw Error('Unexpected user');return query;},
            update(value){patch=value;window.writes.push(value);return query;},
            async single(){
              if(patch && window.failSave)return {data:null,error:{message:'Save failed'}};
              if(patch)Object.assign(window.row,patch);
              const {age,...profile}=window.row;return {data:profile,error:null};
            }
          };return query;
        },
        async rpc(name,args){
          if(name!=='get_own_profile_age'||args.profile_id!=='self')throw Error('Unexpected RPC');
          return {data:window.row.age,error:null};
        }
      };`;
      if (id === '\0age-fixture') return `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {BrowserRouter,Routes,Route} from 'react-router-dom';
        import Page from '/src/modules/module1/pages/ProfileSetupPage.tsx';
        import {getAuthProfile} from '/src/modules/module1/services/authProfile.ts';
        import '/src/index.css';
        const params=new URLSearchParams(location.search),role=params.get('role')||'student';
        window.completed=params.get('completed')==='true';window.writes=[];window.failSave=false;
        window.row={id:'self',role,nickname:window.completed?'Reader':null,
          full_name:window.completed?'Existing Name':'',age:null,status:'active',created_at:'2026-10-14',
          teacher_status:role==='teacher'?(window.completed?'approved':'pending'):null};
        window.profile={...window.row};window.reloadProfile=()=>getAuthProfile('self');
        createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,
          React.createElement(Routes,null,
            React.createElement(Route,{path:'/setup-profile',element:React.createElement(Page)}),
            React.createElement(Route,{path:'*',element:React.createElement('p',{id:'destination'},location.pathname)})
          )));`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/setup-profile')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/setup-profile', '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/age-fixture.tsx"></script></body></html>'));
      });
    },
  }, react()],
});
let chrome, ws;
try {
  await server.listen();
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9239',
      `--user-data-dir=${join(artifacts, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = await (await fetch('http://127.0.0.1:9239/json/new?about:blank', { method: 'PUT' })).json(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(target, 'Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`Timed out: ${expression}`);
  };
  const open = async (role, completed = false) => {
    await send('Page.navigate', { url: `http://127.0.0.1:5189/setup-profile?role=${role}&completed=${completed}` });
    await until(completed ? '!!document.getElementById("destination")' : '!!document.querySelector("#nickname,#fullName")');
  };
  const fill = (id, value) => evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const submit = () => evaluate('document.querySelector("form").requestSubmit()');
  await send('Page.enable');
  for (const [width, height] of [[1366, 768], [390, 844], [320, 640]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const role of ['student', 'teacher', 'general_user']) {
      await open(role);
      await evaluate('document.fonts.ready');
      const nameId = role === 'teacher' ? 'fullName' : 'nickname';
      if (role === 'general_user') {
        // Independent Learners are not asked for their age: only the nickname field, then Continue.
        assert.deepEqual(await evaluate('[...document.querySelectorAll("input")].map(input=>input.id)'), [nameId]);
        assert.equal(await evaluate('document.querySelector("label[for=age]")'), null);
        assert.equal(await evaluate('document.querySelector("label[for=nickname]").textContent'), 'What should we call you?');
        assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
        if (width > 1000) assert.ok(await evaluate('document.documentElement.scrollHeight<=innerHeight'));
        assert.ok(await evaluate(`(()=>{const i=document.getElementById('nickname').getBoundingClientRect(),b=document.querySelector('.profile-setup-continue').getBoundingClientRect();
          return b.top>i.bottom && Math.abs(b.left-i.left)<1 && Math.abs(b.width-i.width)<1;})()`), 'Continue sits below the nickname, aligned to it');
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await writeFile(join(artifacts, `${role}-${width}x${height}.png`), Buffer.from(shot.data, 'base64'));
        await fill(nameId, '   '); await submit();
        await until('document.querySelector("[role=alert]")?.textContent.length > 0');
        assert.equal(await evaluate('window.writes.length'), 0, 'an empty nickname is still refused');
        await fill(nameId, '  Taylor  '); await submit();
        await until('!!document.getElementById("destination")');
        assert.equal(await evaluate('location.pathname'), '/diagnostic');
        assert.equal(await evaluate('JSON.stringify(window.writes)'), JSON.stringify([{ nickname: 'Taylor' }]), 'no age is written');
        assert.equal(await evaluate('window.reloadProfile().then(profile=>profile.age)'), null);
        assert.equal(await evaluate('window.row.role'), 'general_user');
        console.log(`PASS no Age field, alignment, validation, save without age, reload and routing: ${role} ${width}x${height}`);
        continue;
      }
      assert.deepEqual(await evaluate('[...document.querySelectorAll("input")].map(input=>input.id)'), [nameId, 'age']);
      assert.equal(await evaluate('document.querySelector("label[for=age]").textContent'), 'Age');
      assert.equal(await evaluate('document.getElementById("age").type'), 'number');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
      if (width > 1000) assert.ok(await evaluate('document.documentElement.scrollHeight<=innerHeight'));
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(join(artifacts, `${role}-${width}x${height}.png`), Buffer.from(shot.data, 'base64'));
      await fill(nameId, '  Taylor  ');
      for (const invalid of ['', '0', '-1', '121', '12.5', '1e2', 'abc']) {
        await fill('age', invalid); await submit();
        await until('!!document.getElementById("profile-age-error")');
        assert.equal(await evaluate('window.writes.length'), 0);
        assert.equal(await evaluate('document.getElementById("age").getAttribute("aria-invalid")'), 'true');
      }
      await fill('age', '18'); await submit();
      await until('!!document.getElementById("destination")');
      assert.equal(await evaluate('location.pathname'), role === 'teacher' ? '/teacher-verification' : '/diagnostic');
      assert.equal(await evaluate('window.reloadProfile().then(profile=>profile.age)'), 18);
      assert.equal(await evaluate('window.writes.length'), 1);
      assert.equal(await evaluate('window.row.role'), role);
      assert.equal(await evaluate('window.row.teacher_status'), role === 'teacher' ? 'pending' : null);
      console.log(`PASS order, layout, validation, save, reload and routing: ${role} ${width}x${height}`);
    }
  }
  await open('student'); await fill('nickname', 'Reader'); await fill('age', '12');
  await evaluate('window.failSave=true'); await submit();
  await until('document.querySelector("[role=alert]")?.textContent.includes("couldn\'t save")');
  assert.equal(await evaluate('window.row.nickname'), null);
  assert.equal(await evaluate('window.row.age'), null);
  await evaluate('window.failSave=false'); await submit();
  await until('!!document.getElementById("destination")');
  for (const [role, destination] of [['student', '/dashboard'], ['teacher', '/m3/teacher/dashboard'], ['general_user', '/m3/general/dashboard']]) {
    await open(role, true);
    assert.equal(await evaluate('location.pathname'), destination);
    assert.equal(await evaluate('window.writes.length'), 0);
  }
  console.log('PASS save retry and existing-user routing with null age. Screenshots:', artifacts);
  await send('Browser.close');
} finally { ws?.close(); chrome?.kill(); await server.close(); }
