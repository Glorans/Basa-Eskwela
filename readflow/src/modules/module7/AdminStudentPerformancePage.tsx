import { useCallback, useEffect, useState } from 'react';
import { formatAnalyticsDate as displayDate, formatAnalyticsDateTime as date } from './services/dateDisplay';
import { formatComprehension, formatQuizScore, formatScore, passageProgressText } from './services/scoreDisplay';
import { isActiveWarning, recoveryNote } from './services/studentSupportClassification';
import { m7Request, type AdminStudentDetail, type AdminStudentRow, type Intervention } from './services/m7Service';
import { InterventionForm, MetricsCards, NotCountedQuizzes, RiskGuidance } from './M7Pages';
import './m7.css';
import './m7Dashboard.css';

const percent = (value: number | null) => value === null ? 'No data' : formatScore(Math.round(value * 100) / 100);
const wpm = (value: number | null) => value === null ? 'No data' : `${Math.round(value)} WPM`;
const TYPE_LABELS: Record<string, string> = { literal: 'Literal', inferential: 'Inferential', critical: 'Critical' };

/**
 * Admin: View Student Performance Dashboard, competency reports and interventions
 * (Appendix N M7 functions 4, 9 and 10). Student accounts only; Independent Learners are
 * not included. Every value comes from the Admin-only analytics API; nothing is calculated
 * from client-side role checks.
 */
