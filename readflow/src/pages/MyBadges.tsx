
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import {
  Star,
  Flame,
  BookOpenCheck,
  ArrowUpCircle,
  Mic,
  Gem,
  GraduationCap,
  CalendarCheck,
  Award,
  Lock,
  CheckCircle2,
} from "lucide-react";

import {
  getMyAchievements,
  getMyGamification,
} from "../modules/module8/gamificationService";

import type {
  Badge,
  LearnerProgress,
  MilestoneRow,
  ReadingSummary,
} from "../modules/module8/gamificationService";
import {
  ACHIEVEMENT_GUIDE,
  achievementProgress,
  earnedDate,
  MILESTONE_GUIDE,
  milestoneProgress,
  type AchievementStats,
} from "../modules/module8/achievements";

// ========================================
// BADGE ICONS
// ========================================

const badgeIcons = {
  Star,
  Flame,
  BookOpenCheck,
  ArrowUpCircle,
  Mic,
  Gem,
  GraduationCap,
  CalendarCheck,
} as const;

function BadgeIcon({ name }: { name: string }) {
  const Icon =
    badgeIcons[name as keyof typeof badgeIcons] ?? Award;

  return <Icon size={42} strokeWidth={1.8} />;
}

// ========================================
// BADGES COMPONENT
// ========================================

