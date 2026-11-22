import { searchParamsRouter } from './helpers/searchParamsRouter.ts';
import * as studentRequests from '../src/modules/module7/services/studentPerformanceRequests.ts';
import * as adminLabels from '../src/modules/module7/services/adminClassroomLabels.ts';
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
import * as active from '../src/modules/module7/services/activeClassrooms.ts';
const require = createRequire(import.meta.url);
// Active rooms and the learners currently enrolled in them, from the saved fixture memberships.
const activeScope = (rooms: { id: string; name: string }[]) => ({
  rooms, roomIds: new Set(rooms.map(room => room.id)),
  studentIds: new Set(rooms.flatMap(room => fixtures.memberships[room.id] ?? [])),
});

function setup(file: string, overrides: Record<string, any> = {}) {
  const runtime = createHookRuntime(require('react'));
  const navigation = searchParamsRouter("link");
  const calls: string[] = [];
  const scopes: any[] = [];
  const response = async (name: string, value: any) => { calls.push(name); if (overrides[name] instanceof Error) throw overrides[name]; return overrides[name] ?? value; };
  const module = loadComponentModule(new URL(`../src/modules/module7/${file}`, import.meta.url), id => {
    if (id.endsWith('/adminClassroomLabels')) return adminLabels;
    if (id.endsWith('/useAuth')) return { useAuth: () => ({user:{id:'admin'},profile:{id:'admin',role:'admin'},loading:false,profileError:false}) };
    if (id.endsWith('/studentPerformanceRequests')) return studentRequests;
    if (id.endsWith('/StudentCombobox')) return { default: 'selector' };
    if (id.endsWith('/StudentReadingChart')) return { default: 'reading-chart' };
    if (id === 'lucide-react') return { Search: 'search-icon' };
    if (id === 'react') return runtime.react;
    if (id === 'react-router-dom') return navigation.module;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'lucide-react') return new Proxy({}, { get: (_, name) => String(name) });
    if (id.endsWith('.css')) return {};
    if (id.endsWith('/SuggestedInterventions')) return { SuggestedInterventions: 'suggested-interventions' };
    if (id.endsWith('/M7Tabs')) return { default: 'm7-tabs' };
    if (id.endsWith('/M7Charts')) return { BarChart: 'bar-chart', LineChart: 'line-chart', DonutChart: 'donut-chart', M7_COLORS: { forest: '#17483C', green: '#79BD62', yellow: '#FFCA59', coral: '#F46F62', muted: '#54736A', soft: '#B9D8AE', blue: '#356A91' } };
    if (id.endsWith('/LearnerSuggestions')) return { LearnerSuggestions: 'learner-suggestions' };
    if (id.endsWith('analyticsFilters')) return filters;
    if (id.endsWith('scoreDisplay')) return score;
    if (id.endsWith('dateDisplay')) return dates;
    if (id.endsWith('assessmentSource.ts')) return source;
    if (id.endsWith('studentSupportClassification')) return risk;
    if (id.endsWith('PerformanceTrendCharts')) return { default: 'trend-charts' };
    if (id.endsWith('StudentSupportTable')) return { default: 'support-table' };
    if (id.endsWith('PerformanceSelector')) return { default: 'selector' };
    if (id.endsWith('PerformanceTabs')) return { default: 'performance-tabs' };
    if (id.endsWith('AnalyticsFilterBar')) return { default: 'global-filters' };
    if (id.endsWith('TeacherAnalyticsOverview')) return { default: 'teacher-overview' };
    if (id.endsWith('WeeklyReportSection')) return { default: 'weekly-reports' };
    if (id.endsWith('M7Pages')) return { RiskGuidance: 'risk-guidance', MetricsCards: 'metrics', NotCountedQuizzes: 'historical-quizzes', InterventionForm: 'intervention-form' };
    if (id.endsWith('teacherQuizService')) return { getTeacherQuizAttempts: () => response('teacher-quizzes', []) };
    if (id.endsWith('activeClassrooms.ts')) return active;
    if (id.endsWith('teacherAnalyticsService')) return {
      getActiveClassroomScope: () => response('active-classrooms', activeScope(fixtures.rooms)),
      getTeacherAnalytics: (_quizzes: unknown, scope: unknown) => { scopes.push(scope); return response('teacher-analytics', fixtures.teacherAnalytics); },
      getTeacherCompletionAnalytics: () => response('teacher-completion', fixtures.teacherCompletion),
    };
    if (id.endsWith('classPerformanceService')) return { getClassPerformance: () => response('class-performance', fixtures.classPerformance) };
    if (id.endsWith('studentPerformanceService')) return { getStudentPerformance: () => response('student-performance', fixtures.studentPerformance) };
    if (id.endsWith('quizScoreService')) return { getQuizScores: () => response('quiz-scores', fixtures.quizzes) };
    if (id.endsWith('classroomService')) return { getClassroomById: async (id: string) => ({id,room_code:id === 'room-a' ? 'ABC123' : 'XYZ789'}), getRoomEnrollments: (id: string) => response(`enrollment:${id}`, (fixtures.memberships[id] ?? []).map(student_id => ({ student_id }))) };
    if (id.endsWith('m7Service')) return { m7Request: (path: string) => response(path, path === '/system' ? fixtures.adminSystem : fixtures.adminStudents) };
    throw Error(`Unexpected import ${id}`);
  }, { Error, URLSearchParams, requestAnimationFrame: (callback: () => void) => callback(), document: { getElementById: () => null } });
  const render = (props = {}) => runtime.render(module.StudentPerformanceWorkspace ?? module.default ?? module.PerformanceSections, props);
  return { ...runtime, module, render, calls, scopes };
}
const byId = (tree: any, id: string) => findAll(tree, node => node.props?.id === id)[0];
const selectors = (tree: any, id: string) => byId(tree, id).props;
const text = (tree: any) => JSON.stringify(tree);

