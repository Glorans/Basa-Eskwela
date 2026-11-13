import { Award, Flame, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { m7Request, PERSONAL_PROGRESS_TIMEOUT_MS, type PersonalData } from "../../modules/module7/services/m7Service";
import { formatScore } from "../../modules/module7/services/scoreDisplay";
import { getMyGamification } from "../../modules/module8/gamificationService";
import { comprehensionResultTarget } from "../../modules/module5/services/comprehensionNavigation";
import { DashboardSection, EmptyState, StatCard, formatDate, valueOf, type Load } from "./DashboardKit";

type LearnerRole = "student" | "general_user";

/** The signed-in learner's own records (GET /api/analytics/personal: own readings and counted assessments). */
// A stalled request ends after the shared progress timeout and shows the dashboard's error state.
export const loadPersonal = () => m7Request<PersonalData>("/personal", "GET", undefined, { timeoutMs: PERSONAL_PROGRESS_TIMEOUT_MS });
/** Existing M8 summary (m8_learner_progress and badges). Personal-upload practice earns none by design. */
export const loadGamification = () => getMyGamification();
export type Gamification = Awaited<ReturnType<typeof getMyGamification>>;

const readingResultPath = (role: LearnerRole, id: string) =>
  `${role === "student" ? "/dashboard" : "/m3/general"}/read-aloud/results/${encodeURIComponent(id)}`;

/** XP, current streak and claimed badges from M8 (no new reward rules). */
export function RewardCards({ role, gamification }: { role: LearnerRole; gamification: Load<Gamification> }) {
  const root = role === "student" ? "/dashboard" : "/m3/general";
  return (
    <>
      <StatCard icon={Star} value={valueOf(gamification, (g) => g.progress?.total_xp ?? 0)} label="Total XP" to={`${root}/progress`} />
      <StatCard icon={Flame} value={valueOf(gamification, (g) => g.progress ? `${g.progress.current_streak} day${g.progress.current_streak === 1 ? "" : "s"}` : "0 days")} label="Reading streak" />
      <StatCard icon={Award} value={valueOf(gamification, (g) => g.badges.filter((b) => b.state === "claimed").length)} label="Badges earned" to={`${root}/badges`} />
    </>
  );
}

const latest = <T,>(items: T[], date: (item: T) => string | null) =>
  [...items].filter((i) => date(i)).sort((a, b) => String(date(b)).localeCompare(String(date(a))))[0];
/** The learner's most recently saved oral reading, or undefined. */
export const latestReading = (data: PersonalData) => latest(data.readings ?? [], (r) => r.completed_at);

/** Most recent saved M5 reading and most recent counted M6 assessment. */
export function RecentResults({ role, personal }: { role: LearnerRole; personal: Load<PersonalData> }) {
  if (personal.status === "loading") return <DashboardSection title="Recent results"><p className="rd-muted" role="status">Loading...</p></DashboardSection>;
  if (personal.status === "error") {
    return <DashboardSection title="Recent results"><p className="rd-error" role="alert">Your recent results could not be loaded. Open Reading History to see them.</p></DashboardSection>;
  }
  const reading = latestReading(personal.data);
  const quiz = latest((personal.data.quizzes ?? []).filter((q) => !q.notCounted), (q) => q.completedAt);
  return (
    <DashboardSection title="Recent results">
      {!reading && !quiz ? (
        <EmptyState>No saved results yet. Your reading and comprehension results will appear here after your first activity.</EmptyState>
      ) : (
        <ul className="rd-list">
          {reading && (
            <li>
              <span><strong>Oral reading</strong> <span className="rd-muted">{formatDate(reading.completed_at)}</span></span>
              <span>{formatScore(Math.round(Number(reading.pronunciation_accuracy)))} accuracy · <Link to={readingResultPath(role, reading.id)}>View</Link></span>
            </li>
          )}
          {quiz && (
            <li>
              <span><strong>Comprehension</strong> <span className="rd-muted">{quiz.title}</span></span>
              <span>{formatScore(quiz.score === null ? null : Math.round(quiz.score))} · <Link to={comprehensionResultTarget(role, quiz.id)}>View</Link></span>
            </li>
          )}
        </ul>
      )}
    </DashboardSection>
  );
}
