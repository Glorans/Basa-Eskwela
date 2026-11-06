import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHookRuntime, findAll, loadComponentModule, tick } from './helpers/hookRuntime.ts';
import * as fixtures from './fixtures/m7Performance.ts';
import * as filters from '../src/modules/module7/services/analyticsFilters.ts';
import * as score from '../src/modules/module7/services/scoreDisplay.ts';
import * as dates from '../src/modules/module7/services/dateDisplay.ts';
import * as source from '../src/modules/module7/services/assessmentSource.ts';
import * as risk from '../src/modules/module7/services/studentSupportClassification.ts';
const require = createRequire(import.meta.url);

function setup(file: string, overrides: Record<string, any> = {}) {
  const runtime = createHookRuntime(require('react'));
  const calls: string[] = [];
  const response = async (name: string, value: any) => { calls.push(name); if (overrides[name] instanceof Error) throw overrides[name]; return overrides[name] ?? value; };
  const module = loadComponentModule(new URL(`../src/modules/module7/${file}`, import.meta.url), id => {
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'lucide-react') return new Proxy({}, { get: (_, name) => String(name) });
    if (id.endsWith('.css')) return {};
    if (id.endsWith('analyticsFilters')) return filters;
    if (id.endsWith('scoreDisplay')) return score;
    if (id.endsWith('dateDisplay')) return dates;
    if (id.endsWith('assessmentSource.ts')) return source;
    if (id.endsWith('studentSupportClassification')) return risk;
    if (id.endsWith('PerformanceSelector')) return { default: 'selector' };
    if (id.endsWith('PerformanceTabs')) return { default: 'performance-tabs' };
    if (id.endsWith('AnalyticsFilterBar')) return { default: 'global-filters' };
    if (id.endsWith('WeeklyReportSection')) return { default: 'weekly-reports' };
    if (id.endsWith('M7Pages')) return { RiskGuidance: 'risk-guidance', MetricsCards: 'metrics', NotCountedQuizzes: 'historical-quizzes', InterventionForm: 'intervention-form' };
    if (id.endsWith('teacherQuizService')) return { getTeacherQuizAttempts: () => response('teacher-quizzes', []) };
    if (id.endsWith('teacherAnalyticsService')) return {
      getTeacherAnalytics: () => response('teacher-analytics', fixtures.teacherAnalytics),
      getTeacherCompletionAnalytics: () => response('teacher-completion', fixtures.teacherCompletion),
    };
    if (id.endsWith('classPerformanceService')) return { getClassPerformance: () => response('class-performance', fixtures.classPerformance) };
    if (id.endsWith('studentPerformanceService')) return { getStudentPerformance: () => response('student-performance', fixtures.studentPerformance) };
    if (id.endsWith('quizScoreService')) return { getQuizScores: () => response('quiz-scores', fixtures.quizzes) };
    if (id.endsWith('classroomService')) return { getRoomEnrollments: (id: string) => response(`enrollment:${id}`, (fixtures.memberships[id] ?? []).map(student_id => ({ student_id }))) };
    if (id.endsWith('m7Service')) return { m7Request: (path: string) => response(path, path === '/system' ? fixtures.adminSystem : fixtures.adminStudents) };
    throw Error(`Unexpected import ${id}`);
  }, { Error });
  const render = (props = {}) => runtime.render(module.default ?? module.PerformanceSections, props);
  return { ...runtime, module, render, calls };
}
const byId = (tree: any, id: string) => findAll(tree, node => node.props?.id === id)[0];
const selectors = (tree: any, id: string) => byId(tree, id).props;
const text = (tree: any) => JSON.stringify(tree);