test('Teacher function navigation mounts only one dashboard and preserves refresh', async () => {
  const app = setup('TeacherAnalyticsPage.tsx'); app.render(); await tick(); let tree = app.render();
  assert.equal(findAll(tree, n => n.props.role === 'tabpanel').length, 1);
  assert.ok(byId(tree, 'analytics-panel-0'));
  assert.equal(findAll(tree, n => n.type === 'weekly-reports').length, 0);
  const calls = [...app.calls];
  for (const index of [1, 2, 0]) {
    byId(tree, `analytics-tab-${index}`).props.onClick(); tree = app.render();
    assert.equal(findAll(tree, n => n.props.role === 'tabpanel').length, 1);
    assert.ok(byId(tree, `analytics-panel-${index}`));
  }
  assert.deepEqual(app.calls, calls);
  const refresh = findAll(tree, n => n.props['aria-label'] === 'Refresh analytics')[0];
  assert.equal(refresh.props.title, 'Refresh analytics'); refresh.props.onClick();
  assert.equal(findAll(app.render(), n => n.props['aria-label'] === 'Refresh analytics')[0].props.disabled, true);
  await tick(); assert.ok(app.calls.length > calls.length);
});

test('Teacher chooses a student from one searchable dropdown; nothing is selected automatically', async () => {
  const app = setup('TeacherAnalyticsPage.tsx'); app.render(); await tick(); let tree = app.render();
  byId(tree, 'analytics-tab-1').props.onClick(); tree = app.render();
  assert.equal(findAll(tree, n => n.type === 'input').length, 0, 'the separate Find a student field is gone');
  assert.equal(selectors(tree, 'teacher-student').value, '', 'no automatic selection');
  assert.equal(selectors(tree, 'teacher-student').placeholder, 'Type a name or choose a student...');
  assert.match(text(tree), /Choose a student from the dropdown to view their performance\./);
  assert.deepEqual(selectors(tree, 'teacher-student').options.map((s: any) => [s.id, s.name, s.detail]), [['ana', 'Ana', 'Grade 5, Grade 5'], ['ben', 'Ben', 'Grade 5']],
    'unique IDs select; classroom names tell same-name students apart');
  selectors(tree, 'teacher-student').onChange('ben'); tree = app.render();
  assert.equal(selectors(tree, 'teacher-student').value, 'ben');
  assert.match(text(tree), /No results yet/);
  assert.match(text(tree), /Reading Speed/);
  findAll(tree, n => n.props['aria-label'] === 'View progress for Ben')[0].props.onClick(); tree = app.render();
  assert.ok(byId(tree, 'student-progress-details'));
  assert.match(text(tree), /No completed assessments/);
  selectors(tree, 'teacher-student').onChange(''); tree = app.render();
  assert.equal(byId(tree, 'student-progress-details'), undefined, 'Clear removes the selection and its details');
  // A classroom filter that leaves the selected student out of scope clears the selection.
  selectors(tree, 'teacher-student').onChange('ben'); tree = app.render();
  findAll(tree, n => n.type === 'global-filters')[0].props.onApply({ ...filters.allTime, roomId: 'room-a' });
  app.render(); await tick(); app.render(); await tick(); tree = app.render();
  assert.equal(selectors(tree, 'teacher-student').value, '');
  assert.deepEqual(selectors(tree, 'teacher-student').options.map((s: any) => s.id), ['ana']);
});

test('Teacher applies classroom scope and distinguishes failed and empty results', async () => {
  const app = setup('TeacherAnalyticsPage.tsx'); app.render(); await tick(); let tree = app.render();
  findAll(tree, n => n.type === 'global-filters')[0].props.onApply({...filters.allTime, roomId:'room-a'});
  app.render(); await tick(); tree = app.render(); byId(tree, 'analytics-tab-1').props.onClick(); tree = app.render();
  assert.deepEqual(selectors(tree, 'teacher-student').options.map((s:any) => s.id), ['ana']);
  const failed = setup('TeacherAnalyticsPage.tsx', {'teacher-analytics':Error('Analytics unavailable')});
  assert.match(text(failed.render()), /Loading/); await tick();
  assert.match(text(failed.render()), /Analytics unavailable/);
  const empty = setup('TeacherAnalyticsPage.tsx', {'class-performance':{...fixtures.classPerformance,totalClassrooms:0,classrooms:[]}});
  empty.render(); await tick(); assert.match(text(empty.render()), /No classrooms found/);
});

