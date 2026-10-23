import { useState } from 'react';
import { allTime, bounds, periodDates, type AnalyticsScope, type Period } from '../services/analyticsFilters';
export default function AnalyticsFilterBar({ rooms, onApply }: { rooms: {id:string; name:string}[]; onApply:(scope:AnalyticsScope)=>void }) {
  const [period,setPeriod] = useState<Period>('all');
  const [scope,setScope] = useState<AnalyticsScope>(allTime);
  const [error,setError] = useState('');
  return <section aria-label="Analytics filters"><form className="m7-form m7-filter-form" onSubmit={event => {event.preventDefault(); try { if (period === 'custom' && (!scope.startDate || !scope.endDate)) throw new Error('Select both custom dates.'); bounds(scope); setError(''); onApply({...scope}); } catch(e) {setError((e as Error).message);} }}>
    <label>Period<select value={period} onChange={e => {const value=e.target.value as Period; setPeriod(value); setScope({...scope,...periodDates(value)});}}>{[['all','All Time'],['weekly','Weekly'],['monthly','Monthly'],['quarterly','Quarterly'],['custom','Custom']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Classroom<select value={scope.roomId} onChange={e=>setScope({...scope,roomId:e.target.value})}><option value="">All Classrooms</option>{rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
    {period !== 'all' && <><label>Start (PHT)<input type="date" required disabled={period !== 'custom'} value={scope.startDate} onChange={e=>setScope({...scope,startDate:e.target.value})}/></label><label>End, inclusive (PHT)<input type="date" required disabled={period !== 'custom'} value={scope.endDate} onChange={e=>setScope({...scope,endDate:e.target.value})}/></label></>}
    <div className="m7-filter-actions"><button type="submit">Apply filters</button> <button className="m7-secondary" type="button" onClick={()=>{setPeriod('all');setScope(allTime);setError('');onApply({...allTime});}}>Reset</button></div>
    {error && <p role="alert">{error}</p>}
  </form><p>Philippine calendar periods; weeks start Monday. All Classrooms retains eligible independent work. Current enrollment and completion snapshots are not historical period results.</p></section>;
}
