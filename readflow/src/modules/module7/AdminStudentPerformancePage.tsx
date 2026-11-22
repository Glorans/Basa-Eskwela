import { loadAdminClassroomLabels } from './services/adminClassroomLabels';
import PerformanceSelector from './components/PerformanceSelector';
import { getRoomEnrollments, getClassroomById } from '../module4/services/classroomService';
import { useCallback, useEffect, useState } from 'react';
import { formatAnalyticsDate as displayDate, formatAnalyticsDateTime as date } from './services/dateDisplay';
import { formatComprehension, formatQuizScore, formatScore, passageProgressText } from './services/scoreDisplay';
import { isActiveWarning, recoveryNote } from './services/studentSupportClassification';
import { m7Request, type AdminSystemData, type AdminStudentDetail, type AdminStudentRow } from './services/m7Service';
import { SuggestedInterventions } from './components/SuggestedInterventions';
import { MetricsCards, NotCountedQuizzes, RiskGuidance } from './M7Pages';
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
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [roomId, setRoomId] = useState('');
  const [roomError, setRoomError] = useState(''), [roomsLoading, setRoomsLoading] = useState(true);
  const [roomRevision, setRoomRevision] = useState(0);
  const [membership, setMembership] = useState<{ roomId: string; studentIds: string[] } | null>(null);
  const [membershipError, setMembershipError] = useState('');
  const [membershipRevision, setMembershipRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setRoomsLoading(true); setRoomError('');
    // Reuse the authorized classroom options; student rows contain names only.
    m7Request<AdminSystemData>('/system').then(async result => {
      const labels = await loadAdminClassroomLabels(result.details, getClassroomById);
      if (active) setRooms(labels.map(room => ({id:room.id,name:room.label})));
    }).catch(e => { if (active) setRoomError(e instanceof Error ? e.message : 'Unable to load classrooms.'); })
      .finally(() => { if (active) setRoomsLoading(false); });
    return () => { active = false; };
  }, [roomRevision]);
  useEffect(() => {
    let active = true;
    setMembership(null); setMembershipError('');
    if (roomId) getRoomEnrollments(roomId).then(rows => {
      if (active) setMembership({ roomId, studentIds: rows.map(row => row.student_id) });
    }).catch(e => { if (active) setMembershipError(e instanceof Error ? e.message : 'Unable to load classroom enrollment.'); });
    return () => { active = false; };
  }, [roomId, membershipRevision]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    m7Request<AdminStudentRow[]>('/admin/students')
      .then(rows => { if (active) setStudents(rows); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load student performance.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const membershipLoading = Boolean(roomId && membership?.roomId !== roomId && !membershipError);
  // Intersect with the Admin Student-role response, never add accounts from enrollment.
  const shown = (students || []).filter(s =>
    (!roomId || (membership?.roomId === roomId && membership.studentIds.includes(s.id))) &&
    (filter === 'all' || (filter === 'active' ? isActiveWarning(s.classification) : s.classification === 'No assessment data')));
  const activeStudent = !loading && !error && !membershipLoading && !membershipError && shown.some(student => student.id === selected) ? selected : '';
  return <main className="m7-page m7-dashboard m7-admin-dashboard">
    <header className="m7-dashboard-header m7-header-card"><div><h1>Student Performance</h1>
      <p>Individual reading and comprehension results for every Student account. Independent Learners are not included.</p></div></header>
    <div className="m7-dashboard-content">
      {loading && <p role="status">Loading student performance…</p>}
      {error && <div role="alert" className="m7-error">{error} <button onClick={() => setRevision(v => v + 1)}>Retry</button></div>}
      <RiskGuidance />
      {students && !loading && !error && <section><h2>Students ({students.length})</h2>
        <p>Reading Accuracy is transcript-based (words heard compared with the story). Classification uses completed comprehension quiz scores; a student without completed quizzes shows "No assessment data", never a low score.</p>
        <div className="m7-performance-controls">
          <PerformanceSelector id="admin-student-classroom" label="Filter by Classroom" value={roomId} options={rooms}
            onChange={value => { setRoomId(value); setSelected(''); setMembership(null); setMembershipError(''); }} placeholder="All Classrooms" disabled={roomsLoading || !!roomError} describedBy="admin-student-scope" />
          <label className="m7-performance-selector"><span>Show</span><select value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setSelected(''); }}>
          <option value="all">All students</option><option value="active">Active warnings and risk</option><option value="none">No assessment data</option></select></label>
          <PerformanceSelector id="admin-student" label="Select Student" value={activeStudent}
            options={shown.map(student => ({ id: student.id, name: student.name }))} onChange={setSelected}
            placeholder="Select a student" disabled={membershipLoading || !!membershipError} describedBy="admin-student-scope" />
        </div>
        <p id="admin-student-scope" className="m7-performance-scope">Classroom and classification filters narrow the student list only. Student metrics retain their full saved history and current completion across all authorized classrooms, including eligible unassigned work. Risk classifications retain their existing teacher contexts.</p>
        {roomsLoading && <p role="status">Loading classroom options...</p>}
        {roomError && <p role="alert">{roomError} Student selection remains available across all classrooms. <button onClick={() => setRoomRevision(v => v + 1)}>Retry classrooms</button></p>}
        {!roomsLoading && !roomError && !rooms.length && <p>No classrooms available. Students without enrollment remain available under All Classrooms.</p>}
        {membershipLoading && <p role="status">Loading classroom students...</p>}
        {membershipError && <p role="alert">{membershipError} <button onClick={() => setMembershipRevision(v => v + 1)}>Retry enrollment</button></p>}
        {!students.length ? <p>No Student accounts yet.</p> : membershipLoading || membershipError ? null : !shown.length ? <p>No students match these filters.</p> : !activeStudent ? <p>Select a student to view their performance.</p> :
          <div className="m7-scroll"><table><thead><tr><th>Student</th><th>Classrooms</th><th>Classification</th><th>Readings</th><th>Reading accuracy</th><th>Reading speed</th><th>Quizzes</th><th>Comprehension</th><th>Activities completed</th></tr></thead>
            <tbody>{shown.filter(s => s.id === activeStudent).map(s => <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.classrooms.length ? s.classrooms.join(', ') : 'Not enrolled'}</td>
              <td><span className="m7-classification" data-classification={s.classification}>{s.classification}</span></td>
              <td>{s.readingAttempts}</td><td>{percent(s.pronunciationAccuracy)}</td><td>{wpm(s.readingSpeedWpm)}</td>
              <td>{s.completedQuizzes}</td><td>{formatComprehension(s)}</td>
              <td>{s.completion.assigned ? `${s.completion.completed} / ${s.completion.assigned}` : 'None assigned'}</td>
            </tr>)}</tbody></table></div>}
      </section>}
      {activeStudent && <StudentDetail key={activeStudent} studentId={activeStudent} onClose={() => setSelected('')} onSaved={() => setRevision(v => v + 1)} />}
    </div>
  </main>;
}

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' };
const COMPETENCY_LABELS: Record<string, string> = { word_recognition: 'Word recognition', fluency: 'Reading fluency', literal: 'Literal comprehension', inferential: 'Inferential comprehension', critical: 'Critical comprehension', other: 'Other' };
const OUTCOME_LABELS: Record<string, string> = { improved: 'Improved', partly_improved: 'Partly improved', no_change: 'No change yet', too_early: 'Too early to tell' };
/** M7 F10/F11 for the School Admin: read-only suggestions and the school's intervention history (Teachers record). */
export function StudentDetail({ studentId, onClose }: { studentId: string; onClose: () => void; onSaved?: () => void }) {
  const [detail, setDetail] = useState<AdminStudentDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setDetail(await m7Request<AdminStudentDetail>(`/admin/students/${studentId}`)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load this student.'); }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <section role="alert" className="m7-error">{error} <button onClick={() => void load()}>Retry</button></section>;
  if (!detail) return <section><p role="status">Loading student…</p></section>;
  const history = detail.interventions.history ?? [];
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

    <SuggestedInterventions readOnly path={`/admin/students/${detail.id}/suggestions`} scope="your school's classrooms" />

    <h3>Intervention history</h3>
    <p>Interventions recorded for this student in your school, newest first. Teachers record and update interventions; this view is read-only. Teachers' private notes are not shown.</p>
    {!history.length ? <p>No interventions recorded for this student yet.</p> : <div className="m7-intervention-history-admin">{history.map(i => <article className="m7-card" key={i.id} aria-label={`Intervention from ${displayDate(i.intervention_date)}`}>
      <strong>{displayDate(i.intervention_date)} — {STATUS_LABELS[i.status] ?? i.status}</strong>
      <p className="m7-performance-scope">Recorded by {i.author.name} ({i.author.role}){i.competency ? ` · ${COMPETENCY_LABELS[i.competency] ?? i.competency}` : ''}{i.language ? ` · ${i.language === 'fil' ? 'Filipino' : 'English'}` : ''}</p>
      {i.suggestion_title && <p>From suggestion: {i.suggestion_title}</p>}
      <p className="m7-notes">{i.notes}</p>
      {i.follow_up_date && <p>Follow-up date: {displayDate(i.follow_up_date)}</p>}
      {i.follow_up_outcome && <p>Follow-up outcome: {OUTCOME_LABELS[i.follow_up_outcome] ?? i.follow_up_outcome}</p>}
      {i.follow_up_notes && <p className="m7-notes">Follow-up information: {i.follow_up_notes}</p>}
    </article>)}</div>}
  </section>;
}
