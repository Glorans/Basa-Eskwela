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
  assert.match(textOf(byId(tree,'support-panel-2')),/Review the story together/);
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
    assert.deepEqual(Object.keys(app.calls[0].body).sort(),['follow_up_date','follow_up_notes','intervention_date','notes','status']);
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
  assert.match(textOf(byId(tree,'support-panel-2')),/Planned/);
  assert.doesNotMatch(textOf(byId(tree,'support-panel-2')),/planned/);
});
test('Teacher intervention form orders date and status, details, then follow-up; Admin order is unchanged',()=>{
  const labels=(teacherLayout:boolean)=>{const app=setup();const tree=app.render('InterventionForm',{studentId:'ana',teacherLayout,onSaved(){},onCancel(){}});
    return findAll(tree,n=>n.type==='label').map(l=>textOf(l).replace(/(Planned|In progress|Completed)+$/,''));};
  assert.deepEqual(labels(true),['Date recorded','Status','Intervention details','Follow-up date','Follow-up information']);
  assert.deepEqual(labels(false),['Notes','Date','Status','Follow-up date','Follow-up information']);
  const app=setup();const tree=app.render('InterventionForm',{studentId:'ana',teacherLayout:true,existing:teacherSupport.students[0].interventions[0],onSaved(){},onCancel(){}});
  assert.match(textOf(tree),/Edit Intervention/);
  assert.equal(findAll(tree,n=>n.type==='button'&&textOf(n)==='Cancel')[0].props.className,'m7-secondary');
});
