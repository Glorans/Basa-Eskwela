import { searchParamsRouter } from './helpers/searchParamsRouter.ts';
import * as studentRequests from '../src/modules/module7/services/studentPerformanceRequests.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from './helpers/hookRuntime.ts';
import * as dates from '../src/modules/module7/services/dateDisplay.ts';
import * as scores from '../src/modules/module7/services/scoreDisplay.ts';
import * as risk from '../src/modules/module7/services/studentSupportClassification.ts';
import { studentReadingPoints } from '../src/modules/module7/services/studentReadingPresentation.ts';
import { adminDetail, adminStudents } from './fixtures/m7Performance.ts';
const require = createRequire(import.meta.url);
function setup(file: string, responses: Record<string, unknown> = {}) {
  const runtime = createHookRuntime(require('react'));
  const navigation = searchParamsRouter("link");
  const calls: string[] = [], focused: string[] = [];
  const auth = { user: {id:'admin'}, profile:{id:'admin',role:'admin'}, loading:false,profileError:false };
  const module = loadComponentModule(new URL(`../src/modules/module7/${file}`, import.meta.url), id => {
    if (id.endsWith('/useAuth')) return { useAuth: () => auth };
    if (id.endsWith('/studentPerformanceRequests')) return studentRequests;
    if (id === 'react-router-dom') return navigation.module;
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'lucide-react') return { Search: 'search-icon' };
    if (id.endsWith('.css')) return {};
    if (id.endsWith('dateDisplay')) return dates;
    if (id.endsWith('scoreDisplay')) return scores;
    if (id.endsWith('studentSupportClassification')) return risk;
    if (id.endsWith('adminClassroomLabels')) return { loadAdminClassroomLabels: async () => [{ id: 'room-a', label: 'Room A' }] };
    if (id.endsWith('classroomService')) return { getClassroomById: async () => ({}), getRoomEnrollments: async () => [{ student_id: 'ana' }, { student_id: 'unrelated-account' }] };
    if (id.endsWith('PerformanceSelector')) return { default: 'selector' };
    if (id.endsWith('StudentCombobox')) return { default: 'combobox' };
    if (id.endsWith('StudentReadingChart')) return { default: 'reading-chart' };
    if (id.endsWith('SuggestedInterventions')) return { SuggestedInterventions: 'suggestions' };
    if (id.endsWith('M7Pages')) return { RiskGuidance: 'guide', NotCountedQuizzes: 'historical' };
    if (id.endsWith('m7Service')) return { m7Request: async (path: string, method = 'GET') => {
      assert.equal(method, 'GET'); calls.push(path);
      if (responses[path] instanceof Error) throw responses[path];
      if (path in responses) return responses[path];
      if (path === '/admin/students') return adminStudents;
      if (path === '/system') return { details: {} };
      return adminDetail(path.split('/').at(-1)!);
    } };
    throw Error(`Unexpected import ${id}`);
  }, { Error, URLSearchParams, document: { getElementById: (id: string) => ({ focus: () => focused.push(id) }) } });
  return { module, calls, focused, auth, navigation, render: (props = {}, component = module.StudentPerformanceWorkspace ?? module.default) => runtime.render(component, props) };
}
const byId = (tree: any, id: string) => findAll(tree, n => n.props?.id === id)[0];

test('no default student or detail request; selection, combined filters and Reset are explicit', async () => {
  const app = setup('AdminStudentPerformancePage.tsx'); app.render(); await tick(); let tree = app.render();
  assert.match(textOf(tree), /Select a student to view performance/);
  assert.equal(findAll(tree, n => n.props?.studentId).length, 0);
  assert.deepEqual(app.calls, ['/system', '/admin/students']);
  const guide = findAll(tree, n => n.type === 'details')[0]; assert.equal(guide.props.open, undefined);
  byId(tree, 'admin-student').props.onChange('ana'); tree = app.render();
  assert.equal(findAll(tree, n => n.props?.studentId)[0].props.studentId, 'ana');
  byId(tree, 'admin-student-classroom').props.onChange('room-a'); app.render(); await tick(); tree = app.render();
  assert.deepEqual(byId(tree, 'admin-student').props.options.map((o: any) => o.id), ['ana']);
  assert.equal(findAll(tree, n => n.props?.studentId).length, 0);
  byId(tree, 'admin-student-classification').props.onChange({ target: { value: 'Needs Support' } }); tree = app.render();
  assert.equal(byId(tree, 'admin-student').props.options.length, 0);
  assert.match(textOf(tree), /No students match these filters/);
  findAll(tree, n => n.type === 'button' && textOf(n) === 'Reset Filters')[0].props.onClick(); tree = app.render();
  assert.equal(byId(tree, 'admin-student-classroom').props.value, '');
  assert.equal(byId(tree, 'admin-student-classification').props.value, 'all');
  assert.equal(byId(tree, 'admin-student').props.value, '');
  assert.equal(byId(tree, 'admin-student').props.options.length, adminStudents.length);
});

