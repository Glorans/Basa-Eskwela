import * as supportClassification from '../src/modules/module7/services/studentSupportClassification.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from './helpers/hookRuntime.ts';
import { trendPoints, trendSegments } from '../src/modules/module7/services/trendPresentation.ts';
import * as dates from '../src/modules/module7/services/dateDisplay.ts';
import * as scores from '../src/modules/module7/services/scoreDisplay.ts';
import * as filters from '../src/modules/module7/services/analyticsFilters.ts';
import { adminSystem, metrics } from './fixtures/m7Performance.ts';
const require = createRequire(import.meta.url);
const labels = ['Overview', 'Performance Trends', 'Classroom Performance', 'Student Participation', 'Learning Support'];
function setup(file: string) {
  const runtime = createHookRuntime(require('react'));
  const calls: string[] = [], focus: string[] = [];
  const module = loadComponentModule(new URL(`../src/modules/module7/${file}`, import.meta.url), id => {
    if (id === 'react-router-dom') return { Link: 'link' };
    if (id.endsWith('studentSupportClassification')) return supportClassification;
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('.css')) return {};
    if (id.endsWith('dateDisplay')) return dates;
    if (id.endsWith('scoreDisplay')) return scores;
    if (id.endsWith('analyticsFilters')) return filters;
    if (id.endsWith('classroomService')) return { getClassroomById: async () => ({}) };
    if (id.endsWith('adminClassroomLabels')) return { loadAdminClassroomLabels: async () => [] };
    if (id.endsWith('m7Service')) return { m7Request: async (path: string) => { calls.push(path); return adminSystem; } };
    if (id.endsWith('SystemPerformanceTabs')) return { default: 'tabs', SYSTEM_PERFORMANCE_TABS: labels };
    if (id.endsWith('AnalyticsFilterBar')) return { default: 'filters' };
    if (id.endsWith('AdminAnalyticsSections')) return Object.fromEntries(['AdminMetrics', 'MetricCard', 'OverviewSection', 'PerformanceTrendsSection', 'PerformanceSections', 'ParticipationSection', 'RiskSection'].map(k => [k, k]));
    throw Error(`Unexpected import ${id}`);
  }, { URLSearchParams, document: { getElementById: (id: string) => ({ focus: () => focus.push(id) }) } });
  return { render: (props = {}) => runtime.render(module.default, props), calls, focus };
}

test('all five panels have accessible associations and switching never fetches again', async () => {
  const app = setup('AdminAnalyticsPage.tsx'); app.render(); await tick(); let tree = app.render();
  assert.deepEqual(app.calls, ['/system']);
  for (const index of [1, 2, 3, 4, 0]) {
    findAll(tree, n => n.type === 'tabs')[0].props.onChange(index); tree = app.render();
    const panels = findAll(tree, n => n.props.role === 'tabpanel');
    assert.equal(panels.length, 5);
    assert.equal(panels.filter(p => !p.props.hidden).length, 1);
    assert.equal(panels[index].props['aria-labelledby'], `system-tab-${index}`);
    assert.equal(panels[index].props.hidden, false);
  }
  assert.deepEqual(app.calls, ['/system']);
  findAll(tree, n => n.type === 'filters')[0].props.onApply({ roomId: 'room-a', startDate: '2026-11-01', endDate: '2026-11-22' });
  app.render(); await tick(); tree = app.render();
  assert.equal(app.calls.at(-1), '/system?roomId=room-a&startDate=2026-11-01&endDate=2026-11-22');
  assert.equal(findAll(tree, n => n.type === 'AdminMetrics')[0].props.data, adminSystem, 'all-time metrics retain original response');
  assert.equal(findAll(tree, n => n.type === 'OverviewSection')[0].props.data, adminSystem.details);
  findAll(tree, n => n.type === 'filters')[0].props.onApply(filters.allTime); app.render(); await tick();
  assert.equal(app.calls.at(-1), '/system');
});

test('tabs support wrapping arrow navigation, Home and End, with roving focus', () => {
  const app = setup('components/SystemPerformanceTabs.tsx');
  const changed: number[] = [];
  const tree = app.render({ value: 0, onChange: (v: number) => changed.push(v) });
  const tabs = findAll(tree, n => n.props.role === 'tab');
  assert.deepEqual(tabs.map(textOf), labels);
  assert.deepEqual(tabs.map(n => n.props.tabIndex), [0, -1, -1, -1, -1]);
  for (const [index, key] of [[0, 'ArrowLeft'], [4, 'ArrowRight'], [2, 'Home'], [1, 'End']] as const) tabs[index].props.onKeyDown({ key, preventDefault() {} });
  assert.deepEqual(changed, [4, 0, 0, 4]); assert.deepEqual(app.focus, ['system-tab-4', 'system-tab-0', 'system-tab-0', 'system-tab-4']);
});

