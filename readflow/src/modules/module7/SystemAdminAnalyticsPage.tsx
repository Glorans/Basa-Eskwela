import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import PerformanceSelector from './components/PerformanceSelector';
import M7Tabs from './components/M7Tabs';
import { BarChart, DonutChart, M7_COLORS } from './components/M7Charts';
import { MetricsCards } from './M7Pages';
import { formatAnalyticsDate as displayDate, formatAnalyticsDateTime as date } from './services/dateDisplay';
import { formatComprehension, formatQuizScore, formatScore } from './services/scoreDisplay';
import { m7Request, type IndependentLearnerDetail, type IndependentLearnerRow, type Metrics, type PlatformOverview, type PlatformSuggestionSummary } from './services/m7Service';
import { SuggestedInterventions } from './components/SuggestedInterventions';
import { improvingNote, suggestionCategoryCards } from './services/suggestionSummary';
import './components/suggestedInterventions.css';
import './m7.css';
import './m7Dashboard.css';
import './m7Redesign.css';

const percent = (value: number | null) => value === null ? 'No data' : formatScore(Math.round(value * 100) / 100);
const wpm = (value: number | null) => value === null ? 'No data' : `${Math.round(value)} WPM`;
const TYPE_LABELS: Record<string, string> = { literal: 'Literal', inferential: 'Inferential', critical: 'Critical' };

/** Loads one System Admin analytics endpoint, with Retry. Every value comes from the System Admin-only API. */
function useSystemAdminData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) { setData(null); return; }
    let active = true;
    setLoading(true); setError(''); setData(null);
    m7Request<T>(path).then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load analytics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, revision]);
  return { data, error, loading, retry: () => setRevision(v => v + 1) };
}

function Status({ loading, error, retry, what }: { loading: boolean; error: string; retry: () => void; what: string }) {
  return <>
    {loading && <p role="status">Loading {what}…</p>}
    {error && <div role="alert" className="m7-error">{error} <button type="button" onClick={retry}>Retry</button></div>}
  </>;
}

