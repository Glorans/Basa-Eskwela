import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { getMyLeaderboardPrivacy, setMyLeaderboardPrivacy } from "./gamificationService";
import type { LeaderboardPrivacy, LeaderboardVisibility } from "./gamificationService";

/**
 * The Student's one-line classroom leaderboard choice (m8_leaderboard_privacy_v1): their existing classroom nickname
 * (the default; nothing to type), a Reader code, or hidden. Saved as soon as it changes. The database decides what
 * classmates see: names only while classroom names are approved, only to active members of the same classroom.
 * Renders nothing until the migration is deployed.
 */
export default function ClassroomVisibilityControl({ onChange }: {
  /** Called with the saved choice when it loads ("loaded") and after each save ("saved"). */
  onChange?: (privacy: LeaderboardPrivacy, reason: "loaded" | "saved") => void;
}) {
  const [saved, setSaved] = useState<LeaderboardPrivacy | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    getMyLeaderboardPrivacy()
      .then((privacy) => {
        if (!active || !privacy) return;
        setSaved(privacy);
        onChange?.(privacy, "loaded");
      })
      .catch(() => { /* The rankings still load; the control stays hidden. */ });
    return () => { active = false; };
    // Loaded once; onChange only notifies the page.
  }, []);

  if (!saved) return null;

  async function save(visibility: LeaderboardVisibility) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await setMyLeaderboardPrivacy(visibility, null);
      setSaved(next);
      setMessage({ ok: true, text: "Saved." });
      onChange?.(next, "saved");
    } catch (error) {
      const text = String((error as { message?: unknown } | null)?.message ?? "");
      setMessage({ ok: false, text: text || "Couldn't save your choice. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const nicknameNote = saved.visibility !== "nickname"
    ? ""
    : !saved.alias
      ? "You don't have a classroom nickname that can be shown, so classmates see a Reader code. "
      : !saved.namesAllowed
        ? "Classroom names appear after your school approves them. Until then, classmates see Reader codes. "
        : "";

  return (
    <div style={wrapStyle}>
      <div style={rowStyle}>
        <label htmlFor="classroom-visibility" style={labelStyle}>Show me to classmates as</label>
        <select
          id="classroom-visibility"
          value={saved.visibility}
          disabled={busy}
          onChange={(event) => void save(event.target.value as LeaderboardVisibility)}
          style={selectStyle}
        >
          <option value="nickname">{saved.alias ? `My classroom nickname (${saved.alias})` : "My classroom nickname"}</option>
          <option value="anonymous">A Reader code (anonymous)</option>
          <option value="hidden">Hidden from the rankings</option>
        </select>
        {message && (
          <small role={message.ok ? "status" : "alert"} style={{ color: message.ok ? "#166534" : "#b91c1c" }}>{message.text}</small>
        )}
      </div>
      <small style={noteStyle}>
        {nicknameNote}This never changes your XP, badges, achievements or reading streak.
      </small>
    </div>
  );
}

const wrapStyle: CSSProperties = { marginTop: "18px", paddingTop: "14px", borderTop: "1px solid #e2e8f0" };
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px" };
const labelStyle: CSSProperties = { fontSize: "14px", fontWeight: 600, color: "#173d31" };
const selectStyle: CSSProperties = {
  padding: "8px 12px", fontSize: "14px", color: "#173d31", backgroundColor: "#f8fafc", border: "1px solid #cbd5e1",
  borderRadius: "10px", maxWidth: "100%", cursor: "pointer",
};
const noteStyle: CSSProperties = { display: "block", marginTop: "6px", fontSize: "12px", color: "#64748b", lineHeight: 1.5 };