test('draft dates do not apply until submit; invalid dates reject; Reset clears scope', () => {
  const app = setup('components/AnalyticsFilterBar.tsx'); const applied: unknown[] = [];
  const props = { rooms: [], onApply: (scope: unknown) => applied.push(scope) };
  let tree = app.render(props);
  findAll(tree, n => n.type === 'select')[0].props.onChange({ target: { value: 'custom' } }); tree = app.render(props);
  findAll(tree, n => n.type === 'input')[0].props.onChange({ target: { value: '2026-11-10' } }); tree = app.render(props);
  findAll(tree, n => n.type === 'input')[1].props.onChange({ target: { value: '2026-11-09' } }); tree = app.render(props);
  assert.equal(applied.length, 0);
  findAll(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = app.render(props);
  assert.equal(applied.length, 0); assert.match(textOf(tree), /End date must/);
  findAll(tree, n => n.type === 'input')[1].props.onChange({ target: { value: '2026-11-22' } }); tree = app.render(props);
  findAll(tree, n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(JSON.stringify(applied[0]), JSON.stringify({ roomId: '', startDate: '2026-11-10', endDate: '2026-11-22' }));
  findAll(tree, n => n.type === 'button' && n.props.type === 'button')[0].props.onClick();
  assert.equal(JSON.stringify(applied[1]), JSON.stringify(filters.allTime));
});

test('chart presentation preserves zero, missing weeks, unavailable evidence and original inputs', () => {
  const weeks = [
    { ...metrics, weekStart: '2026-11-02', pronunciationAccuracy: 0 },
    { ...metrics, weekStart: '2026-11-09', pronunciationAccuracy: null },
    { ...metrics, weekStart: '2026-11-23', invalidCompletedQuizzes: 1 },
    { ...metrics, weekStart: '2026-11-30' },
    { ...metrics, weekStart: '2026-12-14' },
  ];
  const before = JSON.stringify(weeks), points = trendPoints(weeks, 'pronunciationAccuracy');
  assert.deepEqual(points.map(p => p.value), [0, null, 86.49, 86.49, 86.49]);
  assert.deepEqual(trendSegments(points).map(s => s.length), [1, 2, 1]);
  assert.equal(trendPoints(weeks, 'comprehensionScore')[2].value, null);
  assert.deepEqual(trendPoints([], 'readingSpeedWpm'), []);
  assert.equal(JSON.stringify(weeks), before);
});

test('support search and classification combine; inline details preserve all supplied evidence', () => {
  const app = setup('components/StudentSupportTable.tsx');
  const students = ['Ana', 'Ben'].map((name, index) => ({ id: name, name, classification: index ? 'Early Warning' : 'Needs Support',
    contexts: [{ teacherId: 't', teacherName: 'Teacher One', classrooms: ['Room A'], classification: 'Needs Support', completedQuizzes: 5, latestScores: [{score: 55, completedAt: '2026-11-20T00:00:00Z'}] }],
    interventions: { total: 6, planned: 1, inProgress: 2, completed: 3 } }));
  let tree = app.render({ students });
  const button = findAll(tree, n => n.props['aria-label'] === 'View details for Ana')[0];
  assert.equal(button.props['aria-expanded'], false); button.props.onClick(); tree = app.render({ students });
  assert.equal(findAll(tree, n => n.props['aria-label'] === 'Hide details for Ana')[0].props['aria-expanded'], true);
  const detail = findAll(tree, n => n.props.id === 'support-detail-Ana')[0];
  assert.match(textOf(detail), /55%/); assert.match(textOf(detail), /5 completed quizzes/);
  assert.deepEqual(findAll(detail, n => n.type === 'dd').map(textOf), ['1', '2', '3', '6']);
  findAll(tree, n => n.type === 'input')[0].props.onChange({ target: { value: ' aNA ' } }); tree = app.render({ students });
  assert.match(textOf(tree), /1 of 2 students shown/);
  findAll(tree, n => n.type === 'select')[0].props.onChange({ target: { value: 'Early Warning' } }); tree = app.render({ students });
  assert.match(textOf(tree), /No students match/);
  findAll(tree, n => n.type === 'button' && textOf(n) === 'Clear search and status')[0].props.onClick(); tree = app.render({ students });
  assert.match(textOf(tree), /2 of 2 students shown/);
  assert.match(textOf(app.render({ students: [] })), /No students with an active warning/);
});

test('support action links encode unique IDs and retain recovery, counts and dates in compact details', () => {
  const app=setup('components/StudentSupportTable.tsx');
  const students=['a/id','b&id'].map(id=>({id,name:'Same Name',classification:'Needs Support',
    contexts:[{teacherId:'t',teacherName:'Teacher T',classrooms:['Room A','Room B'],classification:'Needs Support',recoveryCount:1,completedQuizzes:2,latestScores:[{score:75,completedAt:'2026-11-03T01:00:00Z'}]}],interventions:{total:3,planned:1,inProgress:1,completed:1}}));
  const tree=app.render({students});const links=findAll(tree,n=>n.type==='link');
  assert.deepEqual(links.map(n=>n.props.to),['/admin/student-performance?studentId=a%2Fid','/admin/student-performance?studentId=b%26id']);
  assert.ok(links.every(n=>textOf(n)==='View Student Performance'));
  assert.match(textOf(tree),/Recovery in progress: 1 of 2/);assert.match(textOf(tree),/Room A, Room B/);
  assert.match(textOf(tree),/75%/);assert.match(textOf(tree),/Nov 3, 2026/);
  assert.equal(findAll(tree,n=>n.type==='dd').length,8);
});
