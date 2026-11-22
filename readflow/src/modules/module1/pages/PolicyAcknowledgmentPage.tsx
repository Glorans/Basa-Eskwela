// One-time "I Agree" step after account setup, and once for existing users at their next sign-in, for the ACTIVE
// policy version (none is active until one is approved and activated). Asked again only when the active version
// changes. Records an acknowledgment only: not parent or guardian consent.
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { getRoleHomePath, isAppRole } from "../utils/authOnboarding";
import { acknowledgePolicy, forgetPolicyStatus, getPolicyStatus, type PolicyStatus } from "../services/policyAcknowledgment";
import { logout } from "../../../services/authService";
import { KIDS_PRIVACY_POINTS } from "../../../pages/KidsPrivacySummary";
import { POLICY_REVIEW_STATUS } from "../../../pages/policyStatus";
import "../../../pages/TermsPage.css";

export default function PolicyAcknowledgmentPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PolicyStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const home = profile && isAppRole(profile.role) ? getRoleHomePath(profile.role) : "/";

  useEffect(() => {
    if (!user) return;
    let active = true;
    getPolicyStatus(user.id).then((value) => { if (active) setStatus(value); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;
  if (status && status.state !== "required") return <Navigate to={home} replace />;

  return (
    <main className="terms-page">
      <article className="terms-document" aria-labelledby="ack-title">
        <header className="terms-header">
          <p className="terms-eyebrow">BASA ESKWELA · BEFORE YOU START</p>
          <h1 id="ack-title">Terms of Use and Privacy Notice</h1>
          <p className="terms-intro">Please read how Basa Eskwela works and how your information is used. You only need to do this once.</p>
          <p className="terms-review-note" role="note">{POLICY_REVIEW_STATUS}</p>
          {status?.state === "required" && status.versionStatus === "draft" && (
            <p className="terms-review-note" role="note">
              Review copy ({status.version}): this is a draft shown for review. Pressing I Agree records that you were
              shown this draft; it is not acceptance of an approved policy, and you will be asked again when the approved
              version is published.
            </p>
          )}
        </header>

        <section className="terms-section" aria-label="In simple words">
          <h2>In simple words</h2>
          <ul>{KIDS_PRIVACY_POINTS.map((point) => <li key={point}>{point}</li>)}</ul>
        </section>

        <section className="terms-section">
          <h2>Read the full documents</h2>
          <p>
            <Link to="/terms" target="_blank" rel="noreferrer">Terms of Use</Link> (opens in a new tab)
            {" · "}
            <Link to="/privacy" target="_blank" rel="noreferrer">Privacy Notice</Link> (opens in a new tab)
          </p>
          <p>
            Pressing <strong>I Agree</strong> saves that you were shown this notice (the version and the time). It is not a
            parent&apos;s or guardian&apos;s consent and does not allow anyone to share your name or information.
          </p>
        </section>

        {error && <p role="alert" className="terms-review-note">{error}</p>}

        <footer className="terms-footer">
          <button
            type="button"
            className="terms-exit-button"
            disabled={busy || leaving}
            onClick={async () => {
              setLeaving(true); setError("");
              try {
                if (await logout()) { forgetPolicyStatus(); navigate("/login", { replace: true }); return; }
                setError("Could not log out. Please try again.");
              } catch { setError("Could not log out. Please try again."); }
              setLeaving(false);
            }}
          >
            {leaving ? "Logging out…" : "Not now, log out"}
          </button>
          <button
            type="button"
            className="terms-agree-button"
            disabled={busy || leaving || status?.state !== "required"}
            onClick={async () => {
              if (status?.state !== "required") return;
              setBusy(true); setError("");
              try { await acknowledgePolicy(user.id, status.version); navigate(home, { replace: true }); }
              catch (e) { setError((e as Error).message); setBusy(false); }
            }}
          >
            {busy ? "Saving…" : "I Agree"}
          </button>
        </footer>
      </article>
    </main>
  );
}
