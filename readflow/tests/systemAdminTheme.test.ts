import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { loadComponentModule, findAll, textOf, createHookRuntime } from "./helpers/hookRuntime.ts";
const require = createRequire(import.meta.url);
const read = (name: string) => readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
const layoutUrl = new URL('../src/modules/module3/components/M3Layout.tsx',import.meta.url);
function mount(role: string, mobile=false, open=false, collapsed=false, url=layoutUrl) {
 const calls: string[]=[];
 const sidebar={mobile,drawerOpen:open,collapsed,close:()=>calls.push('close'),toggle:()=>calls.push('toggle'),
 sidebarRef:{current:null},workspaceRef:{current:null},triggerRef:{current:null},closeRef:{current:null},expanded:mobile?open:!collapsed,
 toggleLabel:mobile?'Open navigation':collapsed?'Expand sidebar':'Collapse sidebar',
 shellClasses:`rf-shell${collapsed?' rf-shell--collapsed':''}${open?' rf-shell--drawer-open':''}`};
 const module=loadComponentModule(url,id=>{
  if(id.endsWith('.css')) return {};
  if(id.endsWith('useResponsiveSidebar'))return {default:()=>sidebar};
  if(id==='react-router-dom')return {Link:'Link',NavLink:'NavLink',Outlet:'Outlet'};
  if(id==='lucide-react')return new Proxy({}, {get:(_t,key)=>String(key)});
  if(id.endsWith('mascot.png'))return {default:'mascot.png'};
  if(id.endsWith('ProfileDropdown'))return {default:'ProfileDropdown'};
  if(id.endsWith('SidebarLogout'))return {default:'SidebarLogout'};
  if(id.endsWith('authOnboarding'))return require(new URL('../src/modules/module1/utils/authOnboarding.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
  if(id.endsWith('workspaceRoot'))return {getM3WorkspaceRoot:(r:string)=>r==='admin'?'/m3/admin':r==='teacher'?'/m3/teacher':'/m3/general'};
  return require(id);
 });
 return {tree:module.default({role}),calls};
}
function normalized(value:any):any {
 if(value==null||typeof value==='boolean')return null;
 if(Array.isArray(value)){const items=value.map(normalized).filter(v=>v!==null);return items.length===1?items[0]:items;}
 if(typeof value==='function')return '[callback]';
 if(typeof value!=='object')return value;
 if(value.type)return {type:String(value.type),props:Object.fromEntries(Object.entries(value.props).filter(([key])=>key!=='ref').map(([key,v])=>[key,normalized(v)]))};
 return value;
}
const fingerprint=(tree:any)=>createHash('sha256').update(JSON.stringify(normalized(tree))).digest('hex');
const fixtureUrl=new URL('./fixtures/systemAdminRoleBaseline.json',import.meta.url);
// Frozen from the pre-redesign worktree snapshot; not regenerated from current source.
const baseline=JSON.parse(readFileSync(fixtureUrl,'utf8'));
for(const role of ['admin','teacher','general_user']) for(const [label,mobile,open,collapsed] of [['desktop',false,false,false],['rail',false,false,true],['mobile',true,false,false],['drawer',true,true,false]] as const)
 test(`${role} ${label}: rendered shell matches pre-redesign snapshot`,()=>assert.equal(fingerprint(mount(role,mobile,open,collapsed).tree),baseline[`${role}:${label}`]));

test('System Admin alone opts into the theme, with existing Settings, Logout and all navigation targets',()=>{
 const {tree,calls}=mount('system_admin');
 assert.match(tree.props.className,/system-admin-ui/);
 // Minimal header: only the menu button and account controls; the page's own heading is the only title.
 const topbar=findAll(tree,n=>n.type==='header'&&n.props?.className==='m3-topbar')[0];
 assert.equal(findAll(topbar,n=>n.type==='ProfileDropdown').length,1);
 assert.equal(textOf(findAll(topbar,n=>n.props?.className==='m3-topbar-title')[0]).trim(),'');
 assert.equal(findAll(tree,n=>n.type==='img')[0].props.src,'mascot.png');
 assert.equal(findAll(tree,n=>n.type==='ProfileDropdown')[0].props.settingsPath,'/system-admin/settings');
 assert.equal(findAll(tree,n=>n.type==='SidebarLogout').length,1);
 const nav=findAll(tree,n=>n.type==='NavLink');assert.equal(nav.length,9);
 for(const route of ['content','content/modules/new','content/materials','content/materials/upload','users','analytics','independent-learners','assessment-packages']) assert.ok(nav.some(n=>n.props.to===`/system-admin/${route}`));
 // M2 F7: Try Assessment (Practice Mode) is the only link outside /system-admin.
 assert.ok(nav.some(n=>n.props.to==='/practice/diagnostic'));
 nav[0].props.onClick();findAll(tree,n=>n.type==='SidebarLogout')[0].props.onSignedOut();
 assert.deepEqual(calls,['close','close']);
 assert.equal(nav[0].props.className({isActive:true}),'m3-nav-item m3-nav-item--active');
});
for(const [label,mobile,open,collapsed] of [['desktop',false,false,false],['rail',false,false,true],['mobile',true,false,false],['drawer',true,true,false]] as const)
 test(`System Admin ${label}: original mascot and brand labels are retained`,()=>{
  const {tree}=mount('system_admin',mobile,open,collapsed);
  const brand=findAll(tree,n=>n.props?.className==='m3-sidebar-home')[0];
  const logo=findAll(brand,n=>n.props?.className==='m3-brand-logo')[0];
  assert.equal(findAll(logo,n=>n.type==='img'&&n.props.src==='mascot.png').length,1);
  assert.equal(findAll(logo,n=>n.type==='BookOpenCheck').length,0);
  assert.match(textOf(brand),/Basa Eskwela/);
  assert.match(textOf(brand),/Administration/);
  assert.doesNotMatch(read('modules/system-admin/systemAdmin.css'),/\.m3-brand-logo/,'reuse shared responsive mascot sizing and proportions');
 });

test('every stylesheet selector is System Admin-scoped, including responsive and dialog rules',()=>{
 const css=read('modules/system-admin/systemAdmin.css');
 const postcss=require('postcss');let count=0;
 postcss.parse(css).walkRules((rule:any)=>{assert.ok(rule.selector.startsWith('.system-admin-ui'),rule.selector);count++;});
 assert.ok(count>60);assert.doesNotMatch(css,/:root|!important/);
 for(const color of ['#123f32','#287453','#e9f3ec','#f8f3e8','#faf7f0','#d8d5c9']) assert.ok(css.includes(color));
});
test('System Admin pages show one title each: no header title and no decorative workspace labels',()=>{
 for(const file of ['modules/module3/pages/Module3Page.tsx','modules/module3/pages/MaterialLibraryPage.tsx','modules/module3/pages/UploadMaterialPage.tsx','modules/module3/pages/QuestionReviewPage.tsx','modules/module3/components/AdminCollectionEditor.tsx','modules/module3/components/M3Layout.tsx','modules/system-admin/systemAdmin.css'])
  assert.doesNotMatch(read(file),/System Admin workspace|System administration|sa-page-context|SystemAdminPageTitle/i,file);
 const editor=read('modules/module3/components/AdminCollectionEditor.tsx');
 assert.match(editor,/backLabel: "Back to Content Management", eyebrow: "" \}/);
 assert.match(editor,/\{paths\.eyebrow && <p className="m3-eyebrow">\{paths\.eyebrow\}<\/p>\}/);
 // School Admin, Teacher and Independent Learner labels are unchanged.
 assert.match(editor,/eyebrow: "Teacher Workspace" \}[\s\S]*eyebrow: "Admin Workspace" \}/);
 assert.match(read('modules/module3/pages/Module3Page.tsx'),/teacher \? "Teacher workspace" : workspace === "system_admin" \? undefined : "Admin library"/);
 for(const file of ['MaterialLibraryPage','UploadMaterialPage']) assert.match(read(`modules/module3/pages/${file}.tsx`),/role === "system_admin" \? undefined : role === "teacher" \? "Teacher workspace" : "Personal workspace"/);
 assert.match(read('modules/module3/pages/QuestionReviewPage.tsx'),/role === "system_admin" \? undefined : `\$\{role === "admin" \? "Admin" : "Teacher"\} question review`/);
});
test('weekly chart shows API counts without mutation, fabricated totals or empty-data bars',()=>{
 const mod=loadComponentModule(new URL('../src/modules/system-admin/SystemAdminActivityChart.tsx',import.meta.url),id=>id.endsWith('dateDisplay')?{formatAnalyticsDate:(v:string)=>v}:require(id));
 assert.equal(mod.default({weeks:[]}),null);
 const weeks=[{weekStart:'2026-11-09',readings:4,completedQuizzes:2},{weekStart:'2026-11-16',readings:0,completedQuizzes:0}];
 const original=structuredClone(weeks);const tree=mod.default({weeks});
 assert.deepEqual(weeks,original);
 assert.ok(findAll(tree,n=>n.props?.['aria-label']==='4 saved readings').length);
 assert.deepEqual(findAll(tree,n=>n.props?.style).map(n=>n.props.style.width),['100%','50%','0%','0%']);
});
for(const system of [false,true])test(`confirmation dialog theme isolation: System Admin=${system}`,async()=>{
 const runtime=createHookRuntime(require('react'));let tree:any,removed=false;const host={className:'',remove(){removed=true;}};
 const mod=loadComponentModule(new URL('../src/components/ReadFlowDialog.tsx',import.meta.url),id=>{
  if(id==='react')return runtime.react;
  if(id==='react-dom/client')return {createRoot:()=>({render:(node:any)=>{tree=runtime.render(node.type,node.props);},unmount(){}})};
  return require(id);
 },{document:{activeElement:null,querySelector:()=>system?{}:null,createElement:()=>host,body:{append(){}}},HTMLElement:class{}});
 const result=mod.confirmReadFlow('Delete fixture?',{confirm:'Delete',cancel:'Keep'});
 assert.equal(host.className,system?'system-admin-ui system-admin-dialog-host':'');
 const cancel=findAll(tree,n=>n.type==='button'&&textOf(n)==='Keep')[0];cancel.props.onClick();
 assert.equal(await result,false);assert.equal(removed,true);
});

test('Student shell, shared interaction components and every existing stylesheet match the snapshot',()=>{
 const protectedFiles=JSON.parse(readFileSync(new URL('./fixtures/systemAdminProtectedUi.json',import.meta.url),'utf8'));
 for(const [name,hash] of Object.entries(protectedFiles)){
  const bytes=readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,name);
 }
});
