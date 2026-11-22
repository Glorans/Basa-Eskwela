
import { useEffect, useRef, useState } from "react";
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
  claimAchievement,
  claimBadge,
  getMyAchievementClaims,
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
  badgeCounts,
  retiredBadgeNote,
  claimErrorMessage,
  earnedDate,
  isLockedError,
  MILESTONE_GUIDE,
  milestoneProgress,
  milestoneTiers,
  type AchievementClaimRow,
  type AchievementStats,
  type RewardState,
  type TierKey,
} from "../modules/module8/achievements";
import { storyUnit } from "../modules/module8/leaderboardRooms";

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
  // Claimed achievement tiers; null until reward claiming is deployed (tiers then show as earned).
  const [tierClaims, setTierClaims] = useState<AchievementClaimRow[] | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Blocks a second click before React re-renders the disabled button (rapid double-click).
  const claimInFlight = useRef(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
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
        setClaiming(result.claiming);
        setStats(result.stats);
        setReading(result.reading);

        // Optional: the badges still show if achievements cannot load.
        const [achieved, claimed] = await Promise.all([
          getMyAchievements().catch(() => null),
          result.claiming ? getMyAchievementClaims().catch(() => null) : Promise.resolve(null),
        ]);
        if (!active) return;
        setMilestones(achieved);
        // If the claims cannot load, hide the Claim buttons rather than offer claims that may exist.
        setTierClaims(result.claiming ? claimed ?? null : null);
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

  // Active badges only; past (retired) badges a learner claimed earlier are counted separately.
  const counts = badgeCounts(badges);

  // Claiming: the database rechecks the rule and saves the claim once. The card updates in place.
  async function handleClaimBadge(badge: Badge) {
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    setBusy(`badge:${badge.id}`);
    setNotice(null);
    try {
      const { claimedAt } = await claimBadge(badge.id);
      setBadges((current) => current.map((item) =>
        item.id === badge.id ? { ...item, state: "claimed", claimed_at: claimedAt, preserved: false } : item));
      setNotice({ kind: "success", text: `🎉 You claimed the ${badge.name} badge!` });
    } catch (err) {
      setNotice({ kind: "error", text: claimErrorMessage(err) });
      // The database says it is still locked: show that instead of a Claim button that cannot work.
      if (isLockedError(err)) {
        setBadges((current) => current.map((item) => item.id === badge.id ? { ...item, state: "locked" } : item));
      }
    } finally {
      claimInFlight.current = false;
      setBusy(null);
    }
  }

  async function handleClaimTier(achievementId: string, name: string, tier: TierKey, label: string) {
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    setBusy(`tier:${achievementId}:${tier}`);
    setNotice(null);
    try {
      const { claimedAt } = await claimAchievement(achievementId, tier);
      setTierClaims((current) => [
        ...(current ?? []).filter((claim) => !(claim.achievement_id === achievementId && claim.tier === tier)),
        { achievement_id: achievementId, tier, claimed_at: claimedAt },
      ]);
      setNotice({ kind: "success", text: `🎉 You claimed ${name} ${label}!` });
    } catch (err) {
      setNotice({ kind: "error", text: claimErrorMessage(err) });
    } finally {
      claimInFlight.current = false;
      setBusy(null);
    }
  }

  const claimedWord = claiming ? "Claimed" : "Earned";

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
        {claiming
          ? "Badges mark what you have done. Achievements show how well you read and understand over time. When you unlock one, press Claim to add it to your collection. Claimed rewards stay saved on your account."
          : "Badges mark what you have done. Achievements show how well you read and understand over time. Earned badges stay saved on your account."}
      </p>

      {/* CLAIM FEEDBACK */}
      <div aria-live="polite" role="status">
        {notice && (
          <p style={notice.kind === "success" ? noticeSuccessStyle : noticeErrorStyle}>
            {notice.text}
          </p>
        )}
      </div>

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
            Best streak: {progress?.longest_streak ?? 0} {(progress?.longest_streak ?? 0) === 1 ? "day" : "days"}
          </small>
          {reading && !reading.readToday && (progress?.current_streak ?? 0) > 0 && (
            <small style={statNoteStyle}>Read today to keep your streak going!</small>
          )}
        </div>

        <div style={statCardStyle}>
          <span style={statLabelStyle}>
            🏅 Badges {claimedWord}
          </span>
          <strong style={statValueStyle}>
            {counts.claimed} / {counts.total}
          </strong>
          {counts.past > 0 && (
            <small style={statNoteStyle}>+ {counts.past} past {counts.past === 1 ? "badge" : "badges"}</small>
          )}
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
                ...cardColors[badge.state],
              }}
            >
              {/* BADGE ICON */}
              <div
                style={{
                  ...iconContainerStyle,
                  ...iconColors[badge.state],
                }}
              >
                <BadgeIcon name={badge.icon ?? ""} />
              </div>

              {/* BADGE NAME */}
              <h3 style={badgeNameStyle}>
                {badge.name}
              </h3>

              {/* HOW TO EARN IT (a retired badge is a past reward instead) */}
              <div style={cardTextAreaStyle}>
              <p style={badgeDescriptionStyle}>
                {badge.retired ? retiredBadgeNote(badge.state) : ACHIEVEMENT_GUIDE[badge.id]?.howToEarn ?? badge.description}
              </p>
              {!badge.retired && ACHIEVEMENT_GUIDE[badge.id]?.note && (
                <small style={{ color: "#64748b" }}>{ACHIEVEMENT_GUIDE[badge.id]?.note}</small>
              )}
              </div>

              {/* REQUIREMENT PROGRESS: shown in every state (Locked, Claim, Claimed), from the saved counts */}
              <div style={progressAreaStyle}>
              {!badge.retired && stats && (() => {
                const goal = achievementProgress(badge.id, stats);
                return goal && (
                  <>
                    <progress
                      value={goal.current}
                      max={goal.target}
                      style={{ width: "100%" }}
                      aria-label={`${badge.name}: ${goal.current} of ${goal.target} ${goal.unit}`}
                    />
                    <small style={{ color: "#64748b" }}>
                      {goal.current.toLocaleString()} / {goal.target.toLocaleString()} {goal.unit}
                    </small>
                    {badge.state !== "locked" && goal.current < goal.target && (
                      <small style={{ color: "#64748b" }}>Unlocked earlier</small>
                    )}
                  </>
                );
              })()}
              </div>

              {/* BADGE STATUS: LOCKED, READY TO CLAIM OR CLAIMED */}
              <div style={statusAreaStyle}>
              {rewardStatus({
                state: badge.state,
                claimedWord,
                busy: busy === `badge:${badge.id}`,
                disabled: busy !== null,
                label: badge.name,
                onClaim: () => void handleClaimBadge(badge),
              })}

              {/* DATE CLAIMED */}
              {badge.state === "claimed" && earnedDate(badge.claimed_at) && (
                <small
                  style={{
                    color: "#64748b",
                    marginTop: "4px",
                  }}
                >
                  {/* Preserved badges were awarded automatically before claiming began. */}
                  {claiming ? (badge.preserved ? "Awarded" : "Claimed") : "Earned"}: {earnedDate(badge.claimed_at)}
                </small>
              )}
              </div>
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
              const { count, next } = milestoneProgress(row.qualifying);
              const tiers = milestoneTiers(row, claiming ? tierClaims : null);
              // Claim data failed to load: show progress only, no Claim buttons.
              const canClaim = !claiming || tierClaims !== null;
              const cardState: RewardState = tiers.some((t) => t.state === "ready") && canClaim ? "ready"
                : tiers.some((t) => t.state === "claimed") ? "claimed" : "locked";
              return (
                <article key={row.achievement_id} style={{ ...badgeCardStyle, ...cardColors[cardState] }}>
                  <h3 style={badgeNameStyle}>{guide.name}</h3>
                  <p style={badgeDescriptionStyle}>{guide.howToEarn}</p>
                  {next ? (
                    <div style={{ width: "100%" }}>
                      <progress value={count} max={next.target} style={{ width: "100%" }}
                        aria-label={`${guide.name}: ${count} of ${next.target} ${storyUnit(guide.unit, next.target)} for ${next.tier}`} />
                      <small style={{ color: "#64748b" }}>{count} / {next.target} {storyUnit(guide.unit, next.target)} for {next.tier}</small>
                    </div>
                  ) : (
                    <div style={{ width: "100%" }}>
                      <progress value={3} max={3} style={{ width: "100%" }} aria-label={`${guide.name}: all tiers reached`} />
                      <small style={{ color: "#64748b" }}>{count} {storyUnit(guide.unit, count)} · all tiers reached</small>
                    </div>
                  )}
                  <ul style={tierListStyle} aria-label={`${guide.name} tiers`}>
                    {tiers.map((t) => (
                      <li key={t.key} style={tierRowStyle}>
                        <span style={tierNameStyle}>
                          {t.tier} <small style={{ color: "#64748b", fontWeight: 400 }}>· {t.target} {storyUnit(guide.unit, t.target)}</small>
                        </span>
                        {t.state === "ready" && !canClaim ? (
                          <span style={{ ...badgeStatusStyle, marginBottom: 0, color: "#64748b" }}>Reached</span>
                        ) : rewardStatus({
                          state: t.state,
                          claimedWord,
                          busy: busy === `tier:${row.achievement_id}:${t.key}`,
                          disabled: busy !== null,
                          label: `${guide.name} ${t.tier}`,
                          onClaim: () => void handleClaimTier(row.achievement_id, guide.name, t.key, t.tier),
                          compact: true,
                        })}
                        {t.state === "claimed" && earnedDate(t.claimedAt) && (
                          <small style={{ color: "#64748b", width: "100%", textAlign: "left" }}>
                            {claimedWord}: {earnedDate(t.claimedAt)}
                          </small>
                        )}
                      </li>
                    ))}
                  </ul>
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
// REWARD STATUS: LOCKED, CLAIM BUTTON OR CLAIMED
// ========================================

// A plain render function (no hooks), so the status is part of the card's own tree.
function rewardStatus({ state, claimedWord, busy, disabled, label, onClaim, compact = false }: {
  state: RewardState;
  claimedWord: string;
  busy: boolean;
  disabled: boolean;
  label: string;
  onClaim: () => void;
  compact?: boolean;
}) {
  const spacing = compact ? { marginBottom: 0 } : {};
  if (state === "ready") {
    return (
      <button
        type="button"
        style={{ ...claimButtonStyle, ...(compact ? claimButtonCompactStyle : {}), opacity: disabled && !busy ? 0.6 : 1 }}
        onClick={onClaim}
        disabled={disabled}
        aria-label={`Claim ${label}`}
      >
        {busy ? "Claiming..." : "Claim"}
      </button>
    );
  }
  if (state === "claimed") {
    return (
      <div style={{ ...badgeStatusStyle, ...spacing, color: "#15803d" }}>
        <CheckCircle2 size={16} />
        <span>{claimedWord}</span>
      </div>
    );
  }
  return (
    <div style={{ ...badgeStatusStyle, ...spacing, color: "#64748b" }}>
      <Lock size={16} />
      <span>Locked</span>
    </div>
  );
}

// ========================================
// PAGE STYLES
// ========================================

const cardColors: Record<RewardState, CSSProperties> = {
  claimed: { borderColor: "#86c98a", backgroundColor: "#f0fdf4" },
  ready: { borderColor: "#f5c451", backgroundColor: "#fffbeb" },
  locked: { borderColor: "#e2e8f0", backgroundColor: "#ffffff" },
};

const iconColors: Record<RewardState, CSSProperties> = {
  claimed: { color: "#16a34a", backgroundColor: "#dcfce7" },
  ready: { color: "#b45309", backgroundColor: "#fef3c7" },
  locked: { color: "#94a3b8", backgroundColor: "#f1f5f9" },
};

const claimButtonStyle: CSSProperties = {
  backgroundColor: "#173d31",
  color: "#ffffff",
  border: "none",
  borderRadius: "10px",
  padding: "10px 22px",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
  marginBottom: "8px",
  minHeight: "44px",
};

const claimButtonCompactStyle: CSSProperties = {
  padding: "6px 16px",
  fontSize: "14px",
  marginBottom: 0,
  minHeight: "36px",
};

const noticeSuccessStyle: CSSProperties = {
  backgroundColor: "#f0fdf4",
  border: "1px solid #86c98a",
  color: "#15803d",
  borderRadius: "12px",
  padding: "12px 16px",
  margin: "0 0 16px",
  fontWeight: 600,
};

const noticeErrorStyle: CSSProperties = {
  ...noticeSuccessStyle,
  backgroundColor: "#fef2f2",
  border: "1px solid #fca5a5",
  color: "#b91c1c",
};

const tierListStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "12px 0 0",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const tierRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "6px",
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  backgroundColor: "#ffffff",
};

const tierNameStyle: CSSProperties = {
  fontWeight: 700,
  color: "#173d31",
  fontSize: "15px",
};

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
// Requirement text grows; the progress row and the status row keep the same place on every card.
const cardTextAreaStyle: CSSProperties = { flex: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center" };
const progressAreaStyle: CSSProperties = { width: "100%", minHeight: "48px", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: "2px" };
const statusAreaStyle: CSSProperties = { width: "100%", minHeight: "70px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: "4px", marginTop: "8px" };

const badgeCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-start",
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
