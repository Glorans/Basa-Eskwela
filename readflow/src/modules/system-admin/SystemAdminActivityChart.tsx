import { formatAnalyticsDate } from "../module7/services/dateDisplay";

type Week = { weekStart: string; readings: number; completedQuizzes: number };
/** Presentation only: plot the same API counts as the accompanying weekly table. */
export default function SystemAdminActivityChart({ weeks }: { weeks: Week[] }) {
  if (!weeks.length) return null;
  const recent = weeks.slice(-8);
  const maximum = Math.max(1, ...recent.flatMap(week => [week.readings, week.completedQuizzes]));
  return <figure className="sa-activity-chart" aria-label="Weekly readings and completed quizzes">
    <figcaption><strong>Activity by week</strong><span>Up to eight most recent recorded weeks</span></figcaption>
    <div className="sa-chart-legend"><span><i />Saved readings</span><span><i />Completed quizzes</span></div>
    <div className="sa-chart-weeks">{recent.map(week => <div className="sa-chart-week" key={week.weekStart}>
      <span className="sa-chart-date">{formatAnalyticsDate(week.weekStart)}</span>
      <div className="sa-chart-bars">
        <div><span className="sa-chart-track"><span style={{ width: `${week.readings / maximum * 100}%` }} /></span><span aria-label={`${week.readings} saved readings`}>{week.readings}</span></div>
        <div><span className="sa-chart-track"><span style={{ width: `${week.completedQuizzes / maximum * 100}%` }} /></span><span aria-label={`${week.completedQuizzes} completed quizzes`}>{week.completedQuizzes}</span></div>
      </div>
    </div>)}</div>
  </figure>;
}