function Cards({ items }: { items: [string, string | number][] }) {
  return <div className="m7-metrics">{items.map(([label, value]) =>
    <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

/** Platform Analytics tabs. The selected tab lives in the URL (?tab=), so Back from User Management restores it. */
const PLATFORM_TABS = [['overview', 'Overview'], ['performance', 'Learning Performance'], ['practice', 'Suggested Practice'], ['weekly', 'Weekly Activity']] as const;
type LearnerGroup = 'all' | 'students' | 'independent';
const GROUP_LABELS: Record<LearnerGroup, string> = { all: 'All Learners', students: 'Students', independent: 'Independent Learners' };
/** Where each Registered Users card opens User Management (existing ?section= views; ?role= preselects a tab or filter). */
export function userManagementLink(kind: 'all' | 'students' | 'independent' | 'teachers' | 'schoolAdmins' | 'systemAdmins' | 'withoutRole', tab: string): string {
  const target: Record<typeof kind, string> = { all: 'section=all', students: 'section=school&role=student', independent: 'section=independent',
    teachers: 'section=school&role=teacher', schoolAdmins: 'section=school&role=admin', systemAdmins: 'section=all&role=system_admin', withoutRole: 'section=all' };
  return `/system-admin/users?${target[kind]}&from=platform-analytics&tab=${encodeURIComponent(tab)}`;
}
/** The element that actually scrolls the page (the app scrolls inside its layout, or the window). */
function scroller(from: Element | null): Element | null {
  for (let el = from?.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return document.scrollingElement;
}
const SCROLL_KEY = 'm7-platform-analytics-scroll';

function KpiLink({ to, label, value, note, onOpen }: { to: string; label: string; value: string | number; note?: string; onOpen: () => void }) {
  return <Link className="m7r-kpi" to={to} state={{ fromPlatformAnalytics: true }} onClick={onOpen} aria-label={`${label}: ${value}${note ? `, ${note}` : ''}. Open in User Management`}>
    <span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}<small className="m7r-kpi-link">View in User Management →</small></Link>;
}
function Kpis({ items }: { items: [string, string | number, string?][] }) {
  return <div className="m7r-kpis">{items.map(([label, value, note]) => <div className="m7r-kpi" key={label}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>)}</div>;
}
const metricKpis = (m: Metrics): [string, string | number][] => [['Saved readings', m.readingAttempts], ['Completed quizzes', m.completedQuizzes],
  ['Average comprehension', formatComprehension(m)], ['Average reading accuracy', percent(m.pronunciationAccuracy)], ['Average reading speed', wpm(m.readingSpeedWpm)]];
/** Display rounding only (two decimals), the same rounding as the cards; the API values themselves are unchanged. */
const chartValue = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;

/**
 * System Admin: View System-wide Performance Dashboard (Appendix N M7 F2). Platform totals and averages only:
 * no names, accounts or per-learner rows. Learner activity counts Students and Independent Learners.
 */
export function SystemAdminOverviewPage() {
  const overview = useSystemAdminData<PlatformOverview>('/system-admin/overview');
  const suggestions = useSystemAdminData<PlatformSuggestionSummary>('/system-admin/suggestions');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const tabIndex = Math.max(0, PLATFORM_TABS.findIndex(([key]) => key === params.get('tab')));
  const tabKey = PLATFORM_TABS[tabIndex][0];
  const [group, setGroup] = useState<LearnerGroup>('all');
  const data = overview.data;
  // Returning from User Management (browser Back or the Back button): put the page back where it was.
  useEffect(() => {
    if (!data) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
      if (saved && saved.key === location.key) { const el = scroller(mainRef.current); if (el) el.scrollTop = saved.top; }
      if (saved) sessionStorage.removeItem(SCROLL_KEY);
    } catch { /* storage unavailable: scrolling is simply not restored */ }
  }, [data, location.key]);
  const rememberScroll = () => {
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ key: location.key, top: scroller(mainRef.current)?.scrollTop ?? 0 })); } catch { /* optional */ }
  };
  const selectTab = (index: number) => setParams(current => { const next = new URLSearchParams(current); next.set('tab', PLATFORM_TABS[index][0]); return next; }, { replace: true });
  const link = (kind: Parameters<typeof userManagementLink>[0]) => userManagementLink(kind, tabKey);
  const groupMetrics = data ? (group === 'all' ? data.activity : group === 'students' ? data.students : data.independentLearners) : null;
  const u = data?.users;
  const roleSegments = u ? [
    { label: 'Students', value: u.students, color: M7_COLORS.forest }, { label: 'Independent Learners', value: u.independentLearners, color: M7_COLORS.green },
    { label: 'Teachers', value: u.teachers, color: M7_COLORS.yellow }, { label: 'School Admins', value: u.schoolAdmins, color: M7_COLORS.coral },
    { label: 'System Admins', value: u.systemAdmins, color: M7_COLORS.blue }, { label: 'Onboarding incomplete', value: u.withoutRole, color: M7_COLORS.soft },
  ] : [];
  // Each account has at most one role, so the segments do not overlap. Anything else the total contains is shown, never hidden.
  const other = u ? u.total - roleSegments.reduce((sum, s) => sum + s.value, 0) : 0;
  if (other > 0) roleSegments.push({ label: 'Other accounts', value: other, color: M7_COLORS.muted });
  const weeks = data ? data.weeklyActivity.slice(-12) : [];
  return <main ref={mainRef} className="m7-page m7-dashboard m7-admin-dashboard m7r" aria-label="Platform Analytics">
    <header className="m7r-header"><div><h1>Platform Analytics</h1><p>Monitor platform-wide users, learning outcomes, and activity.</p></div></header>
    <div className="m7-dashboard-content">
      <Status loading={overview.loading} error={overview.error} retry={overview.retry} what="platform analytics" />
      {data && u && <>
        <M7Tabs idPrefix="platform" label="Platform Analytics sections" tabs={PLATFORM_TABS.map(([, label]) => label)} value={tabIndex} onChange={selectTab} />
        <div role="tabpanel" id={`platform-panel-${tabIndex}`} aria-labelledby={`platform-tab-${tabIndex}`} tabIndex={0} className="m7r-panel">
          {tabKey === 'overview' && <>
            <section className="m7r-section" aria-labelledby="pa-users"><h2 id="pa-users">Registered users</h2>
              <div className="m7r-kpis">
                <KpiLink to={link('all')} label="All accounts" value={u.total} onOpen={rememberScroll} />
                <KpiLink to={link('students')} label="Students" value={u.students} onOpen={rememberScroll} />
                <KpiLink to={link('independent')} label="Independent Learners" value={u.independentLearners} onOpen={rememberScroll} />
                <KpiLink to={link('teachers')} label="Teachers" value={u.teachers} note={`${u.approvedTeachers} approved`} onOpen={rememberScroll} />
                <KpiLink to={link('schoolAdmins')} label="School Admins" value={u.schoolAdmins} onOpen={rememberScroll} />
                <KpiLink to={link('systemAdmins')} label="System Admins" value={u.systemAdmins} onOpen={rememberScroll} />
                {u.withoutRole > 0 && <KpiLink to={link('withoutRole')} label="Onboarding incomplete" value={u.withoutRole} onOpen={rememberScroll} />}
              </div>
              <p className="m7r-note">Select a card to open User Management. Onboarding incomplete opens All Registered Users, which has no separate filter for it.</p>
            </section>
            <div className="m7r-grid-2">
              <section className="m7r-section"><DonutChart title="Registered accounts by role" note="Each account is counted once." segments={roleSegments} totalLabel="accounts" /></section>
              <section className="m7r-section" aria-labelledby="pa-modules"><h2 id="pa-modules">Reading modules</h2>
                <Kpis items={[['Published', data.modules.published], ['Drafts', data.modules.draft], ['Archived', data.modules.archived], ['In Trash', data.modules.inTrash]]} />
              </section>
            </div>
          </>}
          {tabKey === 'performance' && <>
            <section className="m7r-section" aria-labelledby="pa-performance">
              <div className="m7r-section-head"><h2 id="pa-performance">Learning performance</h2>
                <label className="m7r-select">Learner group<select value={group} onChange={e => setGroup(e.target.value as LearnerGroup)}>
                  {(Object.keys(GROUP_LABELS) as LearnerGroup[]).map(key => <option key={key} value={key}>{GROUP_LABELS[key]}</option>)}</select></label></div>
              <Kpis items={metricKpis(groupMetrics!)} />
              <p className="m7r-note">{GROUP_LABELS[group]}: saved readings and completed comprehension quizzes{group === 'all' ? ' by Students and Independent Learners' : ''}.</p>
            </section>
            <section className="m7r-section" aria-labelledby="pa-active"><h2 id="pa-active">Active learners (platform-wide)</h2>
              <Kpis items={[['Last 7 days', data.activity.activeLearners7Days], ['Last 30 days', data.activity.activeLearners30Days]]} />
              <p className="m7r-note">All learners. These figures do not change with the learner group selector.</p>
            </section>
            <div className="m7r-grid-2">
              <section className="m7r-section"><BarChart title="Reading accuracy and comprehension" note="Average, 0–100%" unit="%" categories={['Reading accuracy', 'Comprehension']}
                series={[{ label: 'Students', color: M7_COLORS.forest, values: [chartValue(data.students.pronunciationAccuracy), data.students.invalidCompletedQuizzes ? null : chartValue(data.students.comprehensionScore)] },
                  { label: 'Independent Learners', color: M7_COLORS.green, values: [chartValue(data.independentLearners.pronunciationAccuracy), data.independentLearners.invalidCompletedQuizzes ? null : chartValue(data.independentLearners.comprehensionScore)] }]} /></section>
              <section className="m7r-section"><BarChart title="Average reading speed" note="Words per minute" unit="WPM" categories={['Students', 'Independent Learners']}
                series={[{ label: 'Reading speed', color: M7_COLORS.blue, values: [data.students.readingSpeedWpm === null ? null : Math.round(data.students.readingSpeedWpm), data.independentLearners.readingSpeedWpm === null ? null : Math.round(data.independentLearners.readingSpeedWpm)] }]} /></section>
            </div>
          </>}
          {tabKey === 'practice' && <PlatformSuggestions state={suggestions} />}
          {tabKey === 'weekly' && <>
            <section className="m7r-section"><BarChart title="Saved readings and completed quizzes by week" note={`Weeks start on Monday (PHT).${weeks.length < data.weeklyActivity.length ? ` The ${weeks.length} most recent recorded weeks.` : ''} Weeks without activity are not listed.`}
              unit="count" categories={weeks.map(w => displayDate(w.weekStart))} emptyText="No learner activity recorded yet."
              series={[{ label: 'Saved readings', color: M7_COLORS.forest, values: weeks.map(w => w.readings) }, { label: 'Completed quizzes', color: M7_COLORS.yellow, values: weeks.map(w => w.completedQuizzes) }]} /></section>
            <section className="m7r-section"><BarChart title="Active learners by week" note="Learners with a saved reading or completed quiz that week." unit="count" categories={weeks.map(w => displayDate(w.weekStart))}
              emptyText="No learner activity recorded yet." series={[{ label: 'Active learners', color: M7_COLORS.green, values: weeks.map(w => w.activeLearners) }]} /></section>
            <details className="m7r-details" open><summary>Detailed weekly records</summary>
              {!data.weeklyActivity.length ? <p>No learner activity recorded yet.</p> : <div className="m7-scroll" role="region" aria-label="Weekly activity" tabIndex={0}><table>
                <thead><tr><th>Week starting (PHT)</th><th>Saved readings</th><th>Completed quizzes</th><th>Active learners</th></tr></thead>
                <tbody>{[...data.weeklyActivity].reverse().map(w => <tr key={w.weekStart}><td>{displayDate(w.weekStart)}</td><td>{w.readings}</td><td>{w.completedQuizzes}</td><td>{w.activeLearners}</td></tr>)}</tbody>
              </table></div>}
              <p className="m7r-note">Weeks without activity are not listed. Updated {date(data.generatedAt)}.</p>
            </details>
          </>}
        </div>
      </>}
    </div>
  </main>;
}

