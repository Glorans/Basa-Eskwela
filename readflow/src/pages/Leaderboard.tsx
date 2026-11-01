
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import {
  Trophy,
  Medal,
  Star,
  User,
  School,
} from "lucide-react";

import { supabase } from "../lib/supabaseClient";

import {
  getClassroomLeaderboard,
  getWeeklyLeaderboard,
  rankByXp,
} from "../modules/module8/gamificationService";

import type {
  LeaderboardEntry,
} from "../modules/module8/gamificationService";

import {
  getStudentClassrooms,
} from "../modules/module4/services/classroomService";

import type {
  Classroom,
} from "../modules/module4/services/classroomService";

// ========================================
// CONSTANTS
// ========================================

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

// ========================================
// CLASSROOM LEADERBOARD
// ========================================

export default function Leaderboard() {
  const [classrooms, setClassrooms] =
    useState<Classroom[]>([]);

  const [selectedClassroomId, setSelectedClassroomId] =
    useState("");

  const [leaders, setLeaders] =
    useState<LeaderboardEntry[]>([]);

  // False until m8_classroom_leaderboard is deployed: then the
  // rankings combine every classroom the student joined.
  const [roomScoped, setRoomScoped] = useState(true);

  const [rankingsLoading, setRankingsLoading] =
    useState(false);

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // ========================================
  // LOAD STUDENT CLASSROOMS AND LEADERBOARD
  // ========================================

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) throw authError;

        if (!user) {
          throw new Error("Please log in first.");
        }

        const joinedRooms =
          await getStudentClassrooms(user.id);

        if (!active) return;

        setCurrentUserId(user.id);
        setClassrooms(joinedRooms);

        if (joinedRooms.length > 0) {
          setSelectedClassroomId(joinedRooms[0].id);
        }
      } catch (err) {
        if (!active) return;

        console.error(
          "Failed to load classroom leaderboard:",
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load classroom leaderboard."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      active = false;
    };
  }, []);

  // ========================================
  // RANK CLASSMATES
  // ========================================

  // Rankings come only from the security-definer M8 functions: students
  // cannot read classmates' enrollments under RLS, so the page never
  // filters by a room's enrollment list (that removed every classmate).
  useEffect(() => {
    if (!selectedClassroomId) {
      setLeaders([]);
      return;
    }

    let active = true;

    async function loadRankings() {
      try {
        setRankingsLoading(true);
        setError("");

        const roomRankings =
          await getClassroomLeaderboard(selectedClassroomId);

        // Fallback while the room-scoped function is not deployed.
        const rankings = roomRankings ?? rankByXp(
          await getWeeklyLeaderboard()
        );

        if (!active) return;

        setRoomScoped(roomRankings !== null);
        setLeaders(rankings);
      } catch (err) {
        if (!active) return;

        console.error(
          "Failed to load classroom rankings:",
          err
        );

        setLeaders([]);
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load classroom rankings."
        );
      } finally {
        if (active) {
          setRankingsLoading(false);
        }
      }
    }

    void loadRankings();

    return () => {
      active = false;
    };
  }, [selectedClassroomId]);

  // Only the fallback combines classmates from every joined classroom.
  const combinesClassrooms =
    !roomScoped && classrooms.length > 1;

  const selectedClassroom = classrooms.find(
    (room) => room.id === selectedClassroomId
  );

  // ========================================
  // RENDER
  // ========================================

  return (
    <main style={pageStyle}>
      {/* PAGE HEADER */}
      <header style={pageHeaderStyle}>
        <h1 style={pageTitleStyle}>
          <Trophy
            size={28}
            color="#d97706"
            style={{ flexShrink: 0 }}
          />
          Classroom Leaderboard
        </h1>

        <p style={subtitleStyle}>
          View weekly rankings and compare your
          reading progress with classmates.
        </p>
      </header>

      {/* CLASSROOM SELECTOR */}
      <section style={selectorCardStyle}>
        <label
          htmlFor="classroom-select"
          style={selectorLabelStyle}
        >
          <School size={20} color="#173d31" />
          Select Classroom
        </label>

        <select
          id="classroom-select"
          value={selectedClassroomId}
          onChange={(event) =>
            setSelectedClassroomId(event.target.value)
          }
          disabled={loading || classrooms.length === 0 || combinesClassrooms}
          style={selectStyle}
        >
          {classrooms.length === 0 ? (
            <option value="">
              No classrooms available
            </option>
          ) : (
            classrooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.room_name}
                {room.section
                  ? ` - ${room.section}`
                  : ""}
              </option>
            ))
          )}
        </select>

        {combinesClassrooms ? (
          <p style={selectedRoomStyle}>
            Rankings include your classmates from
            all {classrooms.length} classrooms you
            joined.
          </p>
        ) : selectedClassroom && (
          <p style={selectedRoomStyle}>
            Showing rankings for{" "}
            <strong>
              {selectedClassroom.room_name}
            </strong>
          </p>
        )}
      </section>

      {/* LEADERBOARD CARD */}
      <section style={leaderboardCardStyle}>
        <div style={headerStyle}>
          <h2 style={sectionTitleStyle}>
            <Medal
              size={24}
              color="#eab308"
              style={{ flexShrink: 0 }}
            />
            Weekly Rankings
          </h2>
        </div>

        {loading || rankingsLoading ? (
          <div style={messageStyle} role="status">
            Loading classroom rankings...
          </div>
        ) : error ? (
          <div
            style={{
              ...messageStyle,
              color: "#dc2626",
            }}
            role="alert"
          >
            <p>Couldn't load classroom rankings.</p>
            <p>{error}</p>
          </div>
        ) : classrooms.length === 0 ? (
          <div style={messageStyle}>
            <p>You haven't joined a classroom yet.</p>
            <p>
              Join a learning room to view
              classroom rankings.
            </p>
          </div>
        ) : leaders.length === 0 ? (
          <div style={messageStyle}>
            <p>No leaderboard scores yet.</p>
            <p>
              Complete reading activities to
              start earning XP!
            </p>
          </div>
        ) : (
          <ol style={listStyle}>
            {leaders.map((learner, index) => {
              // Equal XP shares a rank.
              const rank = learner.rank;

              const isCurrentUser =
                learner.user_id === currentUserId;

              const rankColor =
                RANK_COLORS[rank - 1] ?? "#64748b";

              const difficulty =
                learner.difficulty || "Easy";

              const difficultyColor =
                difficulty.toLowerCase() === "hard"
                  ? "#fee2e2"
                  : difficulty.toLowerCase() === "medium"
                  ? "#fef3c7"
                  : "#dcfce7";

              const displayName = isCurrentUser
                ? learner.display_name.toLowerCase() ===
                  "you"
                  ? "You"
                  : `You (${learner.display_name})`
                : learner.display_name;

              return (
                <li
                  key={learner.user_id}
                  style={{
                    ...rowStyle,
                    ...(isCurrentUser
                      ? currentUserRowStyle
                      : {}),
                  }}
                >
                  {/* RANK */}
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

                  {/* AVATAR */}
                  <div
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

                  {/* LEARNER INFORMATION */}
                  <div style={userInfoStyle}>
                    <span style={userNameStyle}>
                      {displayName}
                    </span>

                    <span
                      style={{
                        ...difficultyStyle,
                        backgroundColor:
                          difficultyColor,
                      }}
                    >
                      {difficulty}
                    </span>
                  </div>

                  {/* XP SCORE */}
                  <div style={xpStyle}>
                    <div style={xpNumberStyle}>
                      <Star
                        size={17}
                        fill="#eab308"
                        color="#eab308"
                      />

                      {Number(
                        learner.xp ?? 0
                      ).toLocaleString()}
                    </div>

                    <small style={xpLabelStyle}>
                      XP this week
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
        Keep reading and completing activities
        to climb the classroom rankings!
      </p>
    </main>
  );
}

// ========================================
// PAGE STYLES
// ========================================

const pageStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1100px",
  margin: "0 auto",
  padding: "24px",
  boxSizing: "border-box",
  color: "#172b25",
};

const pageHeaderStyle: CSSProperties = {
  marginBottom: "24px",
};

const pageTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontSize: "28px",
  fontWeight: 400,
  color: "#173d31",
  marginTop: 0,
  marginBottom: "12px",
  lineHeight: 1.3,
  letterSpacing: "-0.3px",
};

const subtitleStyle: CSSProperties = {
  fontSize: "16px",
  color: "#475569",
  marginTop: 0,
  marginBottom: 0,
  lineHeight: 1.6,
};

// ========================================
// CLASSROOM SELECTOR STYLES
// ========================================

const selectorCardStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "18px",
  padding: "22px 24px",
  marginBottom: "22px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
};

const selectorLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontSize: "16px",
  fontWeight: 600,
  color: "#173d31",
  marginBottom: "12px",
};

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  fontSize: "15px",
  color: "#173d31",
  backgroundColor: "#f8fafc",
  border: "1px solid #cbd5e1",
  borderRadius: "12px",
  outline: "none",
  cursor: "pointer",
  boxSizing: "border-box",
};

const selectedRoomStyle: CSSProperties = {
  marginTop: "12px",
  marginBottom: 0,
  fontSize: "14px",
  color: "#64748b",
};

// ========================================
// LEADERBOARD CARD
// ========================================

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
  fontSize: "24px",
  fontWeight: 400,
  color: "#173d31",
  margin: 0,
  lineHeight: 1.3,
};

// ========================================
// LEADERBOARD LIST
// ========================================

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
  fontWeight: 600,
  color: "#172b25",
  overflowWrap: "anywhere",
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
