import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import AnalyticsFilterBar from "./components/AnalyticsFilterBar";
import StudentCombobox from "./components/StudentCombobox";
import { allTime, type AnalyticsScope } from "./services/analyticsFilters";
import { formatScore } from "./services/scoreDisplay";
import { formatAnalyticsDateTime } from "./services/dateDisplay";
import { assessmentSourceLabel, assessmentSourceNote } from "./services/assessmentSource.ts";
import { getTeacherQuizAttempts } from "./services/teacherQuizService";
import { getActiveClassroomScope, getTeacherAnalytics, getTeacherCompletionAnalytics, type TeacherAnalyticsSummary, type TeacherCompletionAnalytics } from "./services/teacherAnalyticsService";
import { activeCompletion, activeRecords } from "./services/activeClassrooms.ts";
import { getClassPerformance, type ClassPerformanceResult } from "./services/classPerformanceService";
import { getStudentPerformance, type StudentPerformanceResult } from "./services/studentPerformanceService";
import { getQuizScores, type QuizScoreResult } from "./services/quizScoreService";
import "./m7Dashboard.css";
import "./teacherAnalytics.css";
import "./m7Redesign.css";

const panels = ['Class Performance', 'Student Performance', 'Reading Performance Metrics'];
const score = (value: number | null | undefined) => value == null ? 'No results yet' : formatScore(value);
type RoomSort = 'lowest' | 'highest' | 'name';
type RoomRow = TeacherCompletionAnalytics['classrooms'][number];
/** Display order only. Classrooms with no activities assigned have no completion rate and are listed last. */
export function sortClassroomRows(rows: RoomRow[], sort: RoomSort): RoomRow[] {
  const byName = (a: RoomRow, b: RoomRow) => a.roomName.localeCompare(b.roomName) || a.roomId.localeCompare(b.roomId);
  return [...rows].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (a.completionRate === null || b.completionRate === null) return a.completionRate === b.completionRate ? byName(a, b) : a.completionRate === null ? 1 : -1;
    return (sort === 'lowest' ? a.completionRate - b.completionRate : b.completionRate - a.completionRate) || byName(a, b);
  });
}
function ClassroomRow({ room, code, open, onToggle }: { room: RoomRow; code?: string; open: boolean; onToggle: () => void }) {
  const remaining = room.totalAssignments - room.completedAssignments;
  const detailsId = `room-details-${room.roomId}`;
  return <li className="m7r-room">
    <div className="m7r-room-main">
      <div className="m7r-room-name"><strong>{room.roomName}</strong>{code && <small>Code: {code}</small>}</div>
      {room.totalAssignments ? <div className="m7r-room-figures">
        <span>{room.completedAssignments} of {room.totalAssignments} activities completed · {score(room.completionRate)} · {remaining} remaining</span>
        <div className="m7r-progress" role="progressbar" aria-label={`${room.roomName} completion`} aria-valuemin={0} aria-valuemax={room.totalAssignments} aria-valuenow={room.completedAssignments} aria-valuetext={`${room.completedAssignments} of ${room.totalAssignments}`}>
          <span style={{ width: `${Math.min(100, Math.max(0, room.completionRate ?? 0))}%` }} /></div>
      </div> : <div className="m7r-room-figures"><span>No activities assigned</span></div>}
      <button type="button" className="m7-secondary" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>{open ? 'Hide details' : 'Details'}<span className="m7r-sr-only"> for {room.roomName}</span></button>
    </div>
    {open && <dl id={detailsId}>
      <div><dt>Assigned activities</dt><dd>{room.totalAssignments}</dd></div>
      <div><dt>Completed</dt><dd>{room.completedAssignments}</dd></div>
      <div><dt>Remaining</dt><dd>{remaining}</dd></div>
      <div><dt>In progress</dt><dd>{room.inProgressAssignments}</dd></div>
      <div><dt>Not started</dt><dd>{room.notStartedAssignments}</dd></div>
    </dl>}
  </li>;
}
function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <article className="m7-compact-metric"><h3>{label}</h3><strong>{value}</strong>{note && <p>{note}</p>}</article>;
}