test('late detail responses cannot replace a newer selection or show during loading', async () => {
  let resolveAna!: (data: unknown) => void, resolveBen!: (data: unknown) => void;
  const app = setup('AdminStudentPerformancePage.tsx', {
    '/admin/students/ana': new Promise(resolve => { resolveAna = resolve; }),
    '/admin/students/ben': new Promise(resolve => { resolveBen = resolve; }),
  });
  const props = { studentId: 'ana', onClose() {} };
  app.render(props, app.module.StudentDetail);
  const next = { ...props, studentId: 'ben' };
  assert.match(textOf(app.render(next, app.module.StudentDetail)), /Loading student/);
  resolveBen(adminDetail('ben')); await tick();
  assert.equal(textOf(byId(app.render(next, app.module.StudentDetail), 'admin-student-detail')), 'Ben');
  resolveAna(adminDetail('ana')); await tick();
  const tree = app.render(next, app.module.StudentDetail);
  assert.equal(textOf(byId(tree, 'admin-student-detail')), 'Ben');
  assert.doesNotMatch(textOf(tree), /Ana/);
  assert.match(textOf(app.render(props, app.module.StudentDetail)), /Loading student/, 'even a direct ID change hides the loaded previous response immediately');
});

test('detail tabs preserve student, loaded data and read-only suggestion evidence', async () => {
  const app = setup('AdminStudentPerformancePage.tsx');
  const props = { studentId: 'ana', onClose() {} }; app.render(props, app.module.StudentDetail); await tick();
  let tree = app.render(props, app.module.StudentDetail);
  for (const index of [1, 2, 0]) {
    byId(tree, `student-detail-tab-${index}`).props.onClick(); tree = app.render(props, app.module.StudentDetail);
    assert.equal(findAll(tree, n => n.props.role === 'tabpanel' && !n.props.hidden).length, 1);
    assert.equal(byId(tree, `student-detail-panel-${index}`).props.hidden, false);
    assert.equal(textOf(byId(tree, 'admin-student-detail')), 'Ana');
  }
  byId(tree, 'student-detail-tab-0').props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} });
  assert.deepEqual(app.focused, ['student-detail-tab-2']);
  assert.deepEqual(app.calls, ['/admin/students/ana']);
  const suggestions = findAll(tree, n => n.type === 'suggestions')[0];
  assert.equal(suggestions.props.readOnly, true); assert.equal(suggestions.props.compact, true);
  assert.equal(suggestions.props.onUse, undefined); assert.equal(suggestions.props.path, '/admin/students/ana/suggestions');
  assert.equal(findAll(tree, n => n.type === 'historical').length, 1);
});

test('detail errors show inline Retry and never old metrics', async () => {
  const responses: Record<string, unknown> = { '/admin/students/ana': Error('Unavailable') };
  const app = setup('AdminStudentPerformancePage.tsx', responses), props = { studentId: 'ana', onClose() {} };
  app.render(props, app.module.StudentDetail); await tick(); let tree = app.render(props, app.module.StudentDetail);
  assert.equal(tree.props.role, 'alert'); assert.match(textOf(tree), /Unavailable/);
  assert.equal(byId(tree, 'admin-student-detail'), undefined);
  responses['/admin/students/ana'] = adminDetail('ana');
  findAll(tree, n => n.type === 'button' && textOf(n) === 'Retry')[0].props.onClick(); app.render(props, app.module.StudentDetail); await tick();
  tree = app.render(props, app.module.StudentDetail); assert.equal(textOf(byId(tree, 'admin-student-detail')), 'Ana');
});

