
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
  getMyGamification,
} from "../modules/module8/gamificationService";

import type {
  Badge,
  LearnerProgress,
} from "../modules/module8/gamificationService";

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
// MY BADGES COMPONENT
// ========================================

export default function MyBadges() {
  const [progress, setProgress] =
    useState<LearnerProgress | null>(null);

  const [badges, setBadges] = useState<Badge[]>([]);
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
        Keep reading, earn XP, and unlock exciting badges!
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
            {progress?.current_streak ?? 0} days
          </strong>
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
            📖 Difficulty
          </span>
          <strong style={statValueStyle}>
            {/* No progress row yet matches the database default (Easy). */}
            {progress
              ? progress.difficulty ?? "Not available"
              : "Easy"}
          </strong>
        </div>
      </section>

      {/* BADGE COLLECTION HEADING */}
      <h2 style={collectionTitleStyle}>
        🏅 Badge Collection
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

              {/* BADGE DESCRIPTION */}
              <p style={badgeDescriptionStyle}>
                {badge.description}
              </p>

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
              {badge.earned && badge.earned_at && (
                <small
                  style={{
                    color: "#64748b",
                    marginTop: "4px",
                  }}
                >
                  Earned:{" "}
                  {new Date(
                    badge.earned_at
                  ).toLocaleDateString()}
                </small>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

// ========================================
// PAGE STYLES
// ========================================

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
