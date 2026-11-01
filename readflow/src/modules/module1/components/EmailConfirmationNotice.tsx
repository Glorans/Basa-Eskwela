import { useEffect, useState } from "react";
import { Mail, MailCheck, MailWarning, MailX, X } from "lucide-react";
import { isValidSignupEmail } from "../utils/authOnboarding.ts";
import { ResendConfirmationError, resendSignupConfirmation } from "../../../services/authService.ts";
import "./EmailConfirmationNotice.css";

/**
 * sent: Supabase reliably reported a confirmation email. maybe-sent: it did not (it may be hiding an
 * existing account). expired/invalid: a confirmation link failed. not-verified: login was refused
 * because the email is unconfirmed. verified: Supabase established a session for a confirmed email.
 */
export type EmailConfirmationNoticeKind = "sent" | "maybe-sent" | "expired" | "invalid" | "not-verified" | "verified";

const RESEND_COOLDOWN_SECONDS = 60; // Supabase allows one confirmation email per address per minute.

const CONTENT: Record<EmailConfirmationNoticeKind, { heading: string; message: string; help?: string; tone: "info" | "warning" | "success"; Icon: typeof Mail }> = {
  sent: {
    heading: "Check Your Email! 📩", tone: "info", Icon: Mail,
    message: "Please check your inbox for a verification link. Click the link to confirm your email address before logging in.",
    help: "Didn't receive an email? Check your Spam folder or select Resend Confirmation Email to request a new link.",
  },
  "maybe-sent": {
    heading: "Check Your Email!", tone: "info", Icon: Mail,
    message: "If your email address needs verification, you'll receive a confirmation link. Please check your inbox and Spam folder.",
  },
  expired: {
    heading: "Confirmation Link Expired", tone: "warning", Icon: MailX,
    message: "This confirmation link is invalid or has expired. Please open the newest confirmation email or request a new link.",
  },
  invalid: {
    heading: "We Couldn't Confirm Your Email", tone: "warning", Icon: MailX,
    message: "This confirmation link couldn't be used. Please open the newest confirmation email or request a new link.",
  },
  "not-verified": {
    heading: "Email Not Yet Verified", tone: "warning", Icon: MailWarning,
    message: "Please confirm your email address before logging in. Check your newest confirmation email or request another link below.",
  },
  verified: {
    heading: "Email Verified Successfully!", tone: "success", Icon: MailCheck,
    message: "Your email address is now verified. You can log in to Basa-Eskwela.",
  },
};

type ResendState = "idle" | "sending" | "requested" | "rate_limited" | "network" | "unavailable" | "needs_email";

const RESEND_FEEDBACK: Partial<Record<ResendState, string>> = {
  rate_limited: "Please wait a minute before requesting another email.",
  network: "We couldn't send the request. Check your internet connection and try again.",
  unavailable: "We couldn't send the request right now. Please try again later.",
  needs_email: "Enter your email address in the Email Address field above, then select Resend Confirmation Email.",
};

interface Props {
  kind: EmailConfirmationNoticeKind;
  /** The current, editable email address from the page's email field. */
  getEmail: () => string;
  onLogIn: () => void;
  onDismiss: () => void;
}

export default function EmailConfirmationNotice({ kind, getEmail, onLogIn, onDismiss }: Props) {
  const [resend, setResend] = useState<ResendState>("idle");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (!secondsLeft) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  // After a request the notice turns neutral: Supabase never confirms delivery to a given address.
  const requested = resend === "requested";
  const content = requested
    ? { ...CONTENT.sent, heading: "Check Your Email!", help: undefined,
        message: "If your email address needs verification, please check your inbox for a new confirmation link. Remember to check your Spam folder, too." }
    : CONTENT[kind];
  const { Icon } = content;
  const canResend = kind !== "verified";
  const offersLogIn = kind === "sent" || kind === "maybe-sent" || kind === "verified";

  async function requestNewLink() {
    const email = getEmail().trim();
    if (!isValidSignupEmail(email)) {
      setResend("needs_email");
      return;
    }
    setResend("sending");
    try {
      await resendSignupConfirmation(email);
      setResend("requested");
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    } catch (error) {
      const failure = error instanceof ResendConfirmationError ? error.kind : "unavailable";
      setResend(failure);
      if (failure === "rate_limited") setCooldownUntil(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    }
    setNow(Date.now());
  }

  return (
    <section className={`auth-notice auth-notice--${requested ? "info" : content.tone}`} role="status" aria-live="polite"
      aria-labelledby="auth-notice-title">
      <button type="button" className="auth-notice-dismiss" aria-label="Dismiss" onClick={onDismiss}>
        <X size={18} aria-hidden="true" />
      </button>
      <h2 id="auth-notice-title" className="auth-notice-title">
        <Icon size={20} aria-hidden="true" />
        <span>{content.heading}</span>
      </h2>
      <p className="auth-notice-message">{content.message}</p>
      {content.help && <p className="auth-notice-message">{content.help}</p>}
      {RESEND_FEEDBACK[resend] && <p className="auth-notice-feedback">{RESEND_FEEDBACK[resend]}</p>}
      {secondsLeft > 0 && <p className="auth-notice-feedback">You can request another email in {secondsLeft} seconds.</p>}
      <div className="auth-notice-actions">
        {offersLogIn && <button type="button" className="auth-notice-action" onClick={onLogIn}>Log In</button>}
        {canResend && (
          <button type="button" className="auth-notice-action" onClick={() => void requestNewLink()}
            disabled={resend === "sending" || secondsLeft > 0}>
            {resend === "sending" ? "Sending…" : "Resend Confirmation Email"}
          </button>
        )}
      </div>
    </section>
  );
}