test('combobox opens, filters, selects unique IDs with keyboard, clears and reports no matches', () => {
  const app = setup('components/StudentCombobox.tsx'), changes: string[] = [];
  const options = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ana' }, { id: 'c', name: 'Ben' }];
  let props = { id: 'student', value: '', options, onChange: (id: string) => changes.push(id) };
  app.render(props); let tree = app.render(props);
  byId(tree, 'student').props.onFocus(); tree = app.render(props);
  assert.equal(byId(tree, 'student').props['aria-expanded'], true);
  byId(tree, 'student').props.onChange({ target: { value: 'ana' } }); tree = app.render(props);
  assert.equal(findAll(tree, n => n.props.role === 'option').length, 2);
  byId(tree, 'student').props.onKeyDown({ key: 'End', preventDefault() {} }); tree = app.render(props);
  assert.equal(byId(tree, 'student').props['aria-activedescendant'], 'student-option-b');
  byId(tree, 'student').props.onKeyDown({ key: 'Enter', preventDefault() {} }); assert.deepEqual(changes, ['b']);
  props = { ...props, value: 'b' }; app.render(props); tree = app.render(props);
  assert.equal(byId(tree, 'student').props.value, 'Ana'); assert.equal(byId(tree, 'student').props['aria-expanded'], false);
  byId(tree, 'student').props.onChange({ target: { value: 'no matches' } }); tree = app.render(props);
  assert.match(textOf(tree), /No matching students found/);
  findAll(tree, n => n.props['aria-label'] === 'Clear student selection')[0].props.onClick(); assert.deepEqual(changes, ['b', '']);
});

test('large student list limits initial DOM options without excluding later keyboard choices', () => {
  const app = setup('components/StudentCombobox.tsx'); const changes: string[] = [];
  const props = { id:'student', value:'', options:Array.from({length:2000},(_,i)=>({id:String(i),name:`Student ${i}`})), onChange:(id:string)=>changes.push(id) };
  app.render(props); let tree=app.render(props); byId(tree,'student').props.onFocus(); tree=app.render(props);
  assert.equal(findAll(tree,n=>n.props.role==='option').length,50);
  byId(tree,'student').props.onKeyDown({key:'End',preventDefault(){}});tree=app.render(props);
  byId(tree,'student').props.onKeyDown({key:'Enter',preventDefault(){}});assert.deepEqual(changes,['1999']);
});

test('reading chart keeps every dated attempt including repeated titles and null values', () => {
  const readings = [{ id:'2',title:'Same story',completedAt:'2026-11-02T00:00:00Z',readingAccuracy:null,readingSpeedWpm:0 },
    { id:'1',title:'Same story',completedAt:'2026-11-01T00:00:00Z',readingAccuracy:80,readingSpeedWpm:null }];
  const original = JSON.stringify(readings), points = studentReadingPoints(readings);
  assert.deepEqual(points.map(p=>p.id),['1','2']); assert.equal(points[1].readingAccuracy,null); assert.equal(points[1].readingSpeedWpm,0);
  assert.equal(JSON.stringify(readings),original);
});

test('compact suggestions retain the same evidence body and leave default primary cards expanded', async () => {
  const { studentSuggestions } = await import('./fixtures/adminStudentPerformance.ts');
  for (const compact of [false, true]) {
    const app = setup('components/SuggestedInterventions.tsx', { '/admin/students/ana/suggestions': studentSuggestions });
    const props = { path: '/admin/students/ana/suggestions', readOnly: true, compact };
    app.render(props, app.module.SuggestedInterventions); await tick();
    const tree = app.render(props, app.module.SuggestedInterventions);
    const card = findAll(tree, n => n.props?.item === studentSuggestions.suggestions[0] && n.props?.primary === true)[0];
    const rendered = card.type(card.props);
    assert.equal(findAll(rendered, n => n.type === 'details').length, compact ? 1 : 0);
    const body = findAll(rendered, n => n.type?.name === 'SuggestionBody')[0];
    assert.equal(body.props.item, studentSuggestions.suggestions[0]); assert.equal(body.props.onUse, undefined);
    const evidence = body.type(body.props);
    assert.match(textOf(evidence), /Why this is suggested/);
    assert.match(textOf(evidence), /Read the sentence together/);
    assert.equal(findAll(evidence, n => n.type === 'button').length, 0);
    assert.equal(findAll(evidence, n => n.type?.name === 'PracticeWords')[0].props.item.evidence.wordsReadDifferently[0].times, 2);
  }
});


test('workspace cache resets on account/permission changes but not equivalent profile objects', async () => {
  const app = setup('AdminStudentPerformancePage.tsx');
  const first=app.render({},app.module.default);
  await first.props.requests.request('/admin/students/ana');
  app.auth.profile={...app.auth.profile};
  const same=app.render({},app.module.default);
  assert.equal(same.key,first.key);
  await same.props.requests.request('/admin/students/ana');assert.equal(app.calls.length,1);
  app.auth.user={id:'other-admin'};app.auth.profile={id:'other-admin',role:'admin'};
  const other=app.render({},app.module.default);assert.notEqual(other.key,first.key);
  await other.props.requests.request('/admin/students/ana');assert.equal(app.calls.length,2);
  app.auth.profile={...app.auth.profile,role:'teacher'};
  assert.equal(app.render({},app.module.default),null);
  first.props.requests.clear();other.props.requests.clear();
});