export default function TeacherAnalyticsPage() {
  const [scope, setScope] = useState<AnalyticsScope>(allTime);
  const [tab, setTab] = useState(0);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const request = useRef(0);
  const [rooms, setRooms] = useState<{id:string;name:string;code?:string}[]>([]);
  const [roomSort, setRoomSort] = useState<RoomSort>('lowest');
  const [openRooms, setOpenRooms] = useState<Set<string>>(() => new Set());
  const [analytics, setAnalytics] = useState<TeacherAnalyticsSummary | null>(null);
  const [completion, setCompletion] = useState<TeacherCompletionAnalytics | null>(null);
  const [classPerformance, setClassPerformance] = useState<ClassPerformanceResult | null>(null);
  const [studentPerformance, setStudentPerformance] = useState<StudentPerformanceResult | null>(null);
  const [quizScores, setQuizScores] = useState<QuizScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completionError, setCompletionError] = useState('');
  const [classError, setClassError] = useState('');
  const [studentError, setStudentError] = useState('');
  const [quizError, setQuizError] = useState('');
  const [activeRoomCount, setActiveRoomCount] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const loadAnalytics = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError("");
    setCompletionError("");
    setClassError("");
    setStudentError("");
    setQuizError("");

    // All panels use one snapshot per refresh, limited to active (non-archived) classrooms.
    const activeSnapshot = getActiveClassroomScope();
    const loadActive = () => activeSnapshot;
    const quizSnapshot = Promise.all([getTeacherQuizAttempts(), activeSnapshot]).then(([quizzes, active]) => activeRecords(quizzes, active, quiz => quiz.studentId));
    const loadQuizzes = () => quizSnapshot;
    const completionSnapshot = Promise.all([getTeacherCompletionAnalytics(), activeSnapshot]).then(([value, active]) => activeCompletion(value, active));
    const loadCompletion = () => completionSnapshot;

    const [
      activeResult,
      analyticsResult,
      completionResult,
      classResult,
      studentResult,
      quizResult,
    ] = await Promise.allSettled([
      activeSnapshot,
      getTeacherAnalytics(loadQuizzes, scope, loadActive),
      completionSnapshot,
      getClassPerformance(loadQuizzes, loadCompletion, scope),
      getStudentPerformance(loadQuizzes, loadCompletion, scope),
      getQuizScores(loadQuizzes, scope),
    ]);

    if (version !== request.current) return;
    if (activeResult.status === "fulfilled") {
      const active = activeResult.value;
      setActiveRoomCount(active.roomIds.size);
      setRooms(active.rooms);
      // A classroom archived since it was selected: fall back to All Classrooms, keeping the period.
      if (scope.roomId && !active.roomIds.has(scope.roomId)) {
        setNotice("The selected classroom has been archived, so All Classrooms is shown.");
        setScope({ ...scope, roomId: "" });
        return;
      }
    } else {
      setActiveRoomCount(null);
    }

    if (analyticsResult.status === "fulfilled") {
      setAnalytics(analyticsResult.value);
    } else {
      setAnalytics(null);
      setError(
        analyticsResult.reason instanceof Error
          ? analyticsResult.reason.message
          : "Unable to load analytics data."
      );
    }

    if (completionResult.status === "fulfilled") {
      const value = completionResult.value;
      const classrooms = value.classrooms.filter(room => !scope.roomId || room.roomId === scope.roomId);
      const totalAssignments = classrooms.reduce((sum,room)=>sum+room.totalAssignments,0);
      const completedAssignments = classrooms.reduce((sum,room)=>sum+room.completedAssignments,0);
      setCompletion(scope.roomId ? {...value,classrooms,totalClassrooms:classrooms.length,totalAssignments,completedAssignments,incompleteAssignments:totalAssignments-completedAssignments,completionRate:totalAssignments ? Math.round(completedAssignments/totalAssignments*10000)/100 : null} : value);
    } else {
      setCompletion(null);
      setCompletionError(
        completionResult.reason instanceof Error
          ? completionResult.reason.message
          : "Unable to load completion analytics."
      );
    }

    if (classResult.status === "fulfilled") {
      setClassPerformance(classResult.value);
    } else {
      setClassPerformance(null);
      setClassError(
        classResult.reason instanceof Error
          ? classResult.reason.message
          : "Unable to load class performance."
      );
    }

    if (studentResult.status === "fulfilled") {
      setStudentPerformance(studentResult.value);
    } else {
      setStudentPerformance(null);
      setStudentError(
        studentResult.reason instanceof Error
          ? studentResult.reason.message
          : "Unable to load student performance."
      );
    }

    if (quizResult.status === "fulfilled") {
      setQuizScores(quizResult.value);
    } else {
      setQuizScores(null);
      setQuizError(
        quizResult.reason instanceof Error
          ? quizResult.reason.message
          : "Unable to load quiz scores."
      );
    }

    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void loadAnalytics();
    return () => { request.current++; };
  }, [loadAnalytics]);


  const students = useMemo(() => (studentPerformance?.students ?? []).filter(student =>
    !scope.roomId || student.classrooms.some(room => room.roomId === scope.roomId)), [studentPerformance, scope.roomId]);
  // No automatic selection: a Teacher chooses a student. Selection is by unique student ID, never by name.
  const student = students.find(item => item.studentId === selectedStudent);
  // A filter change that leaves the selected student out of scope clears the selection and its details.
  const selectedInScope = !selectedStudent || !studentPerformance || students.some(item => item.studentId === selectedStudent);
  useEffect(() => {
    if (!loading && !selectedInScope) { setSelectedStudent(''); setDetailsOpen(false); }
  }, [loading, selectedInScope]);
  // Stable between renders, so an open dropdown keeps the typed text while the page re-renders.
  const studentOptions = useMemo(() => students.map(item => ({ id: item.studentId, name: item.studentName, detail: item.classrooms.map(room => room.roomName).join(', ') || undefined })), [students]);
  const quizzes = quizScores?.students.find(item => item.studentId === student?.studentId);
  const visibleErrors = tab === 0 ? [error, completionError, classError] : tab === 1 ? [studentError, quizError] : [error];

  return <main className="m7-dashboard m7-teacher-dashboard m7r" aria-label="Analytics">
    <header className="m7r-header"><div><h1>Analytics</h1><p>Track classroom progress, student results, and reading performance.</p></div>
      <button className="m7-refresh-icon" type="button" aria-label="Refresh analytics" title="Refresh analytics" disabled={loading} onClick={() => void loadAnalytics()}>
        <RefreshCw size={18} aria-hidden="true" className={loading ? 'm3-spinner' : ''} />
      </button></header>
    <div className="m7-dashboard-content">
      <div role="tablist" aria-label="Teacher analytics sections" className="m7r-tabs">
        {panels.map((label, index) => <button type="button" key={label} role="tab" id={`analytics-tab-${index}`}
          aria-selected={tab === index} aria-controls={`analytics-panel-${index}`} tabIndex={tab === index ? 0 : -1}
          onClick={() => setTab(index)} onKeyDown={event => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % 3;
            else if (event.key === 'ArrowLeft') next = (index + 2) % 3;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = 2;
            else return;
            event.preventDefault(); setTab(next); document.getElementById(`analytics-tab-${next}`)?.focus();
          }}><span>{label}</span></button>)}
      </div>
      <div role="tabpanel" id={`analytics-panel-${tab}`} aria-labelledby={`analytics-tab-${tab}`} tabIndex={0} aria-busy={loading}>
        <AnalyticsFilterBar rooms={rooms} showExplanation={false} resetMissingRoom onApply={value => { request.current++; setNotice(''); setScope(value); setDetailsOpen(false); }} />
        {notice && <p role="status">{notice}</p>}
        {visibleErrors.filter(Boolean).map((message, index) => <p key={index} role="alert" className="m3-error-message">{message} Use Refresh to try again.</p>)}
        {loading ? <p role="status">Loading analytics...</p> : activeRoomCount === 0 ? <p role="status" className="m7-no-active-rooms">
          No active classrooms. Analytics shows active classrooms only; archived classrooms and their past results remain available in <Link to="/m3/teacher/archived-classrooms">Archived Classrooms</Link>.
        </p> : <>
          {tab === 0 && <>
            <div className="m7-compact-metrics">
              <Metric label="Enrolled Students" value={classPerformance?.totalEnrolledStudents ?? 'Unavailable'} note="Current enrollment; each student counted once." />
              <Metric label="Activity Completion" value={completion ? `${completion.completedAssignments} of ${completion.totalAssignments}` : 'Unavailable'} note={completion ? completion.totalAssignments ? `${score(completion.completionRate)} completed from saved assessment evidence.` : 'No activities assigned.' : 'Completion could not be loaded.'} />
              <Metric label="Class Average Reading Accuracy" value={analytics ? score(analytics.averagePronunciationAccuracy) : 'Unavailable'} note="Period-filtered transcript-based accuracy." />
              <Metric label="Class Average Comprehension" value={analytics ? score(analytics.averageComprehensionScore) : 'Unavailable'} note="Period-filtered first-answer scores." />
            </div>
            {analytics && (scope.roomId || analytics.independentComprehensionAttempts > 0) && <p>{assessmentSourceNote(Boolean(scope.roomId), analytics.independentComprehensionAttempts)}</p>}
            {analytics && analytics.totalReadingAttempts === 0 && analytics.completedComprehensionAttempts === 0 && <p role="status">No assessment results in this period.</p>}
            {classPerformance?.totalClassrooms === 0 && <p role="status">No classrooms found.</p>}
            {completion && completion.classrooms.length > 0 && <section className="m7r-section" aria-label="Completion by Classroom">
              <div className="m7r-section-head"><h2>Completion by Classroom</h2>
                <label className="m7r-select">Sort<select value={roomSort} onChange={event => setRoomSort(event.target.value as RoomSort)}>
                  <option value="lowest">Lowest completion first</option><option value="highest">Highest completion first</option><option value="name">Classroom name</option>
                </select></label></div>
              <ul className="m7r-rooms">{sortClassroomRows(completion.classrooms, roomSort).map(room => <ClassroomRow key={room.roomId} room={room}
                code={rooms.find(item => item.id === room.roomId)?.code} open={openRooms.has(room.roomId)}
                onToggle={() => setOpenRooms(current => { const next = new Set(current); if (next.has(room.roomId)) next.delete(room.roomId); else next.add(room.roomId); return next; })} />)}</ul>
              <p className="m7r-note">Current activity completion from saved assessment evidence. Completion shows assigned work finished, not reading ability.</p>
            </section>}
          </>}
          {tab === 1 && <>
            <div className="m7-performance-controls">
              <StudentCombobox id="teacher-student" value={student?.studentId ?? ''} options={studentOptions} disabled={!students.length}
                placeholder="Type a name or choose a student..." onChange={value => { setSelectedStudent(value); setDetailsOpen(false); }} />
            </div>
            {!studentPerformance ? <p>Student progress could not be loaded.</p> : !students.length ? <p role="status">No enrolled students yet in this view.</p> : !student ? <p role="status" className="m7r-empty">Choose a student from the dropdown to view their performance.</p> : <article key={student.studentId}>
              <p>Activity completion is current. Assessment results reflect the selected classroom and period.</p>
              <div className="m7-compact-metrics">
                <Metric label="Completed Activities" value={`${student.completedAssignments} of ${student.totalAssignments}`} note={student.totalAssignments ? `${score(student.completionRate)} complete.` : 'No activities assigned.'} />
                <Metric label="Reading Accuracy" value={score(student.averagePronunciationAccuracy)} note={`${student.readingAttempts} saved reading attempts.`} />
                <Metric label="Comprehension" value={score(student.averageComprehensionScore)} note={`${student.completedComprehensionAttempts} completed assessments.`} />
                <Metric label="Reading Speed" value={student.averageReadingSpeedWpm === null ? 'No results yet' : `${student.averageReadingSpeedWpm} WPM`} note="Recorded words per minute." />
              </div>
              <button type="button" aria-label={`View progress for ${student.studentName}`} aria-expanded={detailsOpen} aria-controls="student-progress-details" onClick={() => setDetailsOpen(value => !value)}>View Progress</button>
              {detailsOpen && <section id="student-progress-details" aria-label="Student progress details">
                <h3>Reading and assignment details</h3>
                <p>Reading speed: {student.averageReadingSpeedWpm === null ? 'No results yet' : `${student.averageReadingSpeedWpm} WPM`}. In progress: {student.inProgressAssignments}. Not started: {student.notStartedAssignments}. Incomplete: {student.incompleteAssignments}.</p>
                {student.classrooms.map(room => <p key={room.roomId}>{room.roomName}: {room.completedAssignments} of {room.totalAssignments} activities completed.</p>)}
                <h3>Comprehension history</h3>
                <p>Each assessment counts the one final answer given to each question.</p>
                {quizScores && <p>{assessmentSourceNote(Boolean(scope.roomId), quizScores.independentQuizzes)}</p>}
                {!quizScores ? <p>History could not be loaded.</p> : !quizzes ? <p>No completed assessments in this period.</p> : <>
                  <p>Average: {score(quizzes.averageScore)}; Highest: {score(quizzes.highestScore)}; Lowest: {score(quizzes.lowestScore)}</p>
                  <div className="m7-scroll" role="region" aria-label="Comprehension history" tabIndex={0}><table><thead><tr><th>Activity</th><th>Source</th><th>Completed (PHT)</th><th>First-answer score</th></tr></thead><tbody>{quizzes.scores.map(result => <tr key={result.attemptId}><td>{result.moduleTitle}</td><td>{assessmentSourceLabel(result, rooms)}</td><td>{formatAnalyticsDateTime(result.completedAt)}</td><td>{score(result.scorePercentage)} ({result.correctAnswers}/{result.totalQuestions})</td></tr>)}</tbody></table></div>
                </>}
              </section>}
            </article>}
          </>}
          {tab === 2 && analytics && <>
            <div className="m7-compact-metrics">
              <Metric label="Reading Attempts" value={analytics.totalReadingAttempts} note="Recorded oral-reading attempts." />
              <Metric label="Students with Results" value={analytics.studentsWithResults} />
              <Metric label="Average Reading Accuracy" value={score(analytics.averagePronunciationAccuracy)} note="Existing transcript-based reading accuracy." />
              <Metric label="Average Reading Speed" value={analytics.averageReadingSpeedWpm === null ? 'No results yet' : `${analytics.averageReadingSpeedWpm} WPM`} note="Recorded words per minute." />
            </div>
            {analytics.totalReadingAttempts === 0 && <p role="status">No saved reading results in this period.</p>}
          </>}
        </>}
      </div>
    </div>
  </main>;
}