export default function AdminStudentPerformancePage() {
  const [students, setStudents] = useState<AdminStudentRow[] | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<'all' | 'active' | 'none'>('all');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    m7Request<AdminStudentRow[]>('/admin/students')
      .then(rows => { if (active) setStudents(rows); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load student performance.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const shown = (students || []).filter(s => filter === 'all' || (filter === 'active' ? isActiveWarning(s.classification) : s.classification === 'No assessment data'));
  return <main className="m7-page m7-dashboard">
    <header className="m7-dashboard-header m7-header-card"><div><h1>Student Performance</h1>
      <p>Individual reading and comprehension results for every Student account. Independent Learners are not included.</p></div></header>
    <div className="m7-dashboard-content">
      {loading && <p role="status">Loading student performance…</p>}
      {error && <div role="alert" className="m7-error">{error} <button onClick={() => setRevision(v => v + 1)}>Retry</button></div>}
      <RiskGuidance />
      {students && <section><h2>Students ({students.length})</h2>
        <p>Reading Accuracy is transcript-based (words heard compared with the story). Classification uses completed comprehension quiz scores; a student without completed quizzes shows "No assessment data", never a low score.</p>
        <label className="m7-support-filter"><span>Show</span><select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          <option value="all">All students</option><option value="active">Active warnings and risk</option><option value="none">No assessment data</option></select></label>
        {!students.length ? <p>No Student accounts yet.</p> : !shown.length ? <p>No students match this filter.</p> :
          <div className="m7-scroll"><table><thead><tr><th>Student</th><th>Classrooms</th><th>Classification</th><th>Readings</th><th>Reading accuracy</th><th>Reading speed</th><th>Quizzes</th><th>Comprehension</th><th>Activities completed</th></tr></thead>
            <tbody>{shown.map(s => <tr key={s.id}>
              <td><button className="m7-student-action" onClick={() => setSelected(s.id)}>{s.name}</button></td>
              <td>{s.classrooms.length ? s.classrooms.join(', ') : 'Not enrolled'}</td>
              <td><span className="m7-classification" data-classification={s.classification}>{s.classification}</span></td>
              <td>{s.readingAttempts}</td><td>{percent(s.pronunciationAccuracy)}</td><td>{wpm(s.readingSpeedWpm)}</td>
              <td>{s.completedQuizzes}</td><td>{formatComprehension(s)}</td>
              <td>{s.completion.assigned ? `${s.completion.completed} / ${s.completion.assigned}` : 'None assigned'}</td>
            </tr>)}</tbody></table></div>}
      </section>}
      {selected && <StudentDetail key={selected} studentId={selected} onClose={() => setSelected('')} onSaved={() => setRevision(v => v + 1)} />}
    </div>
  </main>;
}

export function StudentDetail({ studentId, onClose, onSaved }: { studentId: string; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<AdminStudentDetail | null>(null);
  const [error, setError] = useState(''), [editing, setEditing] = useState<Intervention | 'new' | null>(null), [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try { setDetail(await m7Request<AdminStudentDetail>(`/admin/students/${studentId}`)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load this student.'); }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <section role="alert" className="m7-error">{error} <button onClick={() => void load()}>Retry</button></section>;
  if (!detail) return <section><p role="status">Loading student…</p></section>;
  const others = detail.interventions.others;
  return <section aria-labelledby="admin-student-detail">
    <h2 id="admin-student-detail">{detail.name} — {detail.classification}</h2>
    <p><button className="m7-secondary" onClick={onClose}>Close student</button></p>
    <MetricsCards data={detail} />

    <h3>Competency report</h3>
    <p>First answers from completed comprehension quizzes, grouped by question type. Invalid assessment evidence is shown as unavailable, not as wrong answers.</p>
    <div className="m7-metrics">{Object.entries(detail.competency).map(([type, result]) => <div key={type} className="m7-card">
      <span>{TYPE_LABELS[type] ?? type}</span>
      <strong>{detail.invalidCompletedQuizzes ? 'Invalid assessment evidence' : result.total === 0 ? 'No data' : formatScore(result.score)}</strong>
      <span>{result.total === 0 ? 'No questions answered' : result.correct === null ? `${result.total} questions` : `${result.correct} of ${result.total} correct`}</span>
    </div>)}</div>

    <h3>At-risk classification by teacher</h3>
    {!detail.contexts.length ? <p>No completed quizzes in an approved teacher's classroom, so there is no classification yet.</p> :
      <ul>{detail.contexts.map(c => <li key={c.teacherId}><strong>{c.teacherName}</strong> ({c.classrooms.join(', ')}): {c.classification}{recoveryNote(c.recoveryCount) ? ` (${recoveryNote(c.recoveryCount)})` : ''} — {c.completedQuizzes} quizzes; latest {c.latestScores.map(s => `${formatScore(s.score)} (${displayDate(s.completedAt)})`).join(', ')}</li>)}</ul>}

    <h3>Activity completion</h3>
    {!detail.activities.length ? <p>No assigned reading activities.</p> :
      <p>{detail.completion.completed} of {detail.completion.assigned} assigned activities completed{detail.completion.completionRate === null ? '' : ` (${formatScore(detail.completion.completionRate)})`}.</p>}
    {detail.activities.length > 0 && <ul>{detail.activities.map(a => <li key={`${a.kind}-${a.id}`}>{a.title} ({a.roomName}) — {a.status}{passageProgressText(a) && ` (${passageProgressText(a)})`}</li>)}</ul>}

    <h3>Completed quizzes</h3>
    {!detail.quizzes.length ? <p>No completed quizzes yet.</p> : <div className="m7-scroll"><table><thead><tr><th>Activity</th><th>Completed (PHT)</th><th>First-answer score</th></tr></thead>
      <tbody>{detail.quizzes.map(q => <tr key={q.id}><td>{q.title || 'Comprehension activity'}</td><td>{date(q.completedAt)}</td><td>{formatQuizScore(q)}</td></tr>)}</tbody></table></div>}
    <NotCountedQuizzes quizzes={detail.historicalQuizzes} />

    <h3>Reading results</h3>
    {!detail.readings.length ? <p>No saved readings yet.</p> : <div className="m7-scroll"><table><thead><tr><th>Reading</th><th>Completed (PHT)</th><th>Reading accuracy</th><th>Reading speed</th></tr></thead>
      <tbody>{detail.readings.map(r => <tr key={r.id}><td>{r.title}</td><td>{date(r.completedAt)}</td><td>{percent(r.readingAccuracy)}</td><td>{wpm(r.readingSpeedWpm)}</td></tr>)}</tbody></table></div>}

    <h3>Interventions</h3>
    <p>Interventions you record are saved under your Admin account and only you can edit them. Teacher interventions stay private to their authors; their totals are shown below.</p>
    <p>Teacher interventions: {others.total ? `${others.total} (${others.planned} planned, ${others.inProgress} in progress, ${others.completed} completed)` : 'none recorded'}.</p>
    {message && <p role="status">{message}</p>}
    {!detail.interventions.own.length && <p>You have not recorded an intervention for this student.</p>}
    {[...detail.interventions.own].sort((a, b) => b.intervention_date.localeCompare(a.intervention_date)).map(i => <article className="m7-card" key={i.id}>
      <strong>{displayDate(i.intervention_date)} — {i.status.replace('_', ' ')}</strong><p className="m7-notes">{i.notes}</p>
      {i.follow_up_date && <p>Follow up: {displayDate(i.follow_up_date)}</p>}{i.follow_up_notes && <p className="m7-notes">{i.follow_up_notes}</p>}
      <button onClick={() => setEditing(i)}>Edit intervention</button></article>)}
    {editing ? <InterventionForm key={editing === 'new' ? 'new' : editing.id} studentId={detail.id} basePath="/admin/students"
      existing={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)}
      onSaved={() => { setEditing(null); setMessage('Intervention saved.'); void load(); onSaved(); }} />
      : <button onClick={() => setEditing('new')}>Record intervention</button>}
  </section>;
}