/** M7 F10, System Admin: how many learners currently have each suggested practice area. Counts only, read-only. */
function PlatformSuggestions({ state }: { state: ReturnType<typeof useSystemAdminData<PlatformSuggestionSummary>> }) {
  const { data, error, loading, retry } = state;
  const groups = data ? ([['Students', data.students], ['Independent Learners', data.independentLearners]] as const) : [];
  return <>
    <section className="m7r-section" aria-label="Suggested practice across the platform"><h2>Suggested practice across the platform</h2>
      <p className="m7r-note">Learners whose own saved results currently lead to a rule-based suggestion. Counts only; no names. Read-only: Teachers record interventions.</p>
      <Status loading={loading} error={error} retry={retry} what="suggestion summary" />
      {data && <div className="m7r-grid-2">{groups.map(([label, group]) => <div key={label}>
        <h3>{label} ({group.learners})</h3>
        <Kpis items={suggestionCategoryCards(group)} />
        <p className="m7r-note" role="note">{improvingNote(group.improving)}</p>
      </div>)}</div>}
    </section>
    {data && <>
      <section className="m7r-section"><BarChart title="Learning support by category" note="Learners per category. In each group the four categories add up to its learner total." unit="count"
        categories={suggestionCategoryCards(data.students).map(([label]) => label)}
        series={groups.map(([label, group], i) => ({ label, color: i ? M7_COLORS.green : M7_COLORS.forest, values: suggestionCategoryCards(group).map(([, value]) => value) }))} /></section>
      <details className="m7r-details"><summary>Competency Breakdown</summary>
        {!data.needs.length ? <p>No suggested practice areas right now.</p> : <div className="m7-scroll" role="region" aria-label="Competency breakdown" tabIndex={0}><table className="m7s-summary">
          <thead><tr><th rowSpan={2}>Practice area</th><th rowSpan={2}>Language</th><th colSpan={2}>Students</th><th colSpan={2}>Independent Learners</th></tr>
            <tr><th>Repeated</th><th>Preliminary</th><th>Repeated</th><th>Preliminary</th></tr></thead>
          <tbody>{data.needs.map(n => <tr key={`${n.language}:${n.competency}`}><td>{n.competencyName}</td><td>{n.languageName}</td>
            <td>{n.student.pattern}</td><td>{n.student.preliminary}</td><td>{n.general_user.pattern}</td><td>{n.general_user.preliminary}</td></tr>)}</tbody>
        </table></div>}
        {data.needs.length > 0 && <p className="m7r-note">A learner with several practice areas may be counted in multiple rows.</p>}
      </details>
      <details className="m7r-details"><summary>How Suggested Practice Is Calculated</summary>
        <p>The four categories add up to the registered learner total: each learner is counted in exactly one, by their strongest evidence. A repeated learning difficulty: at least two recent assessments below 75% with at least four questions of that type, or at least two recent readings below 90% word accuracy. A preliminary observation is based on one assessment or reading and needs more evidence. On track: saved results meet the benchmarks. Improving is a progress indicator shown separately.</p>
        <p>Same rules as the Teacher view (75% comprehension benchmark, 90% word recognition, fluency not evaluated). Updated {date(data.generatedAt)}.</p>
      </details>
    </>}
  </>;
}