test('Teacher class and student selections keep one dashboard, IDs, metrics and snapshot scope', async () => {
  const app = setup('TeacherAnalyticsPage.tsx');
  app.render(); await tick(); let tree = app.render();
  const initialCalls = [...app.calls];
  assert.equal(selectors(tree, 'teacher-classroom').value, 'room-a');
  selectors(tree, 'teacher-classroom').onChange('room-b'); tree = app.render();
  assert.equal(selectors(tree, 'teacher-classroom').value, 'room-b');
  const classPanel = byId(tree, 'performance-panel-0');
  assert.equal(findAll(classPanel, node => node.key === 'room-b').length, 1);
  assert.equal(findAll(classPanel, node => node.key === 'room-a').length, 0);
  findAll(tree, node => node.type === 'performance-tabs')[0].props.onChange(1); tree = app.render();
  assert.equal(byId(tree, 'performance-panel-0').props.hidden, true);
  assert.equal(byId(tree, 'performance-panel-1').props.hidden, false);
  const before = text(findAll(byId(tree, 'performance-panel-1'), node => node.key === 'ana'));
  selectors(tree, 'teacher-student-classroom').onChange('room-b'); tree = app.render();
  assert.equal(text(findAll(byId(tree, 'performance-panel-1'), node => node.key === 'ana')), before, 'multi-room student metrics and all room progress stay identical');
  selectors(tree, 'teacher-student').onChange('ben'); tree = app.render();
  assert.equal(findAll(byId(tree, 'performance-panel-1'), node => node.key === 'ana').length, 0);
  assert.equal(findAll(byId(tree, 'performance-panel-1'), node => node.key === 'ben').length, 1);
  selectors(tree, 'teacher-student-classroom').onChange('room-a'); tree = app.render();
  assert.equal(selectors(tree, 'teacher-student').value, 'ana', 'unavailable selection falls back to an available student');
  selectors(tree, 'teacher-student-classroom').onChange('room-empty'); tree = app.render();
  assert.equal(selectors(tree, 'teacher-student').options.length, 0);
  assert.match(text(tree), /No students in this classroom/);
  assert.deepEqual(app.calls, initialCalls, 'local navigation never refetches or recalculates');
  assert.doesNotMatch(text(tree), /The student list follows|teacher-student-scope/);
});

test('Teacher global classroom filter supplies equivalent controls without duplicate local filters', async () => {
  const app = setup('TeacherAnalyticsPage.tsx'); app.render(); await tick(); let tree = app.render();
  findAll(tree, node => node.type === 'global-filters')[0].props.onApply({ ...filters.allTime, roomId: 'room-a' });
  app.render(); await tick(); tree = app.render();
  assert.equal(byId(tree, 'teacher-student-classroom'), undefined);
  assert.equal(byId(tree, 'teacher-classroom'), undefined);
  assert.deepEqual(selectors(tree, 'teacher-student').options.map((s: any) => s.id), ['ana']);
});

test('Teacher handles loading, failed requests, no classrooms and no students', async () => {
  const app = setup('TeacherAnalyticsPage.tsx', { 'class-performance': { ...fixtures.classPerformance, classrooms: [] }, 'student-performance': { totalStudents: 0, students: [] } });
  assert.match(text(app.render()), /Loading/); await tick();
  assert.match(text(app.render()), /No classrooms found/); assert.match(text(app.render()), /No enrolled students yet/);
  const failed = setup('TeacherAnalyticsPage.tsx', { 'class-performance': Error('Class fixture failed'), 'student-performance': Error('Student fixture failed') });
  failed.render(); await tick(); const tree = failed.render();
  assert.match(text(tree), /Class fixture failed/); assert.match(text(tree), /Student fixture failed/);
});

test('Admin classroom selection keeps comparison rows and system performance intact', () => {
  const app = setup('components/AdminAnalyticsSections.tsx');
  let tree = app.render({ data: fixtures.adminSystem.details });
  const tableBefore = text(findAll(tree, node => node.type === 'table'));
  selectors(tree, 'admin-classroom').onChange('room-b'); tree = app.render({ data: fixtures.adminSystem.details });
  assert.equal(text(findAll(tree, node => node.type === 'table')), tableBefore);
  const detail = findAll(tree, node => node.props?.['aria-labelledby'] === 'admin-classroom-detail')[0];
  assert.equal(findAll(detail, node => node.props?.data)[0].props.data, fixtures.adminSystem.details.classroomComparisons[1]);
  tree = app.render({ data: { ...fixtures.adminSystem.details, filters: { roomId: 'room-a' }, classroomComparisons: fixtures.adminSystem.details.classroomComparisons.slice(0, 1) } });
  assert.equal(byId(tree, 'admin-classroom'), undefined);
  assert.equal(findAll(tree, node => node.props?.['aria-labelledby'] === 'admin-classroom-detail').length, 1);
});

