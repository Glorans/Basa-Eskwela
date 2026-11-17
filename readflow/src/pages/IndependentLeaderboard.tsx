
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import {
  Trophy,
  Star,
  User,
  Medal,
} from "lucide-react";

import { supabase } from "../lib/supabaseClient";
import useAuthenticatedProfile from "../hooks/useAuthenticatedProfile";
import { ownLeaderboardLabel, rankByXp } from "../modules/module8/leaderboardRanking";
import "./IndependentLeaderboard.css";

type Entry = {
  user_id: string;
  display_name: string;
  xp: number;
  difficulty?: string;
  is_me?: boolean;
};

type RankingLanguage = "en" | "fil";
type RankingRow = { entry_id: string; display_name: string; xp: number; is_me: boolean };

type Period = "weekly" | "all_time";

const AVATAR_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#22c55e",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#ef4444",
];

const RANK_COLORS = [
  "#f59e0b",
  "#94a3b8",
  "#cd7f32",
];

export default function IndependentLeaderboard() {
  const [period, setPeriod] = useState<Period>("weekly");
  // English and Filipino earn XP differently for now, so each language ranks on its own.
  const [language, setLanguage] = useState<RankingLanguage>("en");
  const [perLanguage, setPerLanguage] = useState(false);
  const [rows, setRows] = useState<Entry[]>([]);
  const [me, setMe] = useState<string | undefined>();
  const { profile } = useAuthenticatedProfile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadLeaderboard() {
      try {
        setLoading(true);
        setError("");

        const [auth, separated] = await Promise.all([
          supabase.auth.getUser(),
          supabase.rpc(
            "m8_independent_rankings" as never,
            { p_period: period, p_language: language } as never
          ),
        ]);

        if (auth.error) throw auth.error;

        // Older database: the earlier combined ranking.
        const missing = ["PGRST202", "42883"].includes(String(separated.error?.code));
        if (separated.error && !missing) throw separated.error;
        const result = missing
          ? await supabase.rpc(
            "m8_independent_leaderboard" as never,
            { p_period: period } as never
          )
          : null;

        if (!active) return;

        if (result?.error) throw result.error;

        setMe(auth.data.user?.id);
        setPerLanguage(!missing);
        setRows(missing
          ? ((result?.data ?? []) as Entry[])
          : ((separated.data ?? []) as RankingRow[]).map((row) => ({
            user_id: row.entry_id, display_name: row.display_name, xp: row.xp, is_me: row.is_me,
          })));
      } catch (err) {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load leaderboard."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadLeaderboard();

    return () => {
      active = false;
    };
  }, [period, language]);

  const title =
    period === "weekly"
      ? "Top Readers This Week"
      : "Top Readers of All Time";

  return (
    <main style={pageStyle}>
      {/* PAGE HEADER */}
      <header style={{ marginBottom: 24 }}>
        <h1 style={pageTitleStyle}>
          <Trophy
            size={28}
            color="#d97706"
            style={{ flexShrink: 0 }}
          />
          Global Leaderboard
        </h1>

        <p style={subtitleStyle}>
          See your global rankings against independent learners.
        </p>
      </header>

      {/* LEADERBOARD CARD */}
      <section style={leaderboardCardStyle}>
        <div style={headerStyle}>
          <h2 style={sectionTitleStyle}>
            <Medal size={22} color="#eab308" />
            {title}
          </h2>

          {/* WEEKLY / ALL-TIME FILTER */}
          <div
            style={toggleStyle}
            role="group"
            aria-label="Ranking period"
          >
            <button
              type="button"
              style={{
                ...toggleButtonStyle,
                ...(period === "weekly"
                  ? activeButtonStyle
                  : {}),
              }}
              aria-pressed={period === "weekly"}
              onClick={() => setPeriod("weekly")}
            >
              This week
            </button>

            <button
              type="button"
              style={{
                ...toggleButtonStyle,
                ...(period === "all_time"
                  ? activeButtonStyle
                  : {}),
              }}
              aria-pressed={period === "all_time"}
              onClick={() => setPeriod("all_time")}
            >
              All time
            </button>
          </div>

          {perLanguage && (
            <div style={toggleStyle} role="group" aria-label="Ranking language">
              {(["en", "fil"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  style={{ ...toggleButtonStyle, ...(language === option ? activeButtonStyle : {}) }}
                  aria-pressed={language === option}
                  onClick={() => setLanguage(option)}
                >
                  {option === "en" ? "English" : "Filipino"}
                </button>
              ))}
            </div>
          )}
        </div>

        {perLanguage && (
          <p style={languageNoteStyle}>
            English and Filipino activities earn XP differently for now, so each language has its own ranking.
          </p>
        )}

        {/* LOADING */}
        {loading ? (
          <div style={messageStyle} role="status">
            Loading rankings...
          </div>
        ) : error ? (
          /* ERROR */
          <div
            style={{
              ...messageStyle,
              color: "#dc2626",
            }}
            role="alert"
          >
            <strong>Couldn't load the leaderboard.</strong>
            <p>{error}</p>
          </div>
        ) : rows.length === 0 ? (
          /* EMPTY STATE */
          <div style={messageStyle}>
            <strong>No rankings yet.</strong>
            <p>
              Rankings will appear once learner progress
              is available.
            </p>
          </div>
        ) : (
          /* LEADERBOARD LIST */
          <ol style={listStyle}>
            {/* Equal XP shares a rank, as on the Student leaderboard. Display only. */}
            {rankByXp(rows.map((row) => ({ ...row, xp: Number(row.xp), rank: 0 }))).map((entry, index) => {
              const rank = entry.rank;
              const isYou = entry.is_me ?? entry.user_id === me;

              const rankColor =
                RANK_COLORS[rank - 1] ?? "#64748b";

              // Absent on the per-language rankings: other learners' levels stay private.
              const difficulty = entry.difficulty ?? "";

              const difficultyColor =
                difficulty.toLowerCase() === "hard"
                  ? "#fee2e2"
                  : difficulty.toLowerCase() === "medium"
                  ? "#fef3c7"
                  : "#dcfce7";

              return (
                <li
                  key={entry.user_id}
                  className="il-leaderboard-row"
                  style={{
                    ...rowStyle,
                    ...(isYou ? currentUserRowStyle : {}),
                  }}
                >
                  {/* RANK NUMBER */}
                  <div
                    style={{
                      ...rankStyle,
                      backgroundColor:
                        rank <= 3
                          ? rankColor
                          : "#e2e8f0",
                      color:
                        rank <= 3
                          ? "#ffffff"
                          : "#475569",
                    }}
                  >
                    {rank}
                  </div>

                  {/* USER AVATAR */}
                  <div
                    className="il-leaderboard-avatar"
                    aria-hidden="true"
                    style={{
                      ...avatarStyle,
                      backgroundColor:
                        AVATAR_COLORS[
                          index % AVATAR_COLORS.length
                        ],
                    }}
                  >
                    <User size={20} color="#ffffff" />
                  </div>

                  {/* LEARNER DETAILS */}
                  <div style={userInfoStyle}>
                    <strong style={userNameStyle}>
                      {isYou
                        ? ownLeaderboardLabel(entry.display_name, profile?.nickname)
                        : entry.display_name}
                    </strong>

                    {difficulty && (
                      <span
                        style={{
                          ...difficultyStyle,
                          backgroundColor:
                            difficultyColor,
                        }}
                      >
                        {difficulty}
                      </span>
                    )}
                  </div>

                  {/* XP SCORE */}
                  <div style={xpStyle}>
                    <div style={xpNumberStyle}>
                      <Star
                        size={17}
                        fill="#eab308"
                        color="#eab308"
                      />
                      {Number(entry.xp).toLocaleString()}
                    </div>

                    <small style={xpLabelStyle}>
                      XP
                    </small>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* FOOTER */}
      <p style={footerStyle}>
        Earn XP by completing reading modules and
        improving your reading skills!
      </p>
    </main>
  );
}

// ========================================
// STYLES
// ========================================

const pageStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1100px",
  margin: "0 auto",
  padding: "24px",
  boxSizing: "border-box",
  color: "#172b25",
};

// GLOBAL LEADERBOARD - NOT BOLD
const pageTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontSize: "28px",
  fontWeight: 400,
  color: "#173d31",
  margin: "0 0 12px",
  lineHeight: 1.3,
  letterSpacing: "-0.3px",
};

const subtitleStyle: CSSProperties = {
  fontSize: "15px",
  color: "#475569",
  margin: 0,
};

const leaderboardCardStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "18px",
  padding: "24px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "16px",
  marginBottom: "24px",
};

const sectionTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "19px",
  fontWeight: 700,
  margin: 0,
};

const toggleStyle: CSSProperties = {
  display: "flex",
  gap: "4px",
  backgroundColor: "#f1f5f9",
  borderRadius: "999px",
  padding: "4px",
};

const toggleButtonStyle: CSSProperties = {
  border: "none",
  backgroundColor: "transparent",
  color: "#475569",
  padding: "9px 16px",
  borderRadius: "999px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const activeButtonStyle: CSSProperties = {
  backgroundColor: "#173d31",
  color: "#ffffff",
};

const languageNoteStyle: CSSProperties = {
  fontSize: "14px",
  color: "#64748b",
  margin: "0 0 16px",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  backgroundColor: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "14px 16px",
  minWidth: 0,
};

const currentUserRowStyle: CSSProperties = {
  backgroundColor: "#eff6ff",
  borderColor: "#60a5fa",
};

const rankStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  minWidth: "36px",
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: "15px",
};

const avatarStyle: CSSProperties = {
  width: "42px",
  height: "42px",
  minWidth: "42px",
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const userInfoStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "6px",
  flex: 1,
  minWidth: 0,
};

const userNameStyle: CSSProperties = {
  fontSize: "15px",
  // Names wrap between words; a single very long word still breaks rather than overflowing.
  overflowWrap: "break-word",
  wordBreak: "normal",
  minWidth: 0,
  maxWidth: "100%",
};

const difficultyStyle: CSSProperties = {
  display: "inline-flex",
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#334155",
};

const xpStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: "3px",
  marginLeft: "auto",
  flexShrink: 0,
};

const xpNumberStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "19px",
  fontWeight: 700,
  color: "#2563eb",
};

const xpLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: "#64748b",
};

const messageStyle: CSSProperties = {
  textAlign: "center",
  padding: "48px 16px",
  color: "#64748b",
};

const footerStyle: CSSProperties = {
  textAlign: "center",
  fontSize: "14px",
  color: "#475569",
  marginTop: "20px",
};
