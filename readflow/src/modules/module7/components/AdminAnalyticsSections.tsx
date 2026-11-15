import type { AdminRoomLabel } from '../services/adminClassroomLabels';
import { useState } from 'react';
import PerformanceSelector from './PerformanceSelector';
import { RiskGuidance } from '../M7Pages';
import { formatAnalyticsDate as displayDate } from '../services/dateDisplay';
export { formatAnalyticsDate as displayDate } from '../services/dateDisplay';
import { formatScore, formatComprehension } from '../services/scoreDisplay';
import type { AdminSystemData, Metrics } from '../services/m7Service';
export const percentage = (value: number | null) => value === null ? 'No data' : formatScore(value);
const number = (value: number | null) => value === null ? 'No data' : value.toLocaleString();
export function AdminMetrics({ data }: { data: Metrics }) {
  const entries = [['Saved readings', data.readingAttempts], ['Completed quizzes', data.completedQuizzes],
    ['Comprehension', formatComprehension(data)], ['Reading accuracy', percentage(data.pronunciationAccuracy)],
    ['Reading speed', data.readingSpeedWpm === null ? 'No data' : `${data.readingSpeedWpm} WPM`]];
  return <div className="m7-metrics">{entries.map(([label, value]) => <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}
type Details = AdminSystemData['details'];
export function PerformanceSections({ data, labels = [] }: { data: Details; labels?: AdminRoomLabel[] }) {
  const roomLabel = (room: {id:string;name:string;teacherName:string}) => labels.find(label => label.id === room.id)?.label ?? `${room.name} \u2014 ${room.teacherName}`;
  const [selectedClassroom, setSelectedClassroom] = useState('');
  const selected = data.classroomComparisons.find(room => room.id === selectedClassroom) ?? data.classroomComparisons[0];
  return <>
    <section><h2>Performance in the selected period</h2><AdminMetrics data={data.performance} />
      {!data.performance.readingAttempts && !data.performance.completedQuizzes && <p>No saved results match these filters.</p>}
      {!data.filters.roomId && <p>Includes {data.independentPerformance.readingAttempts} Student readings and {data.independentPerformance.completedQuizzes} Student quizzes completed outside a classroom assignment.</p>}
      {data.unassignedClassroomReadings > 0 && <p>{data.unassignedClassroomReadings} readings reference classrooms that are no longer available. They remain included in system totals.</p>}
    </section>
    <section><h2>Weekly performance trends</h2><p>Weeks start Monday in Philippine time. Averages use saved attempts, with sample counts shown. Weeks without results are omitted; no scores are inferred.</p>
      {!data.trends.length ? <p>No results available for a trend.</p> : <div className="m7-scroll"><table><thead><tr><th>Week starting</th><th>Readings</th><th>Reading accuracy</th><th>Speed (WPM)</th><th>Quizzes</th><th>Comprehension</th></tr></thead><tbody>{data.trends.map(row => <tr key={row.weekStart}><td>{displayDate(row.weekStart)}</td><td>{row.readingAttempts}</td><td>{percentage(row.pronunciationAccuracy)}</td><td>{number(row.readingSpeedWpm)}</td><td>{row.completedQuizzes}</td><td>{formatComprehension(row)}</td></tr>)}</tbody></table></div>}
    </section>
    <section><h2>Classroom comparisons</h2><p>Results are attributed by their saved classroom ID. Participation uses current enrollment; students enrolled in multiple rooms may appear in each room.</p>
      {!!data.classroomComparisons.length && <>
        {!data.filters.roomId && <div className="m7-performance-controls">
          <PerformanceSelector id="admin-classroom" label="Select Classroom" value={selected?.id ?? ''}
            options={data.classroomComparisons.map(room => ({ id: room.id, name: roomLabel(room) }))}
            onChange={setSelectedClassroom} describedBy="admin-classroom-scope" />
        </div>}
        <p id="admin-classroom-scope" className="m7-performance-scope">This selection changes only the classroom detail below. System-wide totals, global filters and classroom comparisons retain their existing scope.</p>
        {selected && <article aria-labelledby="admin-classroom-detail">
          <h3 id="admin-classroom-detail">{roomLabel(selected)}</h3>
          <AdminMetrics data={selected} />
          <div className="m7-metrics">{[['Enrolled Students', selected.enrolledStudents], ['Participating Students', selected.participatingStudents],
            ['Completed / assigned', `${selected.completed} / ${selected.assigned}`], ['Completion Rate', percentage(selected.completionRate)],
            ['Incomplete Assignments', selected.incomplete]].map(([label, value]) => <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
          {!selected.readingAttempts && !selected.completedQuizzes && <p>No saved results for this classroom in the selected period.</p>}
        </article>}
      </>}
      {!data.classroomComparisons.length && <p>No classrooms available.</p>}
      <details><summary>Compare classrooms</summary>
      {!data.classroomComparisons.length ? <p>No classrooms available.</p> : <div className="m7-scroll"><table><thead><tr><th>Classroom / teacher</th><th>Participating / enrolled</th><th>Readings</th><th>Reading accuracy</th><th>Speed (WPM)</th><th>Quizzes</th><th>Comprehension</th><th>Completed / assigned</th></tr></thead><tbody>{data.classroomComparisons.map(row => <tr key={row.id}><td>{roomLabel(row)}</td><td>{row.participatingStudents} / {row.enrolledStudents}</td><td>{row.readingAttempts}</td><td>{percentage(row.pronunciationAccuracy)}</td><td>{number(row.readingSpeedWpm)}</td><td>{row.completedQuizzes}</td><td>{formatComprehension(row)}</td><td>{row.completed} / {row.assigned} ({percentage(row.completionRate)})</td></tr>)}</tbody></table></div>}
      </details>
    </section>
  </>;
}
export function ParticipationSection({ data }: { data: Details }) {
  const p = data.participation, c = data.completion;
  return <section><h2>Student participation and assignment completion</h2>
    <p>Participation means at least one saved reading or completed quiz in the selected period. The denominator is current students, or current classroom enrollment when filtered.</p>
    <div className="m7-metrics">{[['Participating students', p.participatingStudents], ['Students in scope', p.students], ['Without recorded activity', p.withoutRecordedActivity], ['Participation rate', percentage(p.participationRate)]].map(([label, value]) => <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p>Current completion of reading activities assigned during the selected period: <strong>{c.completed} / {c.assigned}</strong> ({percentage(c.completionRate)}). {c.incomplete} remain incomplete.</p>
    <p>Completion requires saved assessment evidence. This is a current snapshot, not completion as of the reporting-period end.</p>
    {!c.assigned && <p>No reading assignments match these filters.</p>}
  </section>;
}
export function RiskSection({ data }: { data: Details }) {
  return <section><h2>Current risk and learning support</h2>
    <RiskGuidance />
    <p>Uses full quiz history regardless of reporting dates. Each student is counted once at their highest-priority classification across relevant approved teachers. Classroom selection chooses students and the classroom's teacher; that teacher's full eligible quiz history is retained.</p>
    <p>No assessment data means no completed quizzes in an eligible approved-teacher context. Students without such a context are not assumed to be On Track.</p>
    <div className="m7-metrics">{Object.entries(data.riskCounts).map(([label, count]) => <div className="m7-card" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
    <h3>Students needing additional support</h3>
    {!data.supportStudents.length ? <p>No students with an active warning or risk in the selected scope.</p> : <div className="m7-scroll"><table><thead><tr><th>Student</th><th>Current classification</th><th>Teacher context and recent scores</th><th>Interventions</th></tr></thead><tbody>{data.supportStudents.map(student => <tr key={student.id}>
      <td>{student.name}</td><td>{student.classification}</td>
      <td>{student.contexts.map(context => <details key={context.teacherId}><summary>{context.teacherName}: {context.classification}</summary><p>{context.classrooms.join(', ')} · {context.completedQuizzes} completed quizzes</p><ul>{context.latestScores.map((score, index) => <li key={index}>{formatScore(score.score)} — {displayDate(score.completedAt)}</li>)}</ul></details>)}</td>
      <td>{student.interventions.total ? `${student.interventions.planned} planned, ${student.interventions.inProgress} in progress, ${student.interventions.completed} completed` : 'None recorded'}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
