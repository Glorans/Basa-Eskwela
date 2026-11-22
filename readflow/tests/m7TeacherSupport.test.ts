import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHookRuntime, findAll, textOf, loadComponentModule, tick } from './helpers/hookRuntime.ts';
import { teacherSupport } from './fixtures/m7Support.ts';
import * as dates from '../src/modules/module7/services/dateDisplay.ts';
import * as scores from '../src/modules/module7/services/scoreDisplay.ts';
import * as classification from '../src/modules/module7/services/studentSupportClassification.ts';
const require=createRequire(import.meta.url);
function setup(fail=false,response:unknown=teacherSupport) {
  const runtime=createHookRuntime(require('react')), calls:any[]=[];
  const module=loadComponentModule(new URL('../src/modules/module7/M7Pages.tsx',import.meta.url),id=>{
    if(id==='react') return runtime.react;
    if(id==='react/jsx-runtime') return require(id);
    if(id==='react-router-dom') return {Link:'link'};
    if(id.endsWith('.css') || id.endsWith('/comprehensionNavigation')) return {};
    if (id.endsWith('/SuggestedInterventions')) return { SuggestedInterventions: 'suggested-interventions' };
    if (id.endsWith('/LearnerSuggestions')) return { LearnerSuggestions: 'learner-suggestions' };
    if(id.endsWith('/AdminAnalyticsPage')) return {default:'admin'};
    if(id.endsWith('/dateDisplay')) return dates;
    if(id.endsWith('/scoreDisplay')) return scores;
    if(id.endsWith('/studentSupportClassification')) return classification;
    if(id.endsWith('/m7Service')) return {m7Request:async(path:string,method='GET',body?:unknown)=>{calls.push({path,method,body});if(fail)throw Error('Not authorized');return response;}};
    throw Error(id);
  },{setInterval:()=>1,clearInterval:()=>{},document:{getElementById:()=>null}});
  return {calls,module,render:(name='TeacherSupportPage',props={})=>runtime.render(module[name],props)};
}
const byId=(tree:any,id:string)=>findAll(tree,n=>n.props.id===id)[0];
const tab=(tree:any,index:number)=>byId(tree,`support-tab-${index}`).props.onClick();
// Saved intervention cards are their own component: render each one directly to read its text.
const records=(app:any,tree:any)=>findAll(tree,n=>n.type===app.module.InterventionRecord).map((n:any)=>textOf(app.module.InterventionRecord(n.props))).join(' ');
test('Teacher support has one visible panel, preserves student/filter selection and removes notifications and shortcuts',async()=>{
  const app=setup();app.render();await tick();let tree=app.render();
  assert.equal(findAll(tree,n=>n.props.role==='tabpanel' && !n.props.hidden).length,1);
  assert.equal(byId(tree,'support-panel-0').props.hidden,false);
  assert.doesNotMatch(textOf(tree),/Notifications|No unread alerts|View weekly reports|View performance analytics|F8|F9|F10/);
  assert.match(textOf(tree),/Understanding Support Levels/);
  assert.match(textOf(tree),/2\/2 \(100%\)/);
  findAll(tree,n=>n.props['aria-label']==='View details for Ana')[0].props.onClick();tree=app.render();
  tab(tree,1);tree=app.render();assert.equal(byId(tree,'support-student').props.value,'ana');
  assert.equal(findAll(tree,n=>n.props.role==='tabpanel'&&!n.props.hidden).length,1);
  assert.match(textOf(byId(tree,'support-panel-1')),/Literal100%4 assessed questions/);
  assert.match(textOf(byId(tree,'support-panel-1')),/Inferential50%2 assessed questions/);
  assert.match(textOf(byId(tree,'support-panel-1')),/CriticalNo data0 assessed questions/);
  const excluded=findAll(tree,n=>n.type==='details'&&textOf(n).includes('Other Saved Results'))[0];
  assert.ok(excluded);assert.equal(excluded.props.open,undefined);
  tab(tree,2);tree=app.render();assert.equal(byId(tree,'support-student').props.value,'ana');
  assert.match(records(app,byId(tree,'support-panel-2')),/Review the story together/);
  // M7 F10: the selected Student's suggestions load from the Teacher route, inside the interventions panel.
  const suggestions=findAll(byId(tree,'support-panel-2'),n=>n.type==='suggested-interventions');
  assert.equal(suggestions.length,1);assert.equal(suggestions[0].props.path,'/students/ana/suggestions');
  assert.deepEqual(app.calls,[{path:'/teacher',method:'GET',body:undefined}]);
  byId(tree,'support-student').props.onChange({target:{value:'ben'}});tree=app.render();
  assert.match(textOf(byId(tree,'support-panel-2')),/No interventions recorded/);
  tab(tree,1);tree=app.render();assert.doesNotMatch(textOf(byId(tree,'support-panel-1')),/0%/);
});
test('Record and Edit forms preserve request paths, fields and status values; denial has accessible feedback',async()=>{
  for(const existing of [undefined,teacherSupport.students[0].interventions[0]]) {
    const app=setup();let saved=false;
    const props={studentId:'ana',existing,teacherLayout:true,onSaved:()=>{saved=true;},onCancel:()=>{}};
    let tree=app.render('InterventionForm',props);
    findAll(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'Practice together'}});
    tree=app.render('InterventionForm',props);await tree.props.onSubmit({preventDefault(){}});
    assert.equal(saved,true);assert.equal(app.calls[0].path,existing?'/students/ana/interventions/existing':'/students/ana/interventions');
    assert.equal(app.calls[0].method,existing?'PATCH':'POST');
    assert.equal(app.calls[0].body.notes,'Practice together');assert.equal(app.calls[0].body.status,'planned');
    assert.deepEqual(Object.keys(app.calls[0].body).sort(),['competency','follow_up_date','follow_up_notes','follow_up_outcome','intervention_date','language','notes','status','teacher_notes']);
    assert.deepEqual([app.calls[0].body.competency,app.calls[0].body.language,app.calls[0].body.follow_up_outcome],[null,null,null],'unset F11 fields are sent as null, never invented');
  }
  const denied=setup(true);const props={studentId:'ana',onSaved:()=>assert.fail('must not confirm denied write'),onCancel:()=>{}};
  await denied.render('InterventionForm',props).props.onSubmit({preventDefault(){}});
  assert.match(textOf(findAll(denied.render('InterventionForm',props),n=>n.props.role==='alert')[0]),/Not authorized/);
});
test('Unauthorized support response does not render learner details',async()=>{
  const app=setup(true);app.render();await tick();const tree=app.render();
  assert.equal(findAll(tree,n=>n.props.role==='tabpanel').length,0);
  assert.doesNotMatch(textOf(tree),/Ana|Ben|Review the story/);
});

