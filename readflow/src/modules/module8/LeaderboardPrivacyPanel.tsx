import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";

import { getMyLeaderboardPrivacy, setMyLeaderboardPrivacy } from "./gamificationService";
import type { LeaderboardPrivacy, LeaderboardVisibility } from "./gamificationService";

/**
 * How the learner appears on the leaderboard (m8_leaderboard_privacy_v1). The database enforces every rule: a
 * nickname is shown only when nicknames are approved, hidden learners are left out of other learners' rankings, and
 * the choice never changes XP, badges, achievements or streaks. Renders nothing until the migration is deployed.
 */
export default function LeaderboardPrivacyPanel({ audience, onChange }: {
  audience: "classroom" | "independent";
  /** Called with the saved choice when it loads ("loaded") and after each save ("saved"). */
  onChange?: (privacy: LeaderboardPrivacy, reason: "loaded" | "saved") => void;
}) {
  const [saved, setSaved] = useState<LeaderboardPrivacy | null>(null);
  const [choice, setChoice] = useState<LeaderboardVisibility>("anonymous");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    getMyLeaderboardPrivacy()
      .then((privacy) => {
        if (!active || !privacy) return;
        setSaved(privacy);
        setChoice(privacy.visibility);
        setAlias(privacy.alias ?? "");
        onChange?.(privacy, "loaded");
      })
      .catch(() => { /* The rankings still load; the panel stays hidden. */ });
    return () => { active = false; };
    // Loaded once; onChange only notifies the page.
  }, []);

  if (!saved) return null;

  const others = audience === "classroom" ? "Your classmates" : "Other learners";
  const unchanged = choice === saved.visibility && alias.trim() === (saved.alias ?? "");
  const options: { value: LeaderboardVisibility; label: string; hint: string; disabled?: boolean }[] = [
    {
      value: "nickname",
      label: "Display my chosen leaderboard nickname",
      hint: saved.namesAllowed
        ? `${others} see the nickname you type below, never your real name or e-mail.`
        : "Not available yet: leaderboard nicknames are waiting for privacy approval.",
      disabled: !saved.namesAllowed,
    },
    { value: "anonymous", label: "Participate anonymously", hint: `${others} see a code such as "Reader 4F2A9C".` },
    { value: "hidden", label: "Hide my leaderboard participation", hint: `${others} do not see you. Only you see your own row.` },
  ];

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await setMyLeaderboardPrivacy(choice, alias.trim() || null);
      setSaved(next);
      setChoice(next.visibility);
      setAlias(next.alias ?? "");
      setMessage({ ok: true, text: "Saved. Your XP, badges, achievements and reading streak stay the same." });
      onChange?.(next, "saved");
    } catch (error) {
      const text = String((error as { message?: unknown } | null)?.message ?? "");
      setMessage({ ok: false, text: text || "Couldn't save your choice. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panelStyle} aria-labelledby={`lb-privacy-${audience}`}>
      <h2 id={`lb-privacy-${audience}`} style={titleStyle}>
        <ShieldCheck size={20} color="#173d31" style={{ flexShrink: 0 }} />
        How you appear on the leaderboard
      </h2>
      <p style={introStyle}>
        You choose what others see. Changing this never changes your XP, badges, achievements or reading streak.
      </p>

      <div role="radiogroup" aria-labelledby={`lb-privacy-${audience}`} style={optionsStyle}>
        {options.map((option) => (
          <label
            key={option.value}
            style={{ ...optionStyle, ...(choice === option.value ? selectedOptionStyle : {}), ...(option.disabled ? disabledOptionStyle : {}) }}
          >
            <input
              type="radio"
              name={`lb-privacy-${audience}`}
              value={option.value}
              checked={choice === option.value}
              disabled={option.disabled || busy}
              onChange={() => setChoice(option.value)}
              style={{ marginTop: "3px", flexShrink: 0 }}
            />
            <span style={{ minWidth: 0 }}>
              <span style={optionLabelStyle}>{option.label}</span>
              <small style={hintStyle}>{option.hint}</small>
            </span>
          </label>
        ))}
      </div>

      {choice === "nickname" && saved.namesAllowed && (
        <label style={aliasLabelStyle}>
          Leaderboard nickname
          <input
            type="text"
            value={alias}
            maxLength={20}
            placeholder="e.g. ReadingStar"
            autoComplete="off"
            onChange={(event) => setAlias(event.target.value)}
            disabled={busy}
            style={aliasInputStyle}
          />
          <small style={hintStyle}>2 to 20 letters or numbers. No real name, e-mail, links, phone numbers or rude words.</small>
        </label>
      )}

      <div style={footerStyle}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || unchanged || (choice === "nickname" && alias.trim().length < 2)}
          style={{ ...saveStyle, ...(busy || unchanged ? saveDisabledStyle : {}) }}
        >
          {busy ? "Saving..." : "Save"}
        </button>
        {message && (
          <small role={message.ok ? "status" : "alert"} style={{ color: message.ok ? "#166534" : "#b91c1c" }}>
            {message.text}
          </small>
        )}
      </div>
    </section>
  );
}

const panelStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "18px",
  padding: "20px 24px",
  marginBottom: "22px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
};
const titleStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: "10px", fontSize: "16px", fontWeight: 600, color: "#173d31", margin: "0 0 10px",
};
const introStyle: CSSProperties = { fontSize: "13px", color: "#475569", margin: "-4px 0 12px", lineHeight: 1.5 };
const optionsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" };
const optionStyle: CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 14px", borderWidth: "1px", borderStyle: "solid", borderColor: "#cbd5e1",
  borderRadius: "12px", backgroundColor: "#f8fafc", cursor: "pointer", minWidth: 0,
};
const selectedOptionStyle: CSSProperties = { borderColor: "#173d31", backgroundColor: "#f0fdf4" };
const disabledOptionStyle: CSSProperties = { cursor: "not-allowed", opacity: 0.7 };
const optionLabelStyle: CSSProperties = { display: "block", fontSize: "14px", fontWeight: 600, color: "#172b25" };
const hintStyle: CSSProperties = { display: "block", fontSize: "12px", color: "#64748b", marginTop: "3px", lineHeight: 1.45 };
const aliasLabelStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: "6px", marginTop: "14px", fontSize: "14px", fontWeight: 600, color: "#173d31", maxWidth: "360px",
};
const aliasInputStyle: CSSProperties = {
  padding: "11px 14px", fontSize: "15px", border: "1px solid #cbd5e1", borderRadius: "10px", backgroundColor: "#f8fafc", color: "#172b25",
};
const footerStyle: CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "12px", marginTop: "14px" };
const saveStyle: CSSProperties = {
  border: "none", borderRadius: "999px", padding: "10px 22px", fontSize: "14px", fontWeight: 600, backgroundColor: "#173d31", color: "#ffffff", cursor: "pointer",
};
const saveDisabledStyle: CSSProperties = { opacity: 0.5, cursor: "default" };
