import { formatAnalyticsDateTime as date } from './services/dateDisplay';
import { matchesSupportFilter, recoveryNote, NOT_COUNTED_NOTE, RISK_RULES, RISK_RULES_INTRO } from './services/studentSupportClassification';
import { formatScore, formatQuizScore, formatComprehension, passageProgressText } from './services/scoreDisplay';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { comprehensionResultTarget, readingResultTarget } from '../module5/services/comprehensionNavigation';
import { m7Request, type Metrics, type PersonalData, type TeacherData, type Intervention, type Quiz, type Student } from './services/m7Service';
import './m7.css';
import './m7Dashboard.css';
import './teacherSupport.css';
// Display rounding only; saved values and calculations are unchanged.
const percent = (value:number|null) => value === null ? 'No data' : formatScore(Math.round(value * 100) / 100);
const wholePercent = (value:unknown) => typeof value === 'number' && Number.isFinite(value) ? formatScore(Math.round(value)) : 'No data';
const wpm = (value:number|null) => value === null ? 'No data' : `${Math.round(value)} WPM`;
type LearnerRole = 'student' | 'general_user';
function useData<T>(path:string, poll = false) {
  const [data,setData] = useState<T|null>(null), [error,setError] = useState(''), [loading,setLoading] = useState(true);
  const refresh = useCallback(async () => { try { const value = await m7Request<T>(path); setData(value);setError(''); } catch(e) {setError((e as Error).message);} finally {setLoading(false);} },[path]);
  useEffect(() => { void refresh(); if (poll) { const timer = setInterval(() => void refresh(),30000); return () => clearInterval(timer); } },[refresh,poll]);
  return {data,error,loading,refresh};
}
function State({error,loading,retry}:{error:string;loading:boolean;retry:()=>void}) { return <>{loading && <p role="status">Loading analytics…</p>}{error && <div role="alert" className="m7-error">{error} <button onClick={retry}>Retry</button></div>}</>; }
/** The thresholds, shown wherever Teachers and Admins see a classification. */
export function RiskGuidance() {return <section className="m7-support-info" aria-label="Support classification guidance"><p>{RISK_RULES_INTRO}</p><ul>{RISK_RULES.map(([label,text]) => <li key={label}><strong>{label}:</strong> {text}</li>)}</ul></section>;}
/** Extra completed attempts: viewable as saved, never counted. */
export function NotCountedQuizzes({quizzes,own}:{quizzes?:Quiz[];own?:LearnerRole}) {return !quizzes?.length ? null : <section><h3>Other saved results (not counted)</h3><p>{NOT_COUNTED_NOTE}</p><QuizTable quizzes={quizzes} own={own}/></section>;}
export function MetricsCards({data}:{data:Metrics}) {return <div className="m7-metrics">{[
  ['Saved readings',data.readingAttempts],['Completed quizzes',data.completedQuizzes],['Comprehension',formatComprehension(data)],['Reading accuracy',percent(data.pronunciationAccuracy)],['Reading speed',wpm(data.readingSpeedWpm)],
].map(([label,value]) => <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;}
// No Hints column: M6 no longer records hints (one final answer per question), so the
// count is 0 for every current activity. Saved hint_used values are left unchanged.
function QuizTable({quizzes,own}:{quizzes:Quiz[];own?:LearnerRole}) {return !quizzes.length ? <p>No completed quizzes yet.</p> : <div className="m7-scroll"><table><thead><tr><th>Activity</th><th>Completed (PHT)</th><th>First-answer score</th></tr></thead><tbody>{[...quizzes].reverse().map(q => <tr key={q.id}><td>{own ? <Link to={comprehensionResultTarget(own, q.id)}>{q.title || 'Comprehension activity'}</Link> : q.title || 'Comprehension activity'}</td><td>{date(q.completedAt)}</td><td>{formatQuizScore(q)}</td></tr>)}</tbody></table></div>;}
/**
 * View Personal Learning Progress (Appendix N M7 function 1) for Students and Independent
 * Learners. The API returns only the signed-in learner's records. Independent Learners have
 * no classroom assignments, so the assigned-activity section is not shown to them.
 */
export function StudentProgressPage({ role = 'student' }: { role?: LearnerRole } = {}) {
  const {data,error,loading,refresh} = useData<PersonalData>('/personal');
  const empty = data && !data.readings.length && !data.quizzes.length;
  return <main className="m7-page"><h1>Progress & Result</h1><p>Your saved reading accuracy and comprehension results.</p><State {...{error,loading}} retry={() => void refresh()}/>{data && <><MetricsCards data={data.summary}/>{empty && <p role="status">{role === 'student' ? 'No results yet. Complete a reading activity to see your progress here.' : 'No results yet. Read a story from Reading Modules, then answer its questions, to see your progress here.'}</p>}{role === 'student' && <section><h2>Activity progress</h2><p>{data.activities.filter(a => a.status === 'Completed').length} of {data.activities.length} assigned reading activities completed.</p>{!data.activities.length ? <p>No assigned reading activities yet.</p> : <ul>{data.activities.map((a) => <li key={a.id}><Link to={a.kind === 'module' ? `/dashboard/learning-rooms/${a.roomId}` : `/dashboard/learning-rooms/${a.roomId}/reading-activities/${a.materialId}`}>{a.title}</Link> — {a.status}{passageProgressText(a) && ` (${passageProgressText(a)})`}</li>)}</ul>}</section>}<section><h2>Completed quizzes</h2><QuizTable quizzes={data.quizzes} own={role}/><NotCountedQuizzes quizzes={data.historicalQuizzes} own={role}/></section><section><h2>Reading results</h2>{!data.readings.length ? <p>No saved readings yet. Complete a reading activity to see your results.</p> : <div className="m7-scroll"><table><thead><tr><th>Result</th><th>Reading accuracy</th><th>Speed</th><th>Words different from the story</th></tr></thead><tbody>{[...data.readings].sort((a,b) => b.completed_at.localeCompare(a.completed_at)).map(r => { const target = readingResultTarget(role, r.id); return <tr key={r.id}><td>{target ? <Link to={target}>{date(r.completed_at)}</Link> : date(r.completed_at)}</td><td>{wholePercent(r.pronunciation_accuracy)}</td><td>{wpm(r.reading_speed_wpm)}</td><td>{r.detected_error_count}</td></tr>; })}</tbody></table></div>}</section></>}</main>;
}
export { default as AdminAnalyticsPage } from "./AdminAnalyticsPage";
/** The existing stored status values and their labels. */
const INTERVENTION_STATUS: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' };
const statusLabel = (value: string) => INTERVENTION_STATUS[value] ?? value.replace('_', ' ');
/** Record or update the signed-in author's own intervention. basePath selects the Teacher or Admin route. */
export function InterventionForm({studentId,existing,onSaved,onCancel,basePath = '/students', teacherLayout = false}:{teacherLayout?:boolean;studentId:string;existing?:Intervention;onSaved:()=>void;onCancel:()=>void;basePath?:string}) {
  const [notes,setNotes] = useState(existing?.notes || ''), [when,setWhen] = useState(existing?.intervention_date || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()));
  const [status,setStatus] = useState(existing?.status || 'planned'),[follow,setFollow] = useState(existing?.follow_up_date || ''),[followNotes,setFollowNotes] = useState(existing?.follow_up_notes || ''),[busy,setBusy] = useState(false),[error,setError] = useState('');
  const details = <label key="details">{teacherLayout ? 'Intervention details' : 'Notes'}<textarea required maxLength={10000} value={notes} onChange={e => setNotes(e.target.value)}/></label>;
  const recorded = <label key="recorded">{teacherLayout ? 'Date recorded' : 'Date'}<input required type="date" value={when} onChange={e => setWhen(e.target.value)}/></label>;
  const statusField = <label key="status">Status<select value={status} onChange={e => setStatus(e.target.value)}>{Object.entries(INTERVENTION_STATUS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
  const followDate = <label key="follow-date">Follow-up date<input type="date" value={follow} onChange={e => setFollow(e.target.value)}/></label>;
  const followInfo = <label key="follow-info">Follow-up information<textarea maxLength={10000} value={followNotes} onChange={e => setFollowNotes(e.target.value)}/></label>;
  // Teacher layout reads top to bottom: when and status, what was done, then the follow-up. Admin order is unchanged.
  const fields = teacherLayout ? [recorded, statusField, details, followDate, followInfo] : [details, recorded, statusField, followDate, followInfo];
  return <form className={teacherLayout ? "m7-form m7-intervention-form" : "m7-form"} aria-busy={busy} aria-label={`${existing ? 'Edit' : 'Record'} intervention`} onSubmit={async e => {e.preventDefault();setBusy(true);setError('');try {await m7Request(`${basePath}/${studentId}/interventions${existing ? `/${existing.id}` : ''}`,existing ? 'PATCH':'POST',{ notes,intervention_date:when,status,follow_up_date:follow || null,follow_up_notes:followNotes });onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><h3>{teacherLayout ? `${existing ? 'Edit' : 'Record'} Intervention` : `${existing ? 'Update' : 'Record'} intervention`}</h3>{fields}{error && <p role="alert">{error}</p>}<div><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save intervention'}</button> <button type="button" className={teacherLayout ? 'm7-secondary' : undefined} disabled={busy} onClick={onCancel}>Cancel</button></div></form>;
}
const supportTabs = ['Students Needing Support', 'Competency Reports', 'Student Interventions'];
const studentName = (student: Student) => student.full_name || student.nickname || 'Student';
function SupportClassification({ student }: { student: Student }) {
  return <><span className="m7-classification" data-classification={student.classification}>{student.classification}</span>
    {recoveryNote(student.recoveryCount) && <p>{recoveryNote(student.recoveryCount)}</p>}</>;
}
function AssignedProgress({ student }: { student: Student }) {
  return !student.activities?.length ? <p>No assigned reading activities or modules in your classrooms.</p> :
    <div className="m7-scroll" role="region" aria-label="Assigned reading progress" tabIndex={0}><table>
      <thead><tr><th>Reading Activity</th><th>Status</th><th>Progress</th></tr></thead>
      <tbody>{student.activities.map(a => <tr key={`${a.kind ?? 'activity'}-${a.id}`}><td>{a.title}</td><td>{a.status}</td><td>{passageProgressText(a) || 'Not available'}</td></tr>)}</tbody>
    </table></div>;
}
function SupportHistory({ student }: { student: Student }) {
  return <details className="m7-support-disclosure"><summary>Alert and recovery history</summary>
    {!student.history.length ? <p>No saved alerts. Current classification does not depend on saved alert history.</p> :
      <ul>{[...student.history].sort((a,b) => b.occurred_at.localeCompare(a.occurred_at)).map(event => {
        const resolved = event.classification === 'On Track' || student.history.some(later => !later.superseded_at && later.classification === 'On Track' && (later.occurred_at > event.occurred_at || (later.occurred_at === event.occurred_at && later.attempt_id > event.attempt_id)));
        return <li key={event.id}><strong>{event.classification}</strong> - {date(event.occurred_at)} - {event.superseded_at ? 'Superseded by reevaluation' : resolved ? 'Resolved' : 'Active episode'}
          <p>Previous: {event.previous_classification}. Supporting scores: {event.evidence.map(q => `${formatScore(q.score)} (${date(q.completedAt)})`).join(', ')}</p></li>;
      })}</ul>}
  </details>;
}
export function TeacherSupportPage() {
  const {data,error,loading,refresh} = useData<TeacherData>('/teacher',true);
  const [tab,setTab] = useState(0), [filter,setFilter] = useState('all'), [search,setSearch] = useState('');
  const [selected,setSelected] = useState(''), [showDetails,setShowDetails] = useState(false);
  const [editing,setEditing] = useState<Intervention|'new'|null>(null), [message,setMessage] = useState(''), [actionError,setActionError] = useState('');
  const student = data?.students.find(s => s.id === selected);
  const matches = (s: Student) => studentName(s).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const options = data?.students.filter(s => matches(s) || s.id === selected) ?? [];
  const rows = data?.students.filter(s => matches(s) && matchesSupportFilter(s,filter)) ?? [];
  const selectStudent = (id: string) => {setSelected(id);setEditing(null);setMessage('');};
  return <main className="m7-page m7-dashboard m7-support-page" aria-label="Student Support and Competencies">
    <div className="m7-dashboard-content">
      <div role="tablist" aria-label="Student Support sections" className="m7-tabs m7-support-tabs">
        {supportTabs.map((label,index) => <button key={label} type="button" role="tab" id={`support-tab-${index}`} aria-selected={tab===index}
          aria-controls={`support-panel-${index}`} tabIndex={tab===index ? 0 : -1} onClick={()=>setTab(index)} onKeyDown={event=>{
            let next=index;
            if(event.key==='ArrowRight') next=(index+1)%3;
            else if(event.key==='ArrowLeft') next=(index+2)%3;
            else if(event.key==='Home') next=0;
            else if(event.key==='End') next=2;
            else return;
            event.preventDefault();setTab(next);document.getElementById(`support-tab-${next}`)?.focus();
          }}>{label}</button>)}
      </div>
      <State {...{error,loading}} retry={() => void refresh()}/>
      {message && <p role="status">{message}</p>}
      {data && !error && <>
        {!data.students.length ? <p role="status">No enrolled students in your classrooms.</p> : <>
          <div className="m7-support-controls">
            <label>Find a student<input type="search" value={search} placeholder="Student name" disabled={editing!==null} onChange={e=>setSearch(e.target.value)}/></label>
            {tab===0 ? <label>Show<select value={filter} onChange={e=>setFilter(e.target.value)}>
              <option value="all">All students</option><option value="active">Active warnings and risk</option><option value="history">Students with alert history</option>
            </select></label> : <label>Select Student<select id="support-student" value={student?.id ?? ''} disabled={editing!==null} onChange={e=>selectStudent(e.target.value)}>
              <option value="">Select a student</option>{options.map(s=><option key={s.id} value={s.id}>{studentName(s)}</option>)}
            </select></label>}
          </div>
          {tab!==0 && student && <div className="m7-selected-support"><SupportClassification student={student}/></div>}
          <div role="tabpanel" id="support-panel-0" aria-labelledby="support-tab-0" hidden={tab!==0} tabIndex={0}>
            <details className="m7-support-disclosure"><summary>Understanding Support Levels</summary><RiskGuidance/>
              <p>Eligible quiz scores include independent work and work in your classrooms. Classifications are recalculated from saved quizzes each time this page loads.</p></details>
            {/* Shown only while background alerts are switched on and some are unread; otherwise there is no alert interface. */}
            {data.notificationsActive && data.notifications.length > 0 && <section className="m7-support-alerts" aria-label="New support alerts"><h2>New alerts</h2>
              {actionError && <p role="alert">{actionError}</p>}
              <ul>{data.notifications.map(n => { const s = data.students.find(item => item.id === n.student_id); return <li key={n.id}>
                <button type="button" disabled={editing!==null} onClick={()=>{selectStudent(n.student_id);setShowDetails(true);}}>{s ? studentName(s) : 'Student'}: {n.classification === 'On Track' ? 'Recovered / warning cleared' : n.classification}</button>
                <span>{date(n.occurred_at)}</span>
                <button type="button" className="m7-secondary" onClick={async()=>{setActionError('');try{await m7Request(`/notifications/${n.id}/read`,'PATCH');await refresh();}catch(e){setActionError((e as Error).message);}}}>Mark read</button>
              </li>; })}</ul></section>}
            {!rows.length ? <p role="status">No students match these filters.</p> : <div className="m7-scroll" role="region" aria-label="Students needing support" tabIndex={0}><table>
              <thead><tr><th>Student</th><th>Support classification</th><th>Latest comprehension</th><th>Reading progress</th><th>Actions</th></tr></thead>
              <tbody>{rows.map(s=>{
                const latest = [...s.quizzes].sort((a,b)=>(b.completedAt || '').localeCompare(a.completedAt || ''))[0];
                return <tr key={s.id}><th scope="row">{studentName(s)}</th><td><span className="m7-classification" data-classification={s.classification}>{s.classification}</span></td>
                  <td>{s.invalidCompletedQuizzes ? 'Invalid assessment evidence' : latest ? formatQuizScore(latest) : 'No assessment data'}</td>
                  <td>{s.readingAttempts} saved readings<br/>Accuracy: {percent(s.pronunciationAccuracy)}</td>
                  <td><button type="button" disabled={editing!==null} aria-label={`View details for ${studentName(s)}`} onClick={()=>{selectStudent(s.id);setShowDetails(true);}}>View Details</button></td></tr>;
              })}</tbody></table></div>}
            {student && showDetails && <section aria-label="Student support details"><div className="m7-support-section-heading"><h2>{studentName(student)}</h2><button type="button" onClick={()=>setShowDetails(false)}>Close details</button></div>
              <SupportClassification student={student}/><SupportHistory student={student}/>
              <h3>Assigned reading progress</h3><AssignedProgress student={student}/>
            </section>}
          </div>
          <div role="tabpanel" id="support-panel-1" aria-labelledby="support-tab-1" hidden={tab!==1} tabIndex={0}>
            {!student ? <p>Select a student to view their competency report.</p> : <>
              <section aria-label="Reading and comprehension summary"><h2>Reading and Comprehension Summary</h2><MetricsCards data={student}/></section>
              <section aria-label="Competency performance"><h2>Competency Performance</h2><p>Saved question categories and first answers only.</p>
                <div className="m7-competency-cards">{(['literal','inferential','critical'] as const).map(type=>{
                  const result=student.competency[type];
                  return <article className="m7-card" key={type}><h3>{type[0].toUpperCase()+type.slice(1)}</h3>
                    <strong>{student.invalidCompletedQuizzes ? 'Invalid assessment evidence' : !result || result.total===0 ? 'No data' : formatScore(result.score)}</strong>
                    <p>{result ? `${result.total} assessed questions` : 'No assessed questions available'}</p></article>;
                })}</div>
              </section>
              <section aria-label="Quiz history"><h2>Quiz History</h2><QuizTable quizzes={student.quizzes}/>
                <details className="m7-support-disclosure"><summary>Other Saved Results (not counted)</summary>
                  {student.historicalQuizzes?.length ? <><p>{NOT_COUNTED_NOTE}</p><QuizTable quizzes={student.historicalQuizzes}/></> : <p>No other saved results.</p>}
                </details>
              </section>
              <section aria-label="Assigned reading progress"><h2>Assigned Reading Progress</h2><AssignedProgress student={student}/></section>
            </>}
          </div>
          <div role="tabpanel" id="support-panel-2" aria-labelledby="support-tab-2" hidden={tab!==2} tabIndex={0}>
            {!student ? <p>Select a student to review or record interventions.</p> : <>
              <button type="button" disabled={editing!==null} onClick={()=>{setEditing('new');setMessage('');}}>Record Intervention</button>
              {editing && <InterventionForm teacherLayout key={`${student.id}-${editing==='new' ? 'new' : editing.id}`} studentId={student.id} existing={editing==='new' ? undefined : editing}
                onCancel={()=>setEditing(null)} onSaved={()=>{setEditing(null);setMessage('Intervention saved.');void refresh();}}/>}
              <section aria-label="Intervention history"><h2>Saved Interventions</h2>
                {!student.interventions.length ? <p>No interventions recorded.</p> : <div className="m7-intervention-history">{[...student.interventions].sort((a,b)=>b.intervention_date.localeCompare(a.intervention_date)).map(i=><article className="m7-card" key={i.id}>
                  <div className="m7-support-section-heading"><strong>{date(i.intervention_date)}</strong><span className="m7-intervention-status">{statusLabel(i.status)}</span></div>
                  <p className="m7-notes"><span className="m7-field-label">Intervention details</span>{i.notes}</p>
                  {i.follow_up_date && <p>Follow-up date: {date(i.follow_up_date)}</p>}
                  {i.follow_up_notes && <p className="m7-notes">Follow-up information: {i.follow_up_notes}</p>}
                  <button type="button" disabled={editing!==null} aria-label={`Edit intervention from ${date(i.intervention_date)}`} onClick={()=>{setEditing(i);setMessage('');}}>Edit</button>
                </article>)}</div>}
              </section>
            </>}
          </div>
        </>}
      </>}
    </div>
  </main>;
}
