import AnalyticsFilterBar from "./components/AnalyticsFilterBar";
import { useEffect, useState } from 'react';
import { m7Request, type AdminSystemData } from './services/m7Service';
import { AdminMetrics, PerformanceSections, ParticipationSection, RiskSection } from './components/AdminAnalyticsSections';
import './m7.css';
import './m7Dashboard.css';

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AdminSystemData | null>(null);
  const [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    m7Request<AdminSystemData>(`/system${query}`).then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load analytics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, revision]);
  return <main className="m7-page m7-dashboard">
    <header className="m7-dashboard-header"><div><h1>System Performance</h1><p>System-wide totals from saved records. Scores include completed quizzes only.</p></div></header>
      <div className="m7-dashboard-content">
    {data && <><h2>System-wide totals · all time</h2><div className="m7-metrics">{[['Students', data.students], ['Teachers', data.teachers], ['Classrooms', data.classrooms], ['Assigned reading activities', data.assignedActivities]].map(([label, value]) => <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><AdminMetrics data={data} /></>}
    <AnalyticsFilterBar rooms={data?.details.classroomOptions || []} onApply={scope=>{const params=new URLSearchParams();if(scope.roomId)params.set('roomId',scope.roomId);if(scope.startDate)params.set('startDate',scope.startDate);if(scope.endDate)params.set('endDate',scope.endDate);setQuery(params.size ? `?${params}` : '');setRevision(value=>value+1);}}/>
    {loading && <p role="status">Loading analytics…</p>}
    {error && <div role="alert" className="m7-error">{error} <button onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {data && !loading && !error && <>
      <p>Applied scope: {data.details.filters.roomId ? data.details.classroomOptions.find(r => r.id === data.details.filters.roomId)?.name : 'All classrooms and independent work'}; {data.details.filters.startDate || 'earliest record'} through {data.details.filters.endDate || 'latest record'}. Generated {new Date(data.details.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT.</p>
      <PerformanceSections data={data.details} /><ParticipationSection data={data.details} /><RiskSection data={data.details} />
    </>}
      </div>
  </main>;
}