export default function MyBadges() {
  const [progress, setProgress] =
    useState<LearnerProgress | null>(null);

  const [badges, setBadges] = useState<Badge[]>([]);
  const [stats, setStats] = useState<AchievementStats | null>(null);
  const [reading, setReading] = useState<ReadingSummary | null>(null);
  const [milestones, setMilestones] = useState<MilestoneRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadGamification() {
      try {
        setLoading(true);
        setError("");

        const result = await getMyGamification();

        if (!active) return;

        setProgress(result.progress);
        setBadges(result.badges);
        setStats(result.stats);
        setReading(result.reading);

        // Optional: the badges still show if achievements cannot load.
        const achieved = await getMyAchievements().catch(() => null);
        if (active) setMilestones(achieved);
      } catch (err) {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load your achievements."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadGamification();

    return () => {
      active = false;
    };
  }, []);

  const earnedBadges = badges.filter(
    (badge) => badge.earned
  ).length;

  // ========================================
  // LOADING STATE
  // ========================================

  if (loading) {
    return (
      <main style={containerStyle}>
        <h1 style={mainTitleStyle}>
          🏆 My Achievements
        </h1>
        <p>Loading your badges...</p>
      </main>
    );
  }

  // ========================================
  // ERROR STATE
  // ========================================

  if (error) {
    return (
      <main style={containerStyle}>
        <h1 style={mainTitleStyle}>
          🏆 My Achievements
        </h1>
        <p role="alert" style={{ color: "#dc2626" }}>
          {error}
        </p>
      </main>
    );
  }

  // ========================================
  // MAIN PAGE
  // ========================================

  return (
    <main style={containerStyle}>
      {/* MAIN HEADING */}
      <h1 style={mainTitleStyle}>
        🏆 My Achievements
      </h1>

      <p style={subtitleStyle}>
        Badges mark what you have done. Achievements show how well you read and understand over time. Earned badges stay saved on your account.
      </p>

      {/* GAMIFICATION STATISTICS */}
      <section style={statsGridStyle}>
        <div style={statCardStyle}>
          <span style={statLabelStyle}>
            ⭐ Total XP
          </span>
          <strong style={statValueStyle}>
            {(progress?.total_xp ?? 0).toLocaleString()}
          </strong>
        </div>

        <div style={statCardStyle}>
          <span style={statLabelStyle}>
            🔥 Current Streak
          </span>
          <strong style={statValueStyle}>
            {progress?.current_streak ?? 0} {(progress?.current_streak ?? 0) === 1 ? "day" : "days"}
          </strong>
          <small style={statNoteStyle}>
            Longest: {progress?.longest_streak ?? 0} {(progress?.longest_streak ?? 0) === 1 ? "day" : "days"}
          </small>
          {reading && !reading.readToday && (progress?.current_streak ?? 0) > 0 && (
            <small style={statNoteStyle}>Read today to keep your streak going!</small>
          )}
        </div>

        <div style={statCardStyle}>
          <span style={statLabelStyle}>
            🏅 Badges Earned
          </span>
          <strong style={statValueStyle}>
            {earnedBadges} / {badges.length}
          </strong>
        </div>

        <div style={statCardStyle}>
          <span style={statLabelStyle}>
            📖 Reading Level
          </span>
          <strong style={statValueStyle}>
            {/* No progress row yet matches the database default (Easy). */}
            {progress
              ? progress.difficulty ?? "Not available"
              : "Easy"}
          </strong>
          <small style={statNoteStyle}>From your reading test</small>
        </div>
      </section>

      <p style={levelNoteStyle}>
        Your reading level comes from your reading test (the diagnostic). Earning XP does not change your level.
      </p>

      {/* BADGE COLLECTION HEADING */}
      <h2 style={collectionTitleStyle}>
        🏅 Badges
      </h2>

      {/* BADGE COLLECTION */}
      {badges.length === 0 ? (
        <p>No badges are available yet.</p>
      ) : (
        <section style={badgeGridStyle}>
          {badges.map((badge) => (
            <article
              key={badge.id}
              style={{
                ...badgeCardStyle,
                borderColor: badge.earned
                  ? "#86c98a"
                  : "#e2e8f0",
                backgroundColor: badge.earned
                  ? "#f0fdf4"
                  : "#ffffff",
              }}
            >
              {/* BADGE ICON */}
              <div
                style={{
                  ...iconContainerStyle,
                  color: badge.earned
                    ? "#16a34a"
                    : "#94a3b8",
                  backgroundColor: badge.earned
                    ? "#dcfce7"
                    : "#f1f5f9",
                }}
              >
                <BadgeIcon name={badge.icon ?? ""} />
              </div>

              {/* BADGE NAME */}
              <h3 style={badgeNameStyle}>
                {badge.name}
              </h3>

              {/* HOW TO EARN IT */}
              <p style={badgeDescriptionStyle}>
                {ACHIEVEMENT_GUIDE[badge.id]?.howToEarn ?? badge.description}
              </p>
              {ACHIEVEMENT_GUIDE[badge.id]?.note && (
                <small style={{ color: "#64748b" }}>{ACHIEVEMENT_GUIDE[badge.id]?.note}</small>
              )}

              {/* PROGRESS TOWARD A LOCKED BADGE */}
              {!badge.earned && stats && (() => {
                const goal = achievementProgress(badge.id, stats);
                return goal && (
                  <div style={{ width: "100%" }}>
                    <progress
                      value={goal.current}
                      max={goal.target}
                      style={{ width: "100%" }}
                      aria-label={`${badge.name}: ${goal.current} of ${goal.target} ${goal.unit}`}
                    />
                    <small style={{ color: "#64748b" }}>
                      {goal.current.toLocaleString()} / {goal.target.toLocaleString()} {goal.unit}
                    </small>
                  </div>
                );
              })()}

              {/* BADGE STATUS */}
              <div
                style={{
                  ...badgeStatusStyle,
                  color: badge.earned
                    ? "#15803d"
                    : "#64748b",
                }}
              >
                {badge.earned ? (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Unlocked</span>
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    <span>Locked</span>
                  </>
                )}
              </div>

              {/* DATE EARNED */}
              {badge.earned && earnedDate(badge.earned_at) && (
                <small
                  style={{
                    color: "#64748b",
                    marginTop: "4px",
                  }}
                >
                  Earned: {earnedDate(badge.earned_at)}
                </small>
              )}
            </article>
          ))}
        </section>
      )}

      {/* ACHIEVEMENTS: BRONZE, SILVER AND GOLD */}
      {milestones && milestones.length > 0 && (
        <>
          <h2 style={collectionTitleStyle}>
            🎖️ Achievements
          </h2>
          <section style={badgeGridStyle}>
            {milestones.filter((row) => MILESTONE_GUIDE[row.achievement_id]).map((row) => {
              const guide = MILESTONE_GUIDE[row.achievement_id];
              const { count, reached, next } = milestoneProgress(row.qualifying);
              const earnedAt = reached === "Gold" ? row.gold_at : reached === "Silver" ? row.silver_at : reached === "Bronze" ? row.bronze_at : null;
              return (
                <article key={row.achievement_id} style={{ ...badgeCardStyle, borderColor: reached ? "#86c98a" : "#e2e8f0", backgroundColor: reached ? "#f0fdf4" : "#ffffff" }}>
                  <h3 style={badgeNameStyle}>{guide.name}</h3>
                  <p style={badgeDescriptionStyle}>{guide.howToEarn}</p>
                  <div style={badgeStatusStyle}>{reached ? `${reached} earned` : "Not earned yet"}</div>
                  {next ? (
                    <div style={{ width: "100%" }}>
                      <progress value={count} max={next.target} style={{ width: "100%" }}
                        aria-label={`${guide.name}: ${count} of ${next.target} ${guide.unit} for ${next.tier}`} />
                      <small style={{ color: "#64748b" }}>{count} / {next.target} {guide.unit} for {next.tier}</small>
                    </div>
                  ) : (
                    <small style={{ color: "#64748b" }}>{count} {guide.unit}</small>
                  )}
                  {earnedDate(earnedAt) && (
                    <small style={{ color: "#64748b", marginTop: "4px" }}>Earned: {earnedDate(earnedAt)}</small>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}

// ========================================
// PAGE STYLES
// ========================================

const statNoteStyle: CSSProperties = {
  display: "block",
  color: "#64748b",
  fontSize: "13px",
  marginTop: "4px",
};

const levelNoteStyle: CSSProperties = {
  color: "#475569",
  margin: "12px 0 0",
};

const containerStyle: CSSProperties = {
  padding: "24px",
  width: "100%",
  maxWidth: "1200px",
  margin: "0 auto",
  boxSizing: "border-box",
  color: "#172b25",
};

// MY ACHIEVEMENTS - NORMAL WEIGHT
const mainTitleStyle: CSSProperties = {
  fontSize: "28px",
  fontWeight: 400,
  color: "#173d31",
  marginTop: 0,
  marginBottom: "12px",
  lineHeight: 1.3,
  letterSpacing: "-0.3px",
};

// SUBTITLE
const subtitleStyle: CSSProperties = {
  fontSize: "16px",
  color: "#475569",
  marginTop: 0,
  marginBottom: "24px",
  lineHeight: 1.6,
};

// STATS GRID
const statsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "16px",
  marginTop: "24px",
  marginBottom: "32px",
};

// STAT CARDS
const statCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  backgroundColor: "#ffffff",
  padding: "20px",
  borderRadius: "14px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
};

// STAT LABELS
const statLabelStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: "#475569",
};

// STAT VALUES
const statValueStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 800,
  color: "#173d31",
};

// BADGE COLLECTION - SMALLER AND NORMAL WEIGHT
const collectionTitleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 400,
  color: "#173d31",
  marginTop: "28px",
  marginBottom: "20px",
  lineHeight: 1.3,
  letterSpacing: "-0.3px",
};

// BADGE GRID
const badgeGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "16px",
};

// BADGE CARDS
const badgeCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "225px",
  padding: "24px 18px",
  border: "1px solid",
  borderRadius: "16px",
  textAlign: "center",
  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
  boxSizing: "border-box",
};

// BADGE ICON CIRCLE
const iconContainerStyle: CSSProperties = {
  width: "76px",
  height: "76px",
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: "14px",
};

// BADGE NAME
const badgeNameStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#173d31",
  margin: "0 0 8px",
};

// BADGE DESCRIPTION
const badgeDescriptionStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.5,
  color: "#64748b",
  margin: "0 0 14px",
};

// BADGE STATUS
const badgeStatusStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  fontWeight: 700,
  fontSize: "14px",
  marginBottom: "8px",
};
