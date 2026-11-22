import { getClassroomById } from '../module4/services/classroomService';
import { loadAdminClassroomLabels, type AdminRoomLabel } from './services/adminClassroomLabels';
import AnalyticsFilterBar from "./components/AnalyticsFilterBar";
import { useEffect, useRef, useState } from 'react';
import { m7Request, type AdminSystemData } from './services/m7Service';
import { AdminMetrics, MetricCard, OverviewSection, PerformanceTrendsSection, PerformanceSections, ParticipationSection, RiskSection } from './components/AdminAnalyticsSections';
import './m7.css';
import './m7Dashboard.css';
import './systemPerformance.css';
import SystemPerformanceTabs, { SYSTEM_PERFORMANCE_TABS } from './components/SystemPerformanceTabs';
import { formatAnalyticsDate, formatAnalyticsDateTime } from './services/dateDisplay';

export default function AdminAnalyticsPage() {
  const [tab, setTab] = useState(0);
  const roomLabels = useRef<AdminRoomLabel[]>([]);
  const [labels, setLabels] = useState<AdminRoomLabel[]>([]);
  const [data, setData] = useState<AdminSystemData | null>(null);
  const [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    m7Request<AdminSystemData>(`/system${query}`).then(async result => {
      const next = await loadAdminClassroomLabels(result.details, getClassroomById, roomLabels.current);
      if (active) { roomLabels.current = next; setLabels(next); setData(result); }
    })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load analytics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, revision]);
  return <main className="m7-page m7-dashboard m7-admin-dashboard sp-dashboard">
    <header className="m7-dashboard-header m7-header-card"><div><h1>System Performance</h1><p>Understand learning progress, participation and where support is needed.</p></div></header>
    <div className="m7-dashboard-content">
      <AnalyticsFilterBar showExplanation={false} rooms={labels.map(room => ({id:room.id,name:room.label}))} onApply={scope=>{const params=new URLSearchParams();if(scope.roomId)params.set('roomId',scope.roomId);if(scope.startDate)params.set('startDate',scope.startDate);if(scope.endDate)params.set('endDate',scope.endDate);setQuery(params.size ? `?${params}` : '');setRevision(value=>value+1);}}/>
      {data && !loading && !error && <div className="sp-applied-scope">
        <p><strong>Showing:</strong> {data.details.filters.roomId ? labels.find(r => r.id === data.details.filters.roomId)?.label || 'Selected classroom' : 'All classrooms and independent work'} · {data.details.filters.startDate ? formatAnalyticsDate(data.details.filters.startDate) : 'Earliest record'} through {data.details.filters.endDate ? formatAnalyticsDate(data.details.filters.endDate) : 'latest record'} (PHT)</p>
        <span>Updated {formatAnalyticsDateTime(data.details.generatedAt)} PHT</span>
      </div>}
      <SystemPerformanceTabs value={tab} onChange={setTab} />
      {loading && <p role="status" className="sp-empty">Loading analytics…</p>}
      {error && <div role="alert" className="m7-error">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
      {/* Keep panels mounted between tab changes so local selectors, search and disclosures survive. */}
      {SYSTEM_PERFORMANCE_TABS.map((label, index) => <div key={label} id={`system-panel-${index}`} role="tabpanel" aria-labelledby={`system-tab-${index}`} tabIndex={0} hidden={tab !== index} aria-busy={loading}>
        {data && <div hidden={loading || !!error}>
          {index === 0 && <>
            <section><div className="sp-section-heading"><h2>System-wide summary</h2><span className="sp-scope-tag">All time · unaffected by filters</span></div>
              <div className="m7-metrics sp-system-cards">{[['Total students', data.students], ['Total teachers', data.teachers], ['Total classrooms', data.classrooms], ['Assigned reading activities', data.assignedActivities]].map(([label, value]) => <MetricCard key={label} label={String(label)} value={value} />)}</div>
              <details className="sp-all-time"><summary>All-time reading and quiz performance</summary><AdminMetrics data={data} /></details>
            </section>
            <OverviewSection data={data.details} />
          </>}
          {index === 1 && <PerformanceTrendsSection data={data.details} />}
          {index === 2 && <PerformanceSections data={data.details} labels={labels} />}
          {index === 3 && <ParticipationSection data={data.details} />}
          {index === 4 && <RiskSection data={data.details} />}
        </div>}
      </div>)}
    </div>
  </main>;
}