/**
 * System Admin: View User Performance Dashboard (Appendix N M7 F4) for Independent Learners, whom the System Admin
 * administers at platform level. School Students are not included. Results show scores and dates only: no
 * recordings, transcripts, answers or the titles of the learner's own uploaded materials.
 */
export function SystemAdminLearnerPerformancePage() {
  const list = useSystemAdminData<IndependentLearnerRow[]>('/system-admin/independent-learners');
  const [selected, setSelected] = useState('');
  const detail = useSystemAdminData<IndependentLearnerDetail>(selected ? `/system-admin/independent-learners/${encodeURIComponent(selected)}` : null);
  const learners = list.data || [];
  return <main className="m7-page m7-dashboard m7-admin-dashboard">
    <header className="m7-dashboard-header m7-header-card"><div><h1>Independent Learner Performance</h1>
      <p>Reading and comprehension results of Independent Learner accounts. School Students are managed by their School Admin and Teachers and are not included.</p></div></header>
    <div className="m7-dashboard-content">
      <Status loading={list.loading} error={list.error} retry={list.retry} what="Independent Learners" />
      {list.data && <section><h2>Independent Learners ({learners.length})</h2>
        {!learners.length ? <p>No Independent Learner accounts yet.</p> : <>
          <div className="m7-scroll"><table>
            <thead><tr><th>Learner</th><th>Saved readings</th><th>Completed quizzes</th><th>Comprehension</th><th>Reading accuracy</th><th>Reading speed</th><th>Last activity (PHT)</th></tr></thead>
            <tbody>{learners.map(l => <tr key={l.id}>
              <td>{l.name}</td>
              <td>{l.readingAttempts}</td><td>{l.completedQuizzes}</td>
              <td>{l.invalidCompletedQuizzes ? 'Unavailable' : percent(l.comprehensionScore)}</td><td>{percent(l.pronunciationAccuracy)}</td>
              <td>{wpm(l.readingSpeedWpm)}</td><td>{l.lastActivityAt ? date(l.lastActivityAt) : 'No activity yet'}</td>
            </tr>)}</tbody>
          </table></div>
          <PerformanceSelector id="system-admin-learner" label="View an Independent Learner" value={selected}
            options={learners.map(l => ({ id: l.id, name: l.name }))} onChange={setSelected} placeholder="Select a learner" />
        </>}
      </section>}
      {selected && <section aria-live="polite">
        <Status loading={detail.loading} error={detail.error} retry={detail.retry} what="learner results" />
        {detail.data && <>
          <h2>{detail.data.name}</h2>
          <p>Last activity: {detail.data.lastActivityAt ? date(detail.data.lastActivityAt) : 'No activity yet'}</p>
          <MetricsCards data={detail.data.summary} />
          <h3>Comprehension by question type</h3>
          <Cards items={Object.entries(detail.data.competency).map(([type, c]) =>
            [TYPE_LABELS[type] || type, c.score === null ? (c.total ? 'Unavailable' : 'No data') : `${c.score}% (${c.correct}/${c.total})`] as [string, string])} />
          <h3>Completed quizzes</h3>
          {!detail.data.quizzes.length ? <p>No completed quizzes yet.</p> : <div className="m7-scroll"><table>
            <thead><tr><th>Source</th><th>Completed (PHT)</th><th>First-answer score</th></tr></thead>
            <tbody>{[...detail.data.quizzes].reverse().map(q => <tr key={q.id}><td>{q.source.title}</td><td>{date(q.completedAt)}</td><td>{formatQuizScore(q)}</td></tr>)}</tbody>
          </table></div>}
          {detail.data.notCountedQuizzes > 0 && <p className="m7-performance-scope">{detail.data.notCountedQuizzes} extra attempt(s) saved before the one-assessment rule are not counted.</p>}
          <h3>Reading results</h3>
          {!detail.data.readings.length ? <p>No saved readings yet.</p> : <div className="m7-scroll"><table>
            <thead><tr><th>Source</th><th>Completed (PHT)</th><th>Reading accuracy</th><th>Speed</th><th>Words different from the story</th></tr></thead>
            <tbody>{detail.data.readings.map(r => <tr key={r.id}><td>{r.source.title}</td><td>{date(r.completedAt)}</td>
              <td>{percent(r.readingAccuracy)}</td><td>{wpm(r.readingSpeedWpm)}</td><td>{r.wordsDifferent ?? 'No data'}</td></tr>)}</tbody>
          </table></div>}
          <SuggestedInterventions readOnly path={`/system-admin/independent-learners/${encodeURIComponent(selected)}/suggestions`} scope="this learner's own practice"
            scopeNote="Word lists and the titles of the learner's own uploaded materials are hidden in this view." />
          <p className="m7-performance-scope">Recordings, transcripts, answers and the learner's own uploaded materials are not shown.</p>
        </>}
      </section>}
    </div>
  </main>;
}
