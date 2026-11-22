import SystemAdminActivityChart from "../system-admin/SystemAdminActivityChart";
import { useEffect, useState } from 'react';
import PerformanceSelector from './components/PerformanceSelector';
import { MetricsCards } from './M7Pages';
import { formatAnalyticsDate as displayDate, formatAnalyticsDateTime as date } from './services/dateDisplay';
import { formatQuizScore, formatScore } from './services/scoreDisplay';
import { m7Request, type IndependentLearnerDetail, type IndependentLearnerRow, type PlatformOverview, type PlatformSuggestionSummary } from './services/m7Service';
import { SuggestedInterventions } from './components/SuggestedInterventions';
import { improvingNote, suggestionCategoryCards } from './services/suggestionSummary';
import './components/suggestedInterventions.css';
import './m7.css';
import './m7Dashboard.css';

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

/**
 * System Admin: View System-wide Performance Dashboard (Appendix N M7 F2). Platform totals and averages only:
 * no names, accounts or per-learner rows. Learner activity counts Students and Independent Learners.
 */
export function SystemAdminOverviewPage() {
  const { data, error, loading, retry } = useSystemAdminData<PlatformOverview>('/system-admin/overview');
  return <main className="m7-page m7-dashboard m7-admin-dashboard">
    <header className="m7-dashboard-header m7-header-card"><div><h1>Platform Analytics</h1>
      <p>System-wide accounts, reading modules and learner activity. Totals and averages only; no individual records are shown.</p></div></header>
    <div className="m7-dashboard-content">
      <Status loading={loading} error={error} retry={retry} what="platform analytics" />
      {data && <>
        <section><h2>Registered users</h2>
          <Cards items={[['All accounts', data.users.total], ['Independent Learners', data.users.independentLearners], ['Students', data.users.students],
            ['Teachers', `${data.users.teachers} (${data.users.approvedTeachers} approved)`], ['School Admins', data.users.schoolAdmins],
            ['System Admins', data.users.systemAdmins], ...(data.users.withoutRole ? [['Onboarding not finished', data.users.withoutRole] as [string, number]] : [])]} />
        </section>
        <section><h2>Reading modules</h2>
          <Cards items={[['Published', data.modules.published], ['Drafts', data.modules.draft], ['Archived', data.modules.archived], ['In Trash', data.modules.inTrash]]} />
        </section>
        <section><h2>Learner activity</h2>
          <p>Saved readings and completed comprehension quizzes by Students and Independent Learners.</p>
          <Cards items={[['Active learners (last 7 days)', data.activity.activeLearners7Days], ['Active learners (last 30 days)', data.activity.activeLearners30Days]]} />
          <MetricsCards data={data.activity} />
        </section>
        <section><h2>Students</h2><MetricsCards data={data.students} /></section>
        <section><h2>Independent Learners</h2><MetricsCards data={data.independentLearners} /></section>
        <PlatformSuggestions />
        <section><h2>Weekly activity</h2>
          <SystemAdminActivityChart weeks={data.weeklyActivity} />
          {!data.weeklyActivity.length ? <p>No learner activity recorded yet.</p> : <div className="m7-scroll"><table>
            <thead><tr><th>Week starting (PHT)</th><th>Saved readings</th><th>Completed quizzes</th><th>Active learners</th></tr></thead>
            <tbody>{[...data.weeklyActivity].reverse().map(w => <tr key={w.weekStart}><td>{displayDate(w.weekStart)}</td><td>{w.readings}</td><td>{w.completedQuizzes}</td><td>{w.activeLearners}</td></tr>)}</tbody>
          </table></div>}
          <p className="m7-performance-scope">Weeks without activity are not listed. Updated {date(data.generatedAt)}.</p>
        </section>
      </>}
    </div>
  </main>;
}

/** M7 F10, System Admin: how many learners currently have each suggested practice area. Counts only, read-only. */
function PlatformSuggestions() {
  const { data, error, loading, retry } = useSystemAdminData<PlatformSuggestionSummary>('/system-admin/suggestions');

  return <section aria-label="Suggested practice across the platform"><h2>Suggested practice across the platform</h2>
    <p>Learners whose own saved results currently lead to a rule-based suggestion. Counts only; no names. Read-only: Teachers record interventions.</p>
    <Status loading={loading} error={error} retry={retry} what="suggestion summary" />
    {data && <>
      {([['Students', data.students], ['Independent Learners', data.independentLearners]] as const).map(([label, group]) => <div key={label}>
        <h3>{label} ({group.learners})</h3>
        <Cards items={suggestionCategoryCards(group)} />
        <p className="m7-performance-scope" role="note">{improvingNote(group.improving)}</p>
      </div>)}
      <p className="m7-performance-scope">The four categories add up to the registered learner total: each learner is counted in exactly one, by their strongest evidence. A repeated learning difficulty: at least two recent assessments below 75% with at least four questions of that type, or at least two recent readings below 90% word accuracy. A preliminary observation is based on one assessment or reading and needs more evidence. On track: saved results meet the benchmarks. Improving is a progress indicator shown separately.</p>
      {!data.needs.length ? <p>No suggested practice areas right now.</p> : <div className="m7-scroll"><table className="m7s-summary">
        <thead><tr><th rowSpan={2}>Practice area</th><th rowSpan={2}>Language</th><th colSpan={2}>Students</th><th colSpan={2}>Independent Learners</th></tr>
          <tr><th>Repeated</th><th>Preliminary</th><th>Repeated</th><th>Preliminary</th></tr></thead>
        <tbody>{data.needs.map(n => <tr key={`${n.language}:${n.competency}`}><td>{n.competencyName}</td><td>{n.languageName}</td>
          <td>{n.student.pattern}</td><td>{n.student.preliminary}</td><td>{n.general_user.pattern}</td><td>{n.general_user.preliminary}</td></tr>)}</tbody>
      </table></div>}
      {data.needs.length > 0 && <p className="m7-performance-scope">A learner with several practice areas may be counted in multiple rows.</p>}
      <p className="m7-performance-scope">Same rules as the Teacher view (75% comprehension benchmark, 90% word recognition, fluency not evaluated). Updated {date(data.generatedAt)}.</p>
    </>}
  </section>;
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
