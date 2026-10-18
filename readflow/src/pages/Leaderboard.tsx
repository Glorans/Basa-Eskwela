import { Star, User } from "lucide-react";
import ImagePlaceholder from "../components/basa/ImagePlaceholder";
import { BASA_IMAGES } from "../assets/basaImages";
import type { Difficulty } from "../data/dashboardData";
import "./Leaderboard.css";

const AVATAR_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f97316", "#06b6d4", "#ec4899", "#ef4444"];
const RANK_TIER = ["gold", "silver", "bronze"] as const;

interface LeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  difficulty: Difficulty;
  isYou?: boolean;
}

// Populated when a persisted learner-progress source is introduced.
const leaderboardEntries: LeaderboardEntry[] = [];

export default function Leaderboard() {
  return (
    <>
      <h1 className="basa-page-title">Leaderboard</h1>
      <p className="basa-page-subtitle">See reader progress in your learning room.</p>

      <div className="basa-leaderboard-layout">
        <div className="basa-leaderboard-card">
          <h2>Top Readers This Week</h2>

          {leaderboardEntries.length === 0 ? (
            <div className="basa-leaderboard-empty">
              <strong>No leaderboard data yet.</strong>
              <span>Rankings will appear once learner progress is available.</span>
            </div>
          ) : (
            <ul className="basa-leaderboard-list">
              {leaderboardEntries.map((entry, index) => (
                <li key={entry.rank} className={entry.isYou ? "basa-leaderboard-row basa-leaderboard-row--you" : "basa-leaderboard-row"}>
                  <span
                    className={`basa-rank-badge ${entry.rank <= 3 ? `basa-rank-badge--${RANK_TIER[entry.rank - 1]}` : ""}`}
                  >
                    {entry.rank}
                  </span>
                  <span className="basa-avatar" style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}>
                    <User size={16} color="#ffffff" />
                  </span>
                  <span className="basa-leaderboard-name">{entry.isYou ? `You (${entry.name})` : entry.name}</span>
                  <span className={`basa-badge basa-badge--${entry.difficulty.toLowerCase()}`}>{entry.difficulty}</span>
                  <span className="basa-leaderboard-xp">
                    <Star size={14} fill="var(--basa-yellow)" color="var(--basa-yellow)" />
                    {entry.xp.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ImagePlaceholder
          src={BASA_IMAGES.podiumGraphic}
          alt="Podium illustration"
          className="basa-podium"
          width={220}
          height={220}
        />
      </div>
    </>
  );
}
