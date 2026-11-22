// M7 UI redesign (Document-55): Platform Analytics, learner Progress & Results, Teacher Analytics.
// Presentation only. Saved-response fixtures and stubs; no network, database or speech service.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as dateDisplay from '../src/modules/module7/services/dateDisplay.ts';
import * as scoreDisplay from '../src/modules/module7/services/scoreDisplay.ts';
import * as suggestionSummary from '../src/modules/module7/services/suggestionSummary.ts';
import * as comprehensionNavigation from '../src/modules/module5/services/comprehensionNavigation.ts';
import * as supportClassification from '../src/modules/module7/services/studentSupportClassification.ts';
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from './helpers/hookRuntime.ts';
import { searchParamsRouter } from './helpers/searchParamsRouter.ts';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const charts = loadComponentModule(new URL('../src/modules/module7/components/M7Charts.tsx', import.meta.url), id => {
  if (id === 'react') return React;
  if (id === 'react/jsx-runtime') return require(id);
  throw new Error(`Unexpected import ${id}`);
});
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const html = (component: unknown, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(component, props));

test('bar chart: missing values read "No data", never zero; percentages use a 0–100% axis; exact values are listed', () => {
  const out = html(charts.BarChart, { title: 'Reading accuracy and comprehension', unit: '%', categories: ['Reading accuracy', 'Comprehension'],
    series: [{ label: 'Students', color: '#17483C', values: [86.49, null] }, { label: 'Independent Learners', color: '#79BD62', values: [null, 75] }] });
  assert.equal((out.match(/<rect /g) ?? []).length, 2, 'one bar per recorded value only');
  assert.equal((out.match(/>No data</g) ?? []).length, 4, 'two missing values, in the chart and in the exact-value table');
  assert.match(out, />100%</);
  assert.match(out, />86\.49%</);
  assert.doesNotMatch(out, />0%<\/text><\/g><g><rect/);
});

test('chart scale: WPM and counts use their own axis, never a shared percentage axis', () => {
  assert.equal(charts.chartMax([42, 118], 'WPM'), 125);
  assert.equal(charts.chartMax([3], 'count'), 3);
  assert.equal(charts.chartMax([99], '%'), 100);
  const out = html(charts.BarChart, { title: 'Average reading speed', unit: 'WPM', categories: ['Students', 'Independent Learners'], series: [{ label: 'Reading speed', color: '#356A91', values: [118, null] }] });
  assert.match(out, />118 WPM</);
});

test('line chart: attempts in time order; a missing value breaks the line instead of being filled in', () => {
  const points = [
    { key: 'c', time: 3, label: 'Nov 3', value: 90 }, { key: 'a', time: 1, label: 'Nov 1', value: 80 },
    { key: 'b', time: 2, label: 'Nov 2', value: null }, { key: 'd', time: 4, label: 'Nov 4', value: 95 },
  ];
  const out = html(charts.LineChart, { title: 'My reading accuracy', unit: '%', points });
  assert.equal((out.match(/<circle /g) ?? []).length, 3);
  assert.equal((out.match(/<polyline /g) ?? []).length, 1, 'only the two consecutive recorded points are joined');
  assert.ok(out.indexOf('Nov 1') < out.indexOf('Nov 4'), 'oldest first');
  assert.match(html(charts.LineChart, { title: 'Empty', unit: 'WPM', points: [], emptyText: 'No saved readings yet.' }), /No saved readings yet\./);
});

test('donut chart: each role is listed once with its exact count; the total is the sum', () => {
  const out = html(charts.DonutChart, { title: 'Registered accounts by role', totalLabel: 'accounts', segments: [
    { label: 'Students', value: 6, color: '#17483C' }, { label: 'Teachers', value: 2, color: '#FFCA59' }, { label: 'System Admins', value: 0, color: '#356A91' }] });
  assert.match(out, />8</);
  assert.equal((out.match(/<path /g) ?? []).length, 2, 'zero-count roles draw no arc but stay in the legend');
  assert.match(out, /System Admins/);
});