test('detail and suggestions start independently; a slow suggestion never blocks the profile', async () => {
  const app=setup('AdminStudentPerformancePage.tsx');
  const calls:string[]=[];let finishSuggestions!: (value:unknown)=>void;
  const requests=studentRequests.createStudentPerformanceRequests((async (path:string)=>{
    calls.push(path);
    if(path.endsWith('/suggestions'))return new Promise<unknown>(resolve=>{finishSuggestions=resolve;});
    return adminDetail('ana');
  }) as studentRequests.StudentPerformanceFetch);
  const props={studentId:'ana',requests,onClose(){}};
  app.render(props,app.module.StudentDetail);await tick();
  const tree=app.render(props,app.module.StudentDetail);
  assert.deepEqual(calls.sort(),['/admin/students/ana','/admin/students/ana/suggestions']);
  assert.equal(textOf(byId(tree,'admin-student-detail')),'Ana');
  finishSuggestions({suggestions:[]});await tick();requests.clear();
});

test('student links wait for the authorized list, select by ID, and clear URL selection without removing other parameters', async () => {
  let resolveList!: (rows: unknown) => void;
  const app = setup('AdminStudentPerformancePage.tsx', { '/admin/students': new Promise(resolve => { resolveList = resolve; }) });
  app.navigation.navigate('studentId=ana&source=support');
  let tree = app.render();
  assert.equal(findAll(tree, n => n.props?.studentId).length, 0);
  resolveList(adminStudents); await tick(); tree = app.render();
  assert.equal(findAll(tree, n => n.props?.studentId)[0].props.studentId, 'ana');
  app.navigation.navigate('studentId=ben&source=support'); tree = app.render();
  assert.equal(findAll(tree, n => n.props?.studentId).length, 1);
  assert.equal(findAll(tree, n => n.props?.studentId)[0].props.studentId, 'ben');
  findAll(tree, n => n.props?.studentId)[0].props.onClose(); tree = app.render();
  assert.equal(app.navigation.search(), 'source=support');
  assert.equal(findAll(tree, n => n.props?.studentId).length, 0);
  assert.match(textOf(tree), /Select a student to view performance/);
});

test('unavailable, malformed, empty and ambiguous student links never request or display student details', async () => {
  const app=setup('AdminStudentPerformancePage.tsx'); app.render(); await tick();
  for(const search of ['studentId=not-authorized','studentId=Ana','studentId=..%2Fother','studentId=','studentId=ana&studentId=ben']) {
    app.navigation.navigate(search);const tree=app.render();
    assert.equal(findAll(tree,n=>n.props?.studentId).length,0);
    assert.match(textOf(tree),/requested student is unavailable or does not match/);
  }
  assert.deepEqual(app.calls,['/system','/admin/students']);
  app.navigation.navigate('studentId=not-authorized');let tree=app.render();
  byId(tree,'admin-student').props.onChange('ana');tree=app.render();
  assert.equal(findAll(tree,n=>n.props?.studentId)[0].props.studentId,'ana');
  app.navigation.navigate('');tree=app.render();
  assert.equal(findAll(tree,n=>n.props?.studentId).length,0,'sidebar navigation clears an earlier linked selection');
});

test('classification and classroom changes clear linked selection and preserve eligibility rules', async () => {
  const app=setup('AdminStudentPerformancePage.tsx');app.navigation.navigate('studentId=ben');app.render();await tick();let tree=app.render();
  byId(tree,'admin-student-classroom').props.onChange('room-a');app.render();await tick();tree=app.render();
  assert.equal(app.navigation.search(),'');assert.equal(findAll(tree,n=>n.props?.studentId).length,0);
  app.navigation.navigate('studentId=ben');tree=app.render();
  assert.match(textOf(tree),/requested student is unavailable or does not match/);
  app.navigation.navigate('studentId=ana');tree=app.render();assert.equal(findAll(tree,n=>n.props?.studentId)[0].props.studentId,'ana');
  byId(tree,'admin-student-classification').props.onChange({target:{value:'Needs Support'}});tree=app.render();
  assert.equal(app.navigation.search(),'');assert.equal(findAll(tree,n=>n.props?.studentId).length,0);
});
