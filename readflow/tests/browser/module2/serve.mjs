import { readFile } from 'node:fs/promises';

import { createServer, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
import { createServer as createHttpServer } from 'node:http';
import { Duplex } from 'node:stream';
const require = createRequire(path.join(workspaceRoot, 'server/package.json'));
const { attachDiagnosticSpeechSocket } = require('./routes/diagnosticSpeechSocket');
const { createDiagnosticSpeechSession } = require('./services/diagnosticSpeechStream');
const stats = { mode:'success', sessions:0, audioBytes:0, uploads:0, streamCloses:0, frames:[] };
const backend = createHttpServer((req,res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.url === '/stats') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(stats)); return; }
  if (req.url === '/mode/failure') { stats.mode='failure'; res.end('ok'); return; }
  if (req.url === '/mode/success') { stats.mode='success'; res.end('ok'); return; }
  if (req.url === '/api/diagnostic/audio') {
    stats.uploads++;
    req.resume(); req.on('end',()=>{ res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,message:'ok',transcription:{text:'The colorfully wrapped box was lying on the table.'}})); });
    return;
  }
  res.statusCode=404; res.end();
});
class MockGoogle extends Duplex {
  constructor() { super({objectMode:true}); this.bytes=0; stats.sessions++; }
  _read() {}
  _write(frame,encoding,callback) {
    this.bytes+=frame.length;stats.audioBytes+=frame.length;stats.frames.push(frame.length);
    const seconds=this.bytes/32000;
    if (stats.mode==='failure' && seconds>2) { callback(new Error('Simulated provider failure')); return; }
    if (this.bytes===3200) this.push({results:[{isFinal:false,alternatives:[{transcript:'The colorfully wrapped box'}]}]});
    if (this.bytes===32000) this.push({results:[{isFinal:true,resultEndTime:{seconds:1,nanos:0},alternatives:[{transcript:'The colorfully wrapped box',confidence:.9}]}]});
    callback();
  }
  _final(callback) { this.push({results:[{isFinal:true,resultEndTime:{seconds:Math.max(2,Math.ceil(this.bytes/32000)),nanos:0},alternatives:[{transcript:'was lying on the table',confidence:.9}]}]});this.push(null);callback(); }
  _destroy(error,callback) { stats.streamCloses++; callback(error); }
}
attachDiagnosticSpeechSocket(backend, {
  authenticate: async token => { if(token!=='test-token') throw new Error('Bad fixture token'); },
  allowedOrigins:['http://127.0.0.1:5178'],
  createSession: options => createDiagnosticSpeechSession({...options,createStream:()=>new MockGoogle(),log:()=>{}})
});
await new Promise(resolve=>backend.listen(5019,'127.0.0.1',resolve));
const fixture = await readFile(new URL('./fixture.tsx', import.meta.url), 'utf8');
const vite = await createServer({
  root:path.join(workspaceRoot, 'readflow'),configFile:false,
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('http://127.0.0.1:5019')},
  server:{host:'127.0.0.1',port:5178,strictPort:true},
  plugins:[{
    name:'streaming-review',enforce:'pre',
    resolveId(id) {
      if(id==='/__stream-review.tsx')return '\0stream-review';
      if(id.endsWith('/lib/supabaseClient'))return '\0review-auth';
      if(id.endsWith('/auth/useAuth'))return '\0review-user';
      if(id.endsWith('/services/authProfile'))return '\0review-profile';
    },
    async load(id) {
      if(id==='\0stream-review')return (await transformWithEsbuild(fixture,'review.tsx',{loader:'tsx',jsx:'automatic'})).code;
      if(id==='\0review-auth')return "\nconst authUser={id:'test-reader'};\nexport const supabase={auth:{getSession:async()=>({data:{session:{access_token:'test-token',user:authUser}}}),getUser:async()=>({data:{user:authUser}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},\nfrom:()=>{const filters=[];let inserted;const rows=()=>JSON.parse(sessionStorage.getItem('review-results')||'[]');const get=()=>rows().filter(row=>filters.every(([k,v])=>row[k]===v));const query={\nselect:()=>query,eq:(k,v)=>{filters.push([k,v]);return query},\nupsert:(row,options)=>{review.saves++;const all=rows();const existing=all.find(r=>options.onConflict.split(',').every(k=>r[k]===row[k]));inserted=Object.assign(existing||{},row,{id:'result-'+row.language});if(!existing)all.push(inserted);if(!sessionStorage.getItem('review-save-error'))sessionStorage.setItem('review-results',JSON.stringify(all));return query},\nsingle:async()=>sessionStorage.getItem('review-save-error')?{data:null,error:{code:'42703',message:'column diagnostic_results.assessment_id does not exist',details:null,hint:null}}:({data:inserted}),maybeSingle:async()=>({data:get()[0]||null}),then:resolve=>Promise.resolve({data:get()}).then(resolve)};return query}};\n";
      if(id==='\0review-user')return "const user={id:'test-reader'}; const profile={id:'test-reader',role:'student'}; export const useAuth=()=>({user,profile,loading:false,profileError:false});";
      if(id==='\0review-profile')return "export const getAuthProfile=async()=>({role:'student'});";
    },
    configureServer(server) {
      server.middlewares.use(async (req,res,next)=>{
        if(!req.url.startsWith('/diagnostic') && !req.url.startsWith('/__stream-review?'))return next();
        const html = await server.transformIndexHtml('/review.html','<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/__stream-review.tsx"></script></body></html>');
        res.setHeader('Content-Type','text/html');res.end(html);
      });
    }
  },react()]
});
await vite.listen();
console.log('Streaming browser fixture ready on 5178; mock provider on 5019');