test('Alerts appear only while background alerts are active and unread; Mark read uses the existing route',async()=>{
  const off=setup();off.render();await tick();
  assert.doesNotMatch(textOf(off.render()),/New alerts|Mark read|unread/);
  const alert={...teacherSupport.students[0].history[0],id:'unread-alert'};
  const app=setup(false,{...teacherSupport,notificationsActive:true,notifications:[alert]});app.render();await tick();let tree=app.render();
  const alerts=findAll(tree,n=>n.props['aria-label']==='New support alerts')[0];
  assert.match(textOf(alerts),/Ana: At Risk/);assert.doesNotMatch(textOf(tree),/\(\d+ unread\)/);
  await findAll(alerts,n=>n.type==='button'&&textOf(n)==='Mark read')[0].props.onClick();
  assert.deepEqual(app.calls.at(-2),{path:'/notifications/unread-alert/read',method:'PATCH',body:undefined});
});
test('Support guide keeps the eligibility note and project-defined wording; history cards use readable status labels',async()=>{
  const app=setup();app.render();await tick();let tree=app.render();
  const guide=findAll(tree,n=>n.type==='details'&&textOf(n).includes('Understanding Support Levels'))[0];
  assert.equal(findAll(guide,n=>n.type===app.module.RiskGuidance).length,1,'full guide is inside the collapsed section');
  assert.match(classification.RISK_RULES_INTRO,/not a DepEd classification/);
  assert.match(textOf(guide),/Eligible quiz scores include independent work/);
  assert.ok(classification.RISK_RULES.some(([label,text])=>label==='No assessment data'&&/not a low score/.test(text)));
  findAll(tree,n=>n.props['aria-label']==='View details for Ana')[0].props.onClick();tree=app.render();
  tab(tree,2);tree=app.render();
  assert.match(records(app,byId(tree,'support-panel-2')),/Planned/);
  assert.doesNotMatch(records(app,byId(tree,'support-panel-2')),/planned/);
});
test('Teacher intervention form orders date and status, details, then follow-up; Admin order is unchanged',()=>{
  const labels=(teacherLayout:boolean)=>{const app=setup();const tree=app.render('InterventionForm',{studentId:'ana',teacherLayout,onSaved(){},onCancel(){}});
    return findAll(tree,n=>n.type==='label').map(l=>textOf(l).replace(/(Planned|In progress|Completed)+$/,''));};
  const name=(l:string)=>l.replace(/(Not specified|Not language-specific|Not yet recorded).*$/,'');
  assert.deepEqual(labels(true).map(name),['Competency addressed','Language','Date recorded','Status','Intervention details','Teacher notes (optional)','Follow-up date','Follow-up outcome','Follow-up information']);
  assert.deepEqual(labels(false).map(name),['Notes','Competency addressed','Language','Date','Status','Additional notes (optional)','Follow-up date','Follow-up outcome','Follow-up information']);
  const app=setup();const tree=app.render('InterventionForm',{studentId:'ana',teacherLayout:true,existing:teacherSupport.students[0].interventions[0],onSaved(){},onCancel(){}});
  assert.match(textOf(tree),/Edit Intervention/);
  assert.equal(findAll(tree,n=>n.type==='button'&&textOf(n)==='Cancel')[0].props.className,'m7-secondary');
});

