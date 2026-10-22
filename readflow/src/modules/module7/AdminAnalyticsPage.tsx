import { useEffect, useState } from 'react';
import { m7Request, type AdminSystemData } from './services/m7Service';
import { AdminMetrics, PerformanceSections, ParticipationSection, RiskSection } from './components/AdminAnalyticsSections';
import './m7.css';

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AdminSystemData | null>(null);
  const [roomId, setRoomId] = useState(''), [startDate, setStartDate] = useState(''), [endDate, setEndDate] = useState('');
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
  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    if (startDate && endDate && startDate > endDate) { setError('Start date must be on or before end date.'); return; }
    const params = new URLSearchParams();
    if (roomId) params.set('roomId', roomId);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    setQuery(params.size ? `?${params.toString()}` : ''); setRevision(value => value + 1);
  }
  return <main className="m7-page">
    <h1>System Performance</h1><p>System-wide totals from saved records. Scores include completed quizzes only.</p>
    {data && <><h2>System-wide totals · all time</h2><div className="m7-metrics">{[['Students', data.students], ['Teachers', data.teachers], ['Classrooms', data.classrooms], ['Assigned reading activities', data.assignedActivities]].map(([label, value]) => <div className="m7-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><AdminMetrics data={data} /></>}
    <section><h2>Detailed analytics filters</h2><form className="m7-form" onSubmit={applyFilters}>
      <label>Classroom<select value={roomId} onChange={e => setRoomId(e.target.value)}><option value="">All classrooms and independent work</option>{data?.details.classroomOptions.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <label>From (Philippine time)<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
      <label>Through (Philippine time)<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
      <div><button disabled={loading}>Apply filters</button> <button type="button" disabled={loading} onClick={() => { setRoomId(''); setStartDate(''); setEndDate(''); setQuery(''); setRevision(value => value + 1); }}>Reset</button></div>
    </form><p>Leave dates blank for all available history. Filters affect the sections below; system-wide totals remain unchanged.</p></section>
    {loading && <p role="status">Loading analytics…</p>}
    {error && <div role="alert" className="m7-error">{error} <button onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {data && !loading && !error && <>
      <p>Applied scope: {data.details.filters.roomId ? data.details.classroomOptions.find(r => r.id === data.details.filters.roomId)?.name : 'All classrooms and independent work'}; {data.details.filters.startDate || 'earliest record'} through {data.details.filters.endDate || 'latest record'}. Generated {new Date(data.details.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT.</p>
      <PerformanceSections data={data.details} /><ParticipationSection data={data.details} /><RiskSection data={data.details} />
    </>}
  </main>;
}