test('Teacher Analytics lists active classrooms only and totals completion from them', async () => {
  const app = setup('TeacherAnalyticsPage.tsx', {'active-classrooms':activeScope(fixtures.rooms.slice(0, 2))});
  app.render(); await tick(); const tree = app.render();
  const bar = findAll(tree, n => n.type === 'global-filters')[0].props;
  assert.deepEqual(bar.rooms.map((room: any) => room.id), ['room-a', 'room-b']);
  assert.equal(bar.resetMissingRoom, true);
  const rows = findAll(tree, n => n.props?.['aria-label'] === 'Completion by Classroom')[0];
  assert.equal(findAll(rows, n => n.props?.room && n.props?.onToggle).length, 2);
  assert.doesNotMatch(text(tree), /Empty classroom/);
  assert.match(text(tree), /4 of 8/, 'completion totals are recomputed from active rooms only');
});

test('A selected classroom that is archived falls back to All Classrooms and keeps the period', async () => {
  const app = setup('TeacherAnalyticsPage.tsx', {'active-classrooms':activeScope(fixtures.rooms.slice(0, 2))});
  app.render(); await tick(); let tree = app.render();
  const period = { startDate: '2026-11-02', endDate: '2026-11-08' };
  findAll(tree, n => n.type === 'global-filters')[0].props.onApply({ roomId: 'room-empty', ...period });
  app.render(); await tick(); app.render(); await tick(); tree = app.render();
  assert.match(text(tree), /selected classroom has been archived, so All Classrooms is shown/);
  assert.doesNotMatch(text(tree), /Loading analytics/);
  assert.equal(JSON.stringify(app.scopes.at(-1)), JSON.stringify({ roomId: '', ...period }), 'period is kept');
  byId(tree, 'analytics-tab-1').props.onClick(); tree = app.render();
  assert.deepEqual(selectors(tree, 'teacher-student').options.map((s: any) => s.id), ['ana', 'ben'], 'All Classrooms student list');
});

test('No active classrooms shows an empty state instead of archived results', async () => {
  const app = setup('TeacherAnalyticsPage.tsx', {'active-classrooms':activeScope([])});
  app.render(); await tick(); const tree = app.render();
  assert.match(text(tree), /No active classrooms/);
  const link = findAll(tree, n => n.type === 'link')[0];
  assert.equal(link.props.to, '/m3/teacher/archived-classrooms');
  assert.doesNotMatch(text(tree), /Enrolled Students|Activity Completion|Class Average/);
  assert.deepEqual(findAll(tree, n => n.type === 'global-filters')[0].props.rooms, []);
});

test('Admin classroom selection keeps comparison rows and system performance intact', async () => {
  const labels = await adminLabels.loadAdminClassroomLabels(fixtures.adminSystem.details as any, async id => ({id,room_code:id === 'room-a' ? 'ABC123':'XYZ789'}));
  const app = setup('components/AdminAnalyticsSections.tsx');
  let tree = app.render({ data: fixtures.adminSystem.details, labels });
  assert.deepEqual(selectors(tree, 'admin-classroom').options.slice(0,2).map((room:any)=>room.name), ['Grade 5 \u2014 Teacher T \u00b7 Room ABC123','Grade 5 \u2014 Teacher T \u00b7 Room XYZ789']);
  assert.equal(selectors(tree, 'admin-classroom').value, 'room-a');
  const tableBefore = text(findAll(tree, node => node.type === 'table'));
  selectors(tree, 'admin-classroom').onChange('room-b'); tree = app.render({ data: fixtures.adminSystem.details, labels });
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

test('Completion by Classroom sorts for display only and lists classrooms without activities last', () => {
  const app = setup('TeacherAnalyticsPage.tsx');
  const row = (roomId: string, roomName: string, total: number, done: number) => ({ roomId, roomName, totalAssignments: total, completedAssignments: done,
    inProgressAssignments: 0, notStartedAssignments: total - done, incompleteAssignments: total - done, completionRate: total ? Math.round(done / total * 10000) / 100 : null });
  const rows = [row('r1', 'Grade-5', 4, 4), row('r2', 'Grade-5', 4, 1), row('r3', 'Alpha', 0, 0), row('r4', 'Beta', 3, 2)];
  const ids = (sort: string) => Array.from(app.module.sortClassroomRows(rows, sort), (r: any) => String(r.roomId));
  assert.deepEqual(ids('lowest'), ['r2', 'r4', 'r1', 'r3']);
  assert.deepEqual(ids('highest'), ['r1', 'r4', 'r2', 'r3']);
  assert.deepEqual(ids('name'), ['r3', 'r4', 'r1', 'r2']);
  assert.deepEqual(rows.map(r => r.roomId), ['r1', 'r2', 'r3', 'r4'], 'the loaded data is not reordered');
});