test('Admin filters by classroom ID, excludes unrelated accounts, and preserves full student data', async () => {
  const app = setup('AdminStudentPerformancePage.tsx'); app.render(); await tick(); let tree = app.render();
  assert.equal(selectors(tree, 'admin-student').options.length, 3, 'unenrolled Student accounts remain accessible');
  selectors(tree, 'admin-student').onChange('ana'); tree = app.render();
  const before = text(findAll(tree, node => node.type === 'tbody'));
  selectors(tree, 'admin-student-classroom').onChange('room-b'); app.render(); await tick(); tree = app.render();
  assert.deepEqual(selectors(tree, 'admin-student').options.map((s: any) => s.id), ['ana', 'ben']);
  assert.equal(selectors(tree, 'admin-student').value, '');
  selectors(tree, 'admin-student').onChange('ana'); tree = app.render();
  assert.equal(text(findAll(tree, node => node.type === 'tbody')), before);
  assert.equal(findAll(tree, node => node.props?.studentId === 'ana').length, 1);
  selectors(tree, 'admin-student').onChange('ben'); tree = app.render();
  assert.equal(findAll(tree, node => node.props?.studentId === 'ana').length, 0);
  assert.equal(findAll(tree, node => node.props?.studentId === 'ben').length, 1);
  selectors(tree, 'admin-student-classroom').onChange('room-a'); app.render(); await tick(); tree = app.render();
  assert.deepEqual(selectors(tree, 'admin-student').options.map((s: any) => s.id), ['ana']);
  selectors(tree, 'admin-student-classroom').onChange('room-empty'); app.render(); await tick(); tree = app.render();
  assert.match(text(tree), /No students match these filters/);
  assert.deepEqual(app.calls, ['/system', '/admin/students', 'enrollment:room-b', 'enrollment:room-a', 'enrollment:room-empty']);
});

test('Admin enrollment failure does not show stale student detail and All Classrooms recovers', async () => {
  const app = setup('AdminStudentPerformancePage.tsx', { 'enrollment:room-a': Error('Enrollment unavailable') });
  app.render(); await tick(); let tree = app.render();
  selectors(tree, 'admin-student').onChange('ana'); tree = app.render();
  selectors(tree, 'admin-student-classroom').onChange('room-a'); app.render(); await tick(); tree = app.render();
  assert.match(text(tree), /Enrollment unavailable/);
  assert.equal(findAll(tree, node => node.props?.studentId).length, 0);
  selectors(tree, 'admin-student-classroom').onChange(''); app.render(); await tick(); tree = app.render();
  assert.equal(selectors(tree, 'admin-student').options.length, 3);
});

test('Selector distinguishes identical names using IDs and supplies native accessible controls', () => {
  const app = setup('components/PerformanceSelector.tsx');
  const changes: string[] = [];
  const tree = app.render({ id: 'room', label: 'Select Classroom', value: 'room-b', options: fixtures.rooms, onChange: (id: string) => changes.push(id) });
  assert.equal(tree.props.htmlFor, 'room');
  const select = byId(tree, 'room'); assert.equal(select.props.value, 'room-b');
  const options = findAll(tree, node => node.type === 'option');
  assert.match(text(options[0]), /room-a/); assert.match(text(options[1]), /room-b/);
  select.props.onChange({ target: { value: 'room-a' } }); assert.deepEqual(changes, ['room-a']);
});

test('Admin classroom and classification filters combine without losing access to other students', async () => {
  const app = setup('AdminStudentPerformancePage.tsx'); app.render(); await tick(); let tree = app.render();
  selectors(tree, 'admin-student-classroom').onChange('room-b'); app.render(); await tick(); tree = app.render();
  const filter = () => findAll(tree, node => node.type === 'select')[0];
  filter().props.onChange({ target: { value: 'active' } }); tree = app.render();
  assert.deepEqual(selectors(tree, 'admin-student').options.map((s: any) => s.id), ['ana']);
  filter().props.onChange({ target: { value: 'none' } }); tree = app.render();
  assert.deepEqual(selectors(tree, 'admin-student').options.map((s: any) => s.id), ['ben']);
  selectors(tree, 'admin-student-classroom').onChange(''); app.render(); await tick(); tree = app.render();
  assert.deepEqual(selectors(tree, 'admin-student').options.map((s: any) => s.id), ['ben', 'not-enrolled']);
  filter().props.onChange({ target: { value: 'all' } }); tree = app.render();
  assert.equal(selectors(tree, 'admin-student').options.length, 3);
});

test('Admin ignores a late enrollment response after switching classrooms', async () => {
  let finishA!: (rows: any[]) => void, finishB!: (rows: any[]) => void;
  const app = setup('AdminStudentPerformancePage.tsx', {
    'enrollment:room-a': new Promise(resolve => { finishA = resolve; }),
    'enrollment:room-b': new Promise(resolve => { finishB = resolve; }),
  });
  app.render(); await tick(); let tree = app.render();
  selectors(tree, 'admin-student-classroom').onChange('room-a'); tree = app.render();
  assert.match(text(tree), /Loading classroom students/);
  selectors(tree, 'admin-student-classroom').onChange('room-b'); app.render();
  finishB([{ student_id: 'ben' }]); await tick(); tree = app.render();
  assert.deepEqual(selectors(tree, 'admin-student').options.map((s: any) => s.id), ['ben']);
  finishA([{ student_id: 'ana' }]); await tick(); tree = app.render();
  assert.deepEqual(selectors(tree, 'admin-student').options.map((s: any) => s.id), ['ben']);
});
