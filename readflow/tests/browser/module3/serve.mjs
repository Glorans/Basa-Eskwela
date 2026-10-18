import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({ root, configFile: false, server: { host:'127.0.0.1', port:5179, strictPort:true }, plugins:[{
  name:'m3-learner-fixture', enforce:'pre',
  resolveId(id) {
    if(id.endsWith('/auth/useAuth')) return '\0auth';
    if(id.endsWith('/hooks/useAuthenticatedProfile')) return '\0profile';
    if(id.endsWith('/context/M3ContentContext')) return '\0content';
    if(id.endsWith('/services/learnerPlacement')) return '\0placement';
  },
  load(id) {
    if(id==='\0auth') return `export const useAuth=()=>({user:{id:'test-reader'}});`;
    if(id==='\0profile') return `export default ()=>({profile:{nickname:'Reader'}});`;
    if(id==='\0placement') return `export async function getLearnerPlacement(language){const status=new URLSearchParams(location.search).get(language)||'ready';if(status==='loading')return new Promise(()=>{});if(status==='error')throw Error('private database detail');if(status==='missing')return {status,language};return {status:'ready',language,readingLevel:language==='en'?'Instructional':'Independent',difficultyTier:language==='en'?'Medium':'Hard',assessmentId:'private-id',assessmentVersion:'1.0'};}`;
    if(id==='\0content') return `import {getPublishedStudentModules} from '/src/modules/module3/state/studentModuleState.ts';
      const modules=['en','fil'].flatMap(language=>['Easy','Medium','Hard'].map(difficulty=>({id:language+'-'+difficulty,title:language+' '+difficulty+' story',language,difficulty,readingLevel:language==='en'?'Instructional':'Independent',difficultyTier:difficulty,learningPath:language+' path',learningPathId:'path',status:'published',createdAt:'2026',passage:'Story',questionCount:5})));
      modules.push({...modules[0],id:'draft',title:'Draft hidden',status:'draft'},{...modules[0],id:'archive',title:'Archive hidden',status:'archived'});
      export const useM3Content=()=>{const p=new URLSearchParams(location.search);const rows=p.has('noMatch')?modules.filter(m=>m.difficultyTier!==(m.language==='en'?'Medium':'Hard')):modules;return {modules:rows,studentModules:getPublishedStudentModules(rows),modulesLoading:false,modulesError:null};};`;
  },
  configureServer(server) { server.middlewares.use(async(req,res,next)=>{
    if(!req.url.startsWith('/materials')&&!req.url.startsWith('/dashboard'))return next();
    const html=await server.transformIndexHtml('/fixture.html',`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/browser/module3/fixture.tsx"></script></body></html>`);
    res.setHeader('Content-Type','text/html');res.end(html);
  });}
},react()] });
await server.listen(); console.log('M3 learner fixture on 5179');