function loadSystemAdmin(responses: Record<string, unknown>) {
  const runtime = createHookRuntime(require('react'));
  const router = searchParamsRouter('a');
  const requests: string[] = [];
  const module = loadComponentModule(new URL('../src/modules/module7/SystemAdminAnalyticsPage.tsx', import.meta.url), id => {
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react-router-dom') return router.module;
    if (id.endsWith('.css')) return {};
    if (id.endsWith('/M7Tabs')) return { default: 'm7-tabs' };
    if (id.endsWith('/M7Charts')) return { BarChart: 'bar-chart', DonutChart: 'donut-chart', M7_COLORS: charts.M7_COLORS };
    if (id.endsWith('/PerformanceSelector')) return { default: 'selector' };
    if (id.endsWith('/M7Pages')) return { MetricsCards: 'metrics' };
    if (id.endsWith('/dateDisplay')) return dateDisplay;
    if (id.endsWith('/scoreDisplay')) return scoreDisplay;
    if (id.endsWith('/suggestionSummary')) return suggestionSummary;
    if (id.endsWith('/SuggestedInterventions')) return { SuggestedInterventions: 'suggested' };
    if (id.endsWith('/m7Service')) return { m7Request: async (path: string) => { requests.push(path); return responses[path]; } };
    throw new Error(`Unexpected import ${id}`);
  }, { URLSearchParams, document: { scrollingElement: null }, getComputedStyle: () => ({ overflowY: 'visible' }), sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  return { runtime, router, module, requests, render: () => runtime.render(module.SystemAdminOverviewPage, {}) };
}
const group = { learners: 4, withSuggestion: 2, withRepeated: 1, preliminaryOnly: 1, moreDataNeeded: 1, noData: 0, onTrack: 1, improving: 1 };
const overview = {
  generatedAt: '2026-11-23T00:00:00Z',
  users: { total: 13, systemAdmins: 1, schoolAdmins: 2, teachers: 3, approvedTeachers: 2, students: 4, independentLearners: 2, withoutRole: 1 },
  modules: { published: 5, draft: 1, archived: 2, inTrash: 1 },
  activity: { readingAttempts: 9, completedQuizzes: 7, pronunciationAccuracy: 88.123, readingSpeedWpm: 96.4, comprehensionScore: 71.5, activeLearners7Days: 3, activeLearners30Days: 5 },
  students: { readingAttempts: 6, completedQuizzes: 5, pronunciationAccuracy: 90, readingSpeedWpm: 100, comprehensionScore: 70 },
  independentLearners: { readingAttempts: 3, completedQuizzes: 2, pronunciationAccuracy: null, readingSpeedWpm: null, comprehensionScore: null },
  weeklyActivity: [{ weekStart: '2026-11-09', readings: 4, completedQuizzes: 3, activeLearners: 2 }, { weekStart: '2026-11-16', readings: 5, completedQuizzes: 4, activeLearners: 3 }],
};
const platformSuggestions = { generatedAt: '2026-11-23T00:00:00Z', students: group, independentLearners: { ...group, learners: 2, withRepeated: 0, preliminaryOnly: 0, moreDataNeeded: 1, onTrack: 1, improving: 0 },
  needs: [{ competency: 'critical', competencyName: 'Critical Comprehension', language: 'en', languageName: 'English', student: { pattern: 1, preliminary: 0 }, general_user: { pattern: 0, preliminary: 1 } }] };

test('Platform Analytics: four tabs from the two existing System Admin requests; switching never refetches', async () => {
  const app = loadSystemAdmin({ '/system-admin/overview': overview, '/system-admin/suggestions': platformSuggestions });
  app.render(); await tick(); let tree = app.render();
  assert.deepEqual(app.requests.sort(), ['/system-admin/overview', '/system-admin/suggestions']);
  const tabs = findAll(tree, n => n.type === 'm7-tabs')[0].props;
  assert.deepEqual([...tabs.tabs], ['Overview', 'Learning Performance', 'Suggested Practice', 'Weekly Activity']);
  assert.equal(tabs.value, 0);
  const text = () => JSON.stringify(tree);
  // Overview: user cards link to User Management with the existing ?section= views; the donut has every role once.
  const links = findAll(tree, n => typeof n.props?.to === 'string' && n.props?.onOpen).map((n: any) => n.props.to);
  assert.deepEqual(links, [
    '/system-admin/users?section=all&from=platform-analytics&tab=overview',
    '/system-admin/users?section=school&role=student&from=platform-analytics&tab=overview',
    '/system-admin/users?section=independent&from=platform-analytics&tab=overview',
    '/system-admin/users?section=school&role=teacher&from=platform-analytics&tab=overview',
    '/system-admin/users?section=school&role=admin&from=platform-analytics&tab=overview',
    '/system-admin/users?section=all&role=system_admin&from=platform-analytics&tab=overview',
    '/system-admin/users?section=all&from=platform-analytics&tab=overview',
  ]);
  const donut = findAll(tree, n => n.type === 'donut-chart')[0].props;
  assert.deepEqual(JSON.parse(JSON.stringify(donut.segments.map((s: any) => [s.label, s.value]))), [['Students', 4], ['Independent Learners', 2], ['Teachers', 3], ['School Admins', 2], ['System Admins', 1], ['Onboarding incomplete', 1]]);
  assert.equal(donut.segments.reduce((sum: number, s: any) => sum + s.value, 0), overview.users.total, 'no double counting');
  assert.equal(findAll(tree, n => n.props?.label === 'Teachers')[0].props.note, '2 approved');
  // Learning Performance: group selector uses the existing aggregates; null averages stay null (No data).
  tabs.onChange(1); tree = app.render();
  assert.equal(app.router.search(), 'tab=performance', 'the tab is kept in the URL for Back navigation');
  const bars = findAll(tree, n => n.type === 'bar-chart').map((n: any) => n.props);
  assert.deepEqual(plain(bars[0].series.map((s: any) => s.values)), [[90, 70], [null, null]]);
  assert.equal(bars[0].unit, '%'); assert.equal(bars[1].unit, 'WPM');
  assert.match(text(), /Active learners \(platform-wide\)/);
  findAll(tree, n => n.type === 'select')[0].props.onChange({ target: { value: 'independent' } }); tree = app.render();
  assert.match(text(), /"No data"/);
  // Suggested Practice: mutually exclusive category cards per group, collapsible breakdown and method.
  findAll(tree, n => n.type === 'm7-tabs')[0].props.onChange(2); tree = app.render();
  const practice = findAll(tree, n => n.props?.state?.data)[0];
  assert.equal(practice.props.state.data.needs[0].competencyName, 'Critical Comprehension', 'the loaded summary is passed down, not refetched');
  const source = read('modules/module7/SystemAdminAnalyticsPage.tsx');
  for (const part of ['<summary>Competency Breakdown</summary>', '<summary>How Suggested Practice Is Calculated</summary>', 'suggestionCategoryCards(group)', 'improvingNote(group.improving)']) assert.ok(source.includes(part), part);
  // Weekly: the chart and the full table use the same API rows.
  findAll(tree, n => n.type === 'm7-tabs')[0].props.onChange(3); tree = app.render();
  assert.deepEqual(plain(findAll(tree, n => n.type === 'bar-chart')[0].props.series.map((s: any) => s.values)), [[4, 5], [3, 4]]);
  assert.match(text(), /Detailed weekly records/);
  assert.equal(app.requests.length, 2, 'tab switches reuse the loaded data');
  assert.doesNotMatch(text(), /m7-ana|full_name|email/, 'aggregate only');
});

test('User Management: Back to Platform Analytics only when opened from an analytics card; role hints preselect existing filters', () => {
  const page = read('modules/module1/pages/admin/UserManagementPage.tsx');
  assert.match(page, /isSystemAdmin && fromPlatformAnalytics && \(/);
  assert.match(page, /← Back to Platform Analytics/);
  assert.match(page, /navigate\(-1\)/, 'returns through browser history (same tab and scroll)');
  assert.match(page, /navigate\(`\/system-admin\/analytics\?tab=/, 'falls back to the analytics route');
  assert.match(page, /setSchoolTab\(roleHint === "teacher" \|\| roleHint === "student" \? roleHint : "admin"\)/);
  // Loading, permissions and the account actions are untouched: still one list request and server-decided permissions.
  assert.equal((page.match(/listManagedUsers|loadUsers\(\)/g) ?? []).length >= 1, true);
});

function loadProgress(personal: unknown) {
  const runtime = createHookRuntime(require('react'));
  const module = loadComponentModule(new URL('../src/modules/module7/M7Pages.tsx', import.meta.url), id => {
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react-router-dom') return { Link: 'a' };
    if (id.endsWith('.css')) return {};
    if (id.endsWith('/comprehensionNavigation')) return comprehensionNavigation;
    if (id.endsWith('/M7Tabs')) return { default: 'm7-tabs' };
    if (id.endsWith('/M7Charts')) return { BarChart: 'bar-chart', LineChart: 'line-chart', M7_COLORS: charts.M7_COLORS };
    if (id.endsWith('/SuggestedInterventions')) return { SuggestedInterventions: 'suggested' };
    if (id.endsWith('/LearnerSuggestions')) return { LearnerSuggestions: 'learner-suggestions' };
    if (id.endsWith('/AdminAnalyticsPage')) return { default: 'admin' };
    if (id.endsWith('/dateDisplay')) return dateDisplay;
    if (id.endsWith('/scoreDisplay')) return scoreDisplay;
    if (id.endsWith('/studentSupportClassification')) return supportClassification;
    if (id.endsWith('/m7Service')) return { PERSONAL_PROGRESS_TIMEOUT_MS: 60000, m7Request: async () => personal };
    throw new Error(`Unexpected import ${id}`);
  }, { setInterval: () => 1, clearInterval: () => {}, sessionStorage: { getItem: () => null, setItem() {} }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById: () => null } });
  return (role: string) => { runtime.render(module.StudentProgressPage, { role }); return tick().then(() => runtime.render(module.StudentProgressPage, { role })); };
}
const personal = {
  summary: { readingAttempts: 2, completedQuizzes: 2, pronunciationAccuracy: 86.49, readingSpeedWpm: 100.4, comprehensionScore: 75, invalidCompletedQuizzes: 0 },
  readings: [{ id: 'r2', completed_at: '2026-11-05T02:00:00Z', pronunciation_accuracy: 90.4, reading_speed_wpm: 110.6, detected_error_count: 1 },
    { id: 'r1', completed_at: '2026-11-03T02:00:00Z', pronunciation_accuracy: 82.5, reading_speed_wpm: 90.2, detected_error_count: 3 }],
  quizzes: [{ id: 'q1', title: 'Story A', completedAt: '2026-11-03T03:00:00Z', score: 50, firstCorrect: 1, totalQuestions: 2 },
    { id: 'q2', title: 'Story B', completedAt: '2026-11-06T03:00:00Z', score: null, firstCorrect: 0, totalQuestions: 0 }],
  activities: [{ id: 'act1', status: 'Completed', roomId: 'room', materialId: 'mat', title: 'Assigned story' }, { id: 'act2', status: 'Not Started', roomId: 'room', materialId: 'mat2', title: 'Second story' }],
};

test('Progress & Results: five KPI cards, three tabs, charts from the saved attempts; IL has no classroom completion', async () => {
  for (const role of ['student', 'general_user']) {
    const tree = await loadProgress(personal)(role);
    const text = textOf(tree);
    assert.match(text, /My Progress & Results/);
    assert.deepEqual([...findAll(tree, n => n.type === 'm7-tabs')[0].props.tabs], ['Overview', 'Reading', 'Quizzes']);
    assert.equal(findAll(tree, n => n.props?.role === 'tabpanel').length, 3, 'loaded once; inactive panels are hidden, not refetched');
    const lines = findAll(tree, n => n.type === 'line-chart').map((n: any) => n.props);
    assert.deepEqual(plain(lines.map(l => l.unit)), ['%', 'WPM'], 'accuracy and speed never share an axis');
    assert.deepEqual(plain(lines[0].points.map((p: any) => [p.key, p.value])), [['r2', 90], ['r1', 83]], 'one point per saved attempt');
    const quizChart = findAll(tree, n => n.type === 'bar-chart')[0].props;
    assert.deepEqual([...quizChart.series[0].values], [50, null], 'a quiz without a score is No data, not 0%');
    if (role === 'student') {
      assert.match(text, /1 of 2 assigned reading activities completed/);
      assert.match(text, /50%/);
      assert.match(text, /View Assigned Activities/);
    } else {
      assert.doesNotMatch(text, /assigned reading activities|[Aa]ctivity progress|progressbar/);
    }
    assert.equal(findAll(tree, n => n.type === 'learner-suggestions')[0].props.expandable, true);
  }
  const none = await loadProgress({ ...personal, activities: [] })('student');
  assert.match(textOf(none), /No assigned reading activities yet\./);
  assert.doesNotMatch(textOf(none), /(^|[^0-9])0%/, 'no misleading 0% when nothing is assigned');
});

test('Practice ideas: the expandable cards keep every part of the existing recommendation', () => {
  const runtime = createHookRuntime(require('react'));
  const tip = { id: 'fil:word_recognition', competency: 'word_recognition', language: 'fil', languageName: 'Filipino', title: 'Pantig practice',
    steps: ['Basahin ang bawat pantig.', 'Pagsamahin ang mga pantig.'], basedOn: 'Some words were read differently.', note: 'Keep practising.', words: ['bahay', 'paaralan'] };
  const module = loadComponentModule(new URL('../src/modules/module7/components/LearnerSuggestions.tsx', import.meta.url), id => {
    if (id === 'react') return runtime.react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('.css')) return {};
    if (id.endsWith('/m7Service')) return { PERSONAL_PROGRESS_TIMEOUT_MS: 1, m7Request: async () => ({ hasAnyData: true, moreDataNeeded: false, tips: [tip], improving: [] }) };
    throw new Error(`Unexpected import ${id}`);
  });
  // A static render shows the heading and loading state; both card styles render the one shared TipBody below.
  assert.match(renderToStaticMarkup(React.createElement(module.LearnerSuggestions, { expandable: true })), /Practice ideas for you/);
  const source = read('modules/module7/components/LearnerSuggestions.tsx');
  assert.match(source, /<details className="m7r-tip"/);
  assert.match(source, /<TipBody tip=\{tip\} \/>/);
  for (const part of ['tip.basedOn', 'tip.steps.map', 'Words to practise', 'tip.words.map', 'tip.note']) assert.ok(source.includes(part), part);
});

test('Safety: the redesign adds no new API paths and no write requests to the redesigned pages', () => {
  for (const file of ['modules/module7/SystemAdminAnalyticsPage.tsx', 'modules/module7/TeacherAnalyticsPage.tsx', 'modules/module7/components/M7Charts.tsx', 'modules/module7/components/M7Tabs.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /'(POST|PATCH|PUT|DELETE)'|supabase|\.insert\(|\.upsert\(|\.rpc\(/, file);
  }
  const progress = read('modules/module7/M7Pages.tsx');
  const learner = progress.slice(progress.indexOf('function LearnerKpis'), progress.indexOf('export { default as AdminAnalyticsPage }'));
  assert.deepEqual([...learner.matchAll(/useData<[^>]+>\('([^']+)'/g)].map(m => m[1]), ['/personal']);
});

test('chart labels wrap to two lines and never lose the full text', () => {
  assert.deepEqual([...charts.wrapLabel('Preliminary observations only', 14)], ['Preliminary', 'observations…']);
  assert.deepEqual([...charts.wrapLabel('On track', 14)], ['On track']);
  assert.match(html(charts.BarChart, { title: 't', unit: 'count', categories: ['More data needed or no results yet'], series: [{ label: 's', color: '#000', values: [1] }] }), /<title>More data needed or no results yet<\/title>/);
});
