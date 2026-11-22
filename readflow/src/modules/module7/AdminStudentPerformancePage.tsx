import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { createStudentPerformanceRequests, type StudentPerformanceRequests } from './services/studentPerformanceRequests';
import { loadAdminClassroomLabels } from './services/adminClassroomLabels';
import PerformanceSelector from './components/PerformanceSelector';
import { getRoomEnrollments, getClassroomById } from '../module4/services/classroomService';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import StudentCombobox from './components/StudentCombobox';
import StudentReadingChart from './components/StudentReadingChart';
import { formatAnalyticsDate as displayDate, formatAnalyticsDateTime as date } from './services/dateDisplay';
import { formatComprehension, formatQuizScore, formatScore, passageProgressText } from './services/scoreDisplay';
import { isActiveWarning, recoveryNote } from './services/studentSupportClassification';
import { m7Request, type AdminSystemData, type AdminStudentDetail, type AdminStudentRow, type SuggestionsData } from './services/m7Service';
import { SuggestedInterventions } from './components/SuggestedInterventions';
import { NotCountedQuizzes, RiskGuidance } from './M7Pages';
import './m7.css';
import './m7Dashboard.css';
import './adminStudentPerformance.css';

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
  const { user, profile, loading, profileError } = useAuth();
  const authorizationScope = JSON.stringify([user, profile, loading, profileError]);
  // Identity, session metadata and profile/permission changes get a fresh workspace.
  // Equivalent background profile refreshes do not discard the current selection.
  // Records never survive page unmount, sign-out, account switch or an authorization-scope change.
  const requests = useMemo(() => createStudentPerformanceRequests(
    <T,>(path: string, signal: AbortSignal) => m7Request<T>(path, 'GET', undefined, { signal, timeoutMs: 60_000 }),
  ), [authorizationScope]);
  useEffect(() => { requests.retain(); return () => requests.release(); }, [requests]);
  if (loading || profileError || !user || profile?.role !== 'admin') return null;
  return <StudentPerformanceWorkspace key={requests.scope} requests={requests} />;
}