const suggestion={id:'en:critical',competency:'critical',competencyName:'Critical Comprehension',language:'en',languageName:'English',status:'needs_practice',level:'preliminary',trend:null,moreEvidenceNeeded:true,
  evidence:{},evidenceText:'0/2 critical questions answered correctly on the first try in the latest completed English assessment.',reason:'More assessments are needed.',period:null,sinceIntervention:null,
  suggestion:{key:'evidence_based_reading',title:'Evidence-Based Reading Practice',approach:'Text evidence',activity:"Evaluate a character's decision."}};
test('M7 F10/F11: a chosen suggestion pre-fills the form, locks its competency and language, and is sent only as its id',async()=>{
  const app=setup();let saved=false;
  const props={studentId:'ana',suggestion,teacherLayout:true,onSaved:()=>{saved=true;},onCancel:()=>{}};
  let tree=app.render('InterventionForm',props);
  assert.match(textOf(tree),/Based on suggestionEvidence-Based Reading Practice0\/2 critical questions/);
  assert.equal(findAll(tree,n=>n.type==='textarea')[0].props.value,"Evidence-Based Reading Practice: Evaluate a character's decision.");
  const selects=findAll(tree,n=>n.type==='select');
  assert.deepEqual(selects.slice(0,2).map((n:any)=>[n.props.value,n.props.disabled]),[['critical',true],['en',true]]);
  assert.equal(selects[2].props.value,'planned','a suggestion is saved as Planned unless the Teacher changes it');
  await tree.props.onSubmit({preventDefault(){}});
  assert.equal(saved,true);
  assert.deepEqual([app.calls[0].path,app.calls[0].method,app.calls[0].body.suggestion_id,app.calls[0].body.competency,app.calls[0].body.status],['/students/ana/interventions','POST','en:critical','critical','planned']);
  assert.equal('suggestion_snapshot' in app.calls[0].body,false,'the evidence snapshot is made by the server');
  assert.match(textOf(tree),/A suggestion is not a record that an intervention was given/);
});
test('M7 F11: saved records show competency, language, the chosen suggestion and the follow-up outcome',()=>{
  const app=setup();
  const item={id:'x',notes:'Small-group practice',intervention_date:'2026-11-07',status:'completed',follow_up_date:null,follow_up_notes:'Scores improved.',competency:'critical',language:'en',
    suggestion_key:'evidence_based_reading',suggestion_snapshot:{id:'en:critical',competency:'critical',language:'en',title:'Evidence-Based Reading Practice',approach:'',activity:'',evidenceText:'1/6 critical',reason:'Repeated pattern',level:'pattern',period:null,generatedAt:'2026-11-07T01:00:00Z'},
    teacher_notes:'Paired with a buddy.',follow_up_outcome:'improved'};
  const text=textOf(app.module.InterventionRecord({item,onEdit(){}}));
  for(const part of [/Completed/,/Critical comprehension/,/English/,/From suggestion: Evidence-Based Reading Practice/,/1\/6 critical/,/Paired with a buddy\./,/Follow-up outcome: Improved/,/Scores improved\./]) assert.match(text,part);
  const own=textOf(app.module.InterventionRecord({item:{...item,suggestion_key:null,suggestion_snapshot:null},onEdit(){}}));
  assert.match(own,/Teacher-written intervention/);
});
