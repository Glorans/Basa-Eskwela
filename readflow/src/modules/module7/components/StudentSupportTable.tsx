import { Link } from 'react-router-dom';
import { recoveryNote } from '../services/studentSupportClassification';
import { Fragment, useState } from 'react';
import type { SupportStudent } from '../services/m7Service';
import { formatAnalyticsDateTime } from '../services/dateDisplay';
import { formatScore } from '../services/scoreDisplay';

export default function StudentSupportTable({ students }: { students: SupportStudent[] }) {
  const [search, setSearch] = useState(''), [classification, setClassification] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const filtered = students.filter(student => student.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (!classification || student.classification === classification));
  const classifications = [...new Set(['Early Warning', 'At Risk', 'Needs Support', 'Evaluation unavailable', ...students.map(s => s.classification)])];
  return <div className="sp-support">
    <h3>Students needing additional support</h3>
    <div className="sp-support-controls">
      <label>Search students<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by student name" /></label>
      <label>Risk classification<select value={classification} onChange={e => setClassification(e.target.value)}><option value="">All classifications</option>{classifications.map(label => <option key={label}>{label}</option>)}</select></label>
      {(search || classification) && <button type="button" className="m7-secondary" onClick={() => { setSearch(''); setClassification(''); }}>Clear search and status</button>}
    </div>
    <p className="sp-meta" role="status">{filtered.length} of {students.length} students shown</p>
    {!students.length ? <p className="sp-empty">No students with an active warning or risk in the selected scope.</p> : !filtered.length ? <p className="sp-empty">No students match this name and classification. Clear the search or choose another classification.</p> :
      <table className="sp-support-table"><caption className="sp-sr-only">Students needing support, with expandable assessment and intervention details</caption>
        <thead><tr><th scope="col">Student</th><th scope="col">Current status</th><th scope="col">Teacher context</th><th scope="col">Interventions</th><th scope="col">Action</th></tr></thead>
        <tbody>{filtered.map(student => <Fragment key={student.id}>
          <tr>
            <th scope="row" data-label="Student">{student.name}</th>
            <td data-label="Current status"><span className="m7-classification" data-classification={student.classification}>{student.classification}</span></td>
            <td data-label="Teacher context">{student.contexts.map(c => c.teacherName).join(', ') || 'No eligible teacher context'}</td>
            <td data-label="Interventions">{student.interventions.total ? `${student.interventions.total} recorded · ${student.interventions.planned} planned` : 'None recorded'}</td>
            <td data-label="Action"><button type="button" aria-expanded={expanded.has(student.id)} aria-controls={`support-detail-${student.id}`} aria-label={`${expanded.has(student.id) ? 'Hide' : 'View'} details for ${student.name}`} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(student.id)) next.delete(student.id); else next.add(student.id); return next; })}>{expanded.has(student.id) ? 'Hide Details' : 'View Details'}</button></td>
          </tr>
          <tr hidden={!expanded.has(student.id)} className="sp-detail-row"><td colSpan={5}>
            <div id={`support-detail-${student.id}`} className="sp-support-detail" role="region" aria-label={`Details for ${student.name}`}>
              <h4>Teacher context and recent assessments</h4>
              <div className="sp-contexts">{student.contexts.map(context => <article key={context.teacherId}>
                <div className="sp-context-summary"><h5>{context.teacherName}</h5><span className="m7-classification" data-classification={context.classification}>{context.classification}</span>
                  <p>{context.classrooms.join(', ')} · {context.completedQuizzes} completed quizzes</p>
                  {recoveryNote(context.recoveryCount) && <p className="sp-recovery-note">{recoveryNote(context.recoveryCount)}</p>}
                </div>
                <div><h5>Recent comprehension scores (PHT)</h5>
                  {!context.latestScores.length ? <p>No recent assessment evidence available.</p> : <ul className="sp-recent-scores">{context.latestScores.map((score, index) => <li key={index}><strong>{formatScore(score.score)}</strong><span>{formatAnalyticsDateTime(score.completedAt)}</span></li>)}</ul>}
                </div>
              </article>)}</div>
              <div className="sp-support-footer"><div><h5>Recorded interventions</h5>
                <dl className="sp-intervention-counts"><div><dt>Planned</dt><dd>{student.interventions.planned}</dd></div><div><dt>In progress</dt><dd>{student.interventions.inProgress}</dd></div><div><dt>Completed</dt><dd>{student.interventions.completed}</dd></div><div><dt>Total</dt><dd>{student.interventions.total}</dd></div></dl>
              </div><Link className="sp-student-performance-link" to={`/admin/student-performance?studentId=${encodeURIComponent(student.id)}`} aria-label={`View Student Performance for ${student.name}`}>View Student Performance</Link></div>
              <p className="sp-meta">Latest scores per teacher are shown here. Full quiz history and intervention records are available in Student Performance.</p>
            </div>
          </td></tr>
        </Fragment>)}</tbody>
      </table>}
  </div>;
}