export function StudentPerformanceWorkspace({ requests }: { requests?: StudentPerformanceRequests }) {
  const request = requests?.request ?? m7Request;
  const [students, setStudents] = useState<AdminStudentRow[] | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  // URL navigation is only a selection request, never an authorization source.
  const selectionParameters = searchParams.getAll('studentId');
  const selected = selectionParameters.length === 1 ? selectionParameters[0] : '';
  const setSelected = (studentId: string) => setSearchParams(current => {
    const next = new URLSearchParams(current);
    next.delete('studentId');
    if (studentId) next.set('studentId', studentId);
    return next;
  }, { replace: true });
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
    request<AdminSystemData>('/system').then(async result => {
      if (!active) return;
      const labels = await loadAdminClassroomLabels(result.details, getClassroomById);
      if (active) setRooms(labels.map(room => ({id:room.id,name:room.label})));
    }).catch(e => { if (active) setRoomError(e instanceof Error ? e.message : 'Unable to load classrooms.'); })
      .finally(() => { if (active) setRoomsLoading(false); });
    return () => { active = false; };
  }, [roomRevision, request]);
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
    request<AdminStudentRow[]>('/admin/students')
      .then(rows => { if (active) setStudents(rows); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load student performance.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, request]);
  const membershipLoading = Boolean(roomId && membership?.roomId !== roomId && !membershipError);
  // Intersect with the Admin Student-role response, never add accounts from enrollment.
  const shown = useMemo(() => (students || []).filter(s =>
    (!roomId || (membership?.roomId === roomId && membership.studentIds.includes(s.id))) &&
    (filter === 'all' || (filter === 'active' ? isActiveWarning(s.classification) : s.classification === (filter === 'none' ? 'No assessment data' : filter)))), [students, roomId, membership, filter]);
  const options = useMemo(() => shown.map(student => ({ id: student.id, name: student.name })), [shown]);
  const activeStudent = !loading && !error && !membershipLoading && !membershipError && shown.some(student => student.id === selected) ? selected : '';
  const unavailableSelection = selectionParameters.length > 0 && !loading && !error && !membershipLoading && !membershipError && !activeStudent;
  const reset = () => { setRoomId(''); setFilter('all'); setSelected(''); setMembership(null); setMembershipError(''); };
  return <main className="m7-page m7-dashboard m7-admin-dashboard asp-dashboard">
    <header className="m7-dashboard-header m7-header-card"><div><h1>Student Performance</h1>
      <p>View individual reading and comprehension progress.</p></div></header>
    <div className="m7-dashboard-content">
      <section className="asp-find" aria-labelledby="asp-find-heading">
        <div className="asp-section-heading"><h2 id="asp-find-heading">Find a Student</h2><button type="button" className="m7-secondary" onClick={reset}>Reset Filters</button></div>
        <div className="asp-filters">
          <PerformanceSelector id="admin-student-classroom" label="Learning Room" value={roomId} options={rooms}
            onChange={value => { setRoomId(value); setSelected(''); setMembership(null); setMembershipError(''); }} placeholder="All Learning Rooms" disabled={roomsLoading || !!roomError} describedBy="admin-student-scope" />
          <label className="m7-performance-selector" htmlFor="admin-student-classification"><span>Classification</span><select id="admin-student-classification" value={filter} onChange={e => { setFilter(e.target.value); setSelected(''); }}>
            <option value="all">All Classifications</option>
            {['On Track', 'Early Warning', 'At Risk', 'Needs Support'].map(label => <option key={label}>{label}</option>)}
            <option value="none">No Assessment Data</option><option value="Evaluation unavailable">Evaluation unavailable</option>
            <option value="active">Active warnings and risk</option>
          </select></label>
          <StudentCombobox id="admin-student" value={activeStudent} options={options} onChange={setSelected}
            disabled={loading || !!error || membershipLoading || !!membershipError} describedBy="admin-student-scope" />
        </div>
        <p id="admin-student-scope" className="asp-meta">Filters narrow the student list only. Metrics use full saved history and current completion across authorized classrooms and eligible unassigned work. Classifications retain their existing teacher contexts. Independent Learners are not included.</p>
        {unavailableSelection && <p role="status" className="asp-meta">The requested student is unavailable or does not match the current filters. Choose another student or reset the filters. <button type="button" className="m7-secondary" onClick={() => setSelected('')}>Clear student link</button></p>}
        {loading && <p role="status">Loading student performance…</p>}
        {error && <div role="alert" className="m7-error">{error} <button type="button" onClick={() => setRevision(v => v + 1)}>Retry</button></div>}
        {roomsLoading && <p role="status">Loading classroom options...</p>}
        {roomError && <p role="alert">{roomError} Student selection remains available across all classrooms. <button type="button" onClick={() => setRoomRevision(v => v + 1)}>Retry classrooms</button></p>}
        {!roomsLoading && !roomError && !rooms.length && <p>No classrooms available. Students without enrollment remain available under All Learning Rooms.</p>}
        {membershipLoading && <p role="status">Loading classroom students...</p>}
        {membershipError && <p role="alert">{membershipError} <button type="button" onClick={() => setMembershipRevision(v => v + 1)}>Retry enrollment</button></p>}
        {students && !loading && !error && !membershipLoading && !membershipError && <p role="status" className="asp-meta">{!students.length ? 'No Student accounts yet.' : !shown.length ? 'No students match these filters.' : `${shown.length} eligible students`}</p>}
      </section>
      {activeStudent ? <StudentDetail requests={requests} key={activeStudent} studentId={activeStudent} summary={shown.find(s => s.id === activeStudent)} onClose={() => setSelected('')} /> :
        <section className="asp-empty" aria-label="No student selected"><Search aria-hidden="true" size={32} /><h2>Select a student to view performance</h2><p>Choose a learning room, classification, and student to view their individual results.</p></section>}
      <details className="asp-classification-guide"><summary>Understanding Student Classifications</summary><RiskGuidance /></details>
    </div>
  </main>;
}

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' };
const COMPETENCY_LABELS: Record<string, string> = { word_recognition: 'Word recognition', fluency: 'Reading fluency', literal: 'Literal comprehension', inferential: 'Inferential comprehension', critical: 'Critical comprehension', other: 'Other' };
const OUTCOME_LABELS: Record<string, string> = { improved: 'Improved', partly_improved: 'Partly improved', no_change: 'No change yet', too_early: 'Too early to tell' };
/** M7 F10/F11 for the School Admin: read-only suggestions and the school's intervention history (Teachers record). */
const DETAIL_TABS = ['Reading Performance', 'Comprehension Performance', 'Learning Support'];
function OverviewMetrics({ data }: { data: AdminStudentRow }) {
  return <div className="m7-metrics asp-metrics">{[
    ['Saved Readings', data.readingAttempts], ['Reading Accuracy', percent(data.pronunciationAccuracy)], ['Reading Speed', wpm(data.readingSpeedWpm)],
    ['Comprehension Score', formatComprehension(data)], ['Completed Quizzes', data.completedQuizzes],
    ['Completed / Assigned Activities', data.completion.assigned ? `${data.completion.completed} / ${data.completion.assigned}` : 'None assigned'],
  ].map(([label, value]) => <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

export function StudentDetail({ studentId, summary, onClose, requests }: { requests?: StudentPerformanceRequests; studentId: string; summary?: AdminStudentRow; onClose: () => void; onSaved?: () => void }) {
  const request = requests?.request ?? m7Request;
  const [loaded, setLoaded] = useState<{ studentId: string; detail: AdminStudentDetail } | null>(null);
  const [failure, setFailure] = useState<{ studentId: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0), [tab, setTab] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(null); setFailure(null); setTab(0);
    const path = `/admin/students/${encodeURIComponent(studentId)}`;
    // Independent endpoints start together; the profile never waits for suggestions.
    if (requests) void requests.request<SuggestionsData>(`${path}/suggestions`).catch(() => {});
    request<AdminStudentDetail>(path)
      .then(detail => { if (active) setLoaded({ studentId, detail }); })
      .catch(error => { if (active) setFailure({ studentId, message: error instanceof Error ? error.message : 'Unable to load this student.' }); });
    return () => { active = false; requests?.cancelStudent(studentId); };
  }, [studentId, revision, request, requests]);
  if (failure?.studentId === studentId) return <section role="alert" className="m7-error">{failure.message} <button type="button" onClick={() => { setFailure(null); setRevision(v => v + 1); }}>Retry</button><button type="button" onClick={onClose}>Clear selection</button></section>;
  if (loaded?.studentId !== studentId) return <section><p role="status">Loading student…</p></section>;
  const detail = loaded.detail;
  const history = detail.interventions.history ?? [];
  return <div className="asp-student-details">
    <section className="asp-profile" aria-labelledby="admin-student-detail">
      <div className="asp-profile-heading"><span className="asp-avatar" aria-hidden="true">{detail.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span><div>
        <h2 id="admin-student-detail">{detail.name}</h2><p>{detail.classrooms.length ? detail.classrooms.join(', ') : 'Not enrolled'}</p>
        <span className="m7-classification" data-classification={detail.classification}>{detail.classification}</span>
      </div><button type="button" className="m7-secondary" onClick={onClose}>Clear selection</button></div>
      <p className="asp-meta">Full saved student history · Current activity completion. Reading accuracy compares words heard with the story. Classification uses eligible comprehension assessments in approved-teacher contexts.</p>
      <OverviewMetrics data={detail} />
      {detail.completion.completionRate !== null && <div className="asp-completion"><span>Activity completion: {formatScore(detail.completion.completionRate)}</span><progress aria-label="Activity completion" max={100} value={detail.completion.completionRate}>{formatScore(detail.completion.completionRate)}</progress></div>}
      {summary && <details className="asp-directory-snapshot"><summary>Student list snapshot</summary><p className="asp-meta">Values returned by the student list request. The overview above uses the selected student's detail response; snapshots may differ if records change between requests.</p><OverviewMetrics data={summary} /></details>}
    </section>
    <section className="asp-performance" aria-labelledby="asp-performance-heading"><h2 id="asp-performance-heading">Performance Details</h2>
      <div className="asp-tabs" role="tablist" aria-label="Student performance details">{DETAIL_TABS.map((label, index) => <button key={label} type="button" role="tab" id={`student-detail-tab-${index}`} aria-controls={`student-detail-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1}
        onClick={() => setTab(index)} onKeyDown={event => {
          let next: number;
          if (event.key === 'ArrowRight') next = (index + 1) % DETAIL_TABS.length;
          else if (event.key === 'ArrowLeft') next = (index + DETAIL_TABS.length - 1) % DETAIL_TABS.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = DETAIL_TABS.length - 1;
          else return;
          event.preventDefault(); setTab(next); document.getElementById(`student-detail-tab-${next}`)?.focus();
        }}>{label}</button>)}</div>
      <div id="student-detail-panel-0" role="tabpanel" aria-labelledby="student-detail-tab-0" tabIndex={0} hidden={tab !== 0}>
        <p>Each point is one saved attempt. All readings remain in the table, including repeated activity titles. Dates use Philippine time.</p>
        <StudentReadingChart readings={detail.readings} />
    <h3>Reading results</h3>
    {!detail.readings.length ? <p>No saved readings yet.</p> : <div className="m7-scroll"><table><thead><tr><th>Reading</th><th>Completed (PHT)</th><th>Reading accuracy</th><th>Reading speed</th></tr></thead>
      <tbody>{[...detail.readings].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).map(r => <tr key={r.id}><td>{r.title}</td><td>{date(r.completedAt)}</td><td>{percent(r.readingAccuracy)}</td><td>{wpm(r.readingSpeedWpm)}</td></tr>)}</tbody></table></div>}

      </div>
      <div id="student-detail-panel-1" role="tabpanel" aria-labelledby="student-detail-tab-1" tabIndex={0} hidden={tab !== 1}>
    <h3>Competency report</h3>
    <p>First answers from completed comprehension quizzes, grouped by question type. Invalid assessment evidence is shown as unavailable, not as wrong answers.</p>
    <div className="m7-metrics">{Object.entries(detail.competency).map(([type, result]) => <div key={type} className="m7-card">
      <span>{TYPE_LABELS[type] ?? type}</span>
      <strong>{detail.invalidCompletedQuizzes ? 'Invalid assessment evidence' : result.total === 0 ? 'No data' : formatScore(result.score)}</strong>
      <span>{result.total === 0 ? 'No questions answered' : result.correct === null ? `${result.total} questions` : `${result.correct} of ${result.total} correct`}</span>
    </div>)}</div>

    <h3>Completed quizzes</h3>
    {!detail.quizzes.length ? <p>No completed quizzes yet.</p> : <div className="m7-scroll"><table><thead><tr><th>Activity</th><th>Completed (PHT)</th><th>First-answer score</th></tr></thead>
      <tbody>{detail.quizzes.map(q => <tr key={q.id}><td>{q.title || 'Comprehension activity'}</td><td>{date(q.completedAt)}</td><td>{formatQuizScore(q)}</td></tr>)}</tbody></table></div>}
    <NotCountedQuizzes quizzes={detail.historicalQuizzes} />

      </div>
      <div id="student-detail-panel-2" role="tabpanel" aria-labelledby="student-detail-tab-2" tabIndex={0} hidden={tab !== 2}>
    <h3>Classification by Teacher</h3>
    {!detail.contexts.length ? <p>No completed quizzes in an approved teacher's classroom, so there is no classification yet.</p> :
      <div className="asp-teacher-contexts">{detail.contexts.map(c => <details key={c.teacherId}>
        <summary><span className="asp-context-title">{c.teacherName}<span className="asp-context-meta">{c.classrooms.join(', ')} · {c.completedQuizzes} completed quizzes</span></span><span className="m7-classification" data-classification={c.classification}>{c.classification}</span></summary>

        {recoveryNote(c.recoveryCount) && <p className="asp-recovery">{recoveryNote(c.recoveryCount)}</p>}
        <h4>Recent comprehension scores</h4><ul className="asp-context-scores">{c.latestScores.map((score, index) => <li key={index}><strong>{formatScore(score.score)}</strong><span>{date(score.completedAt)} PHT</span></li>)}</ul>
      </details>)}</div>}

        <details className="asp-activities"><summary>Assigned activity details <span className="asp-completion-summary">{detail.completion.completed} / {detail.completion.assigned} completed{detail.completion.completionRate === null ? '' : ` · ${formatScore(detail.completion.completionRate)}`}</span></summary>
    <h3>Activity completion</h3>
    {!detail.activities.length ? <p>No assigned reading activities.</p> :
      <p>{detail.completion.completed} of {detail.completion.assigned} assigned activities completed{detail.completion.completionRate === null ? '' : ` (${formatScore(detail.completion.completionRate)})`}.</p>}
    {detail.activities.length > 0 && <ul>{detail.activities.map(a => <li key={`${a.kind}-${a.id}`}>{a.title} ({a.roomName}) — {a.status}{passageProgressText(a) && ` (${passageProgressText(a)})`}</li>)}</ul>}

        </details>
        <SuggestedInterventions loadData={requests?.request} key={studentId} readOnly compact path={`/admin/students/${detail.id}/suggestions`} scope="your school's classrooms" />
    <section className="asp-support-history"><h3>Intervention history</h3>
    <p>Interventions recorded for this student in your school, newest first. Teachers record and update interventions; this view is read-only. Teachers' private notes are not shown.</p>
    {!history.length ? <p>No interventions recorded for this student yet.</p> : <div className="m7-intervention-history-admin">{history.map(i => <details className="m7-card asp-history" key={i.id} aria-label={`Intervention from ${displayDate(i.intervention_date)}`}>
      <summary>{i.suggestion_title || (i.competency ? COMPETENCY_LABELS[i.competency] ?? i.competency : 'Intervention')} · {STATUS_LABELS[i.status] ?? i.status} · {displayDate(i.intervention_date)}</summary>
      <p className="m7-performance-scope">Recorded by {i.author.name} ({i.author.role}){i.competency ? ` · ${COMPETENCY_LABELS[i.competency] ?? i.competency}` : ''}{i.language ? ` · ${i.language === 'fil' ? 'Filipino' : 'English'}` : ''}</p>
      {i.suggestion_title && <p>From suggestion: {i.suggestion_title}</p>}
      <p className="m7-notes">{i.notes}</p>
      {i.follow_up_date && <p>Follow-up date: {displayDate(i.follow_up_date)}</p>}
      {i.follow_up_outcome && <p>Follow-up outcome: {OUTCOME_LABELS[i.follow_up_outcome] ?? i.follow_up_outcome}</p>}
      {i.follow_up_notes && <p className="m7-notes">Follow-up information: {i.follow_up_notes}</p>}
    </details>)}</div>}
    </section>
      </div>
    </section>
  </div>;
}
