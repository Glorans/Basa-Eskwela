import { FormEvent, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthFormError from "../components/AuthFormError.tsx";
import AuthLayout from "../components/AuthLayout.tsx";
import AuthSubmitButton from "../components/AuthSubmitButton.tsx";
import TextField from "../components/TextField.tsx";
import {
  AuthServiceError,
  register,
} from "../../../services/authService.ts";
import {
  getPasswordValidationError,
  isValidSignupEmail,
  normalizeAuthEmail,
} from "../utils/authOnboarding.ts";
import { acknowledgePolicyAtSignup } from "../services/policyAcknowledgment.ts";
import "./SignupAgree.css";

const AGREE_MESSAGE = "Please tick the box to show you have read the Terms of Use and Privacy Notice.";

export default function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  // Required Terms of Use / Privacy Notice checkbox: unchecked by default, never pre-ticked.
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState(false);
  const [showAccountHelp, setShowAccountHelp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Set synchronously, so even submits fired before React re-renders (and disables the
  // button) send only one sign-up request. Cleared after a failure so the user can retry.
  const inFlight = useRef(false);
  const agreeBox = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    setError("");
    setShowAccountHelp(false);

    if (!email.trim() || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (!isValidSignupEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const passwordError = getPasswordValidationError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (!agreed) {
      setAgreeError(true);
      setError(AGREE_MESSAGE);
      agreeBox.current?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      const { hasSession, confirmationSent } = await register(email, password);

      if (!hasSession) {
        navigate("/login", {
          state: { signupPendingConfirmation: true, confirmationSent, email: normalizeAuthEmail(email) },
        });
        return;
      }

      // The account has its own session, so the ticked box can be saved with it now. If it cannot be saved, the
      // first-login I Agree screen asks instead (no agreement is ever assumed).
      await acknowledgePolicyAtSignup();
      navigate("/select-role", { replace: true });
    } catch (signupError) {
      setShowAccountHelp(signupError instanceof AuthServiceError && signupError.kind === "account_help");
      setError(
        signupError instanceof AuthServiceError
          ? signupError.message
          : "We couldn't finish account setup. If your account was created, log in to continue.",
      );
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Create Your Account" subtitle="Join and start learning today">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email Address"
          type="email"
          placeholder="Enter Email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
          autoComplete="email"
          disabled={submitting}
        />

        <TextField
          id="password"
          label="Password"
          type="password"
          placeholder="Enter Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          autoComplete="new-password"
          showPasswordToggle
          disabled={submitting}
        />

        <TextField
          id="confirmPassword"
          label="Confirm Password"
          type="password"
          placeholder="Confirm Password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setError("");
          }}
          autoComplete="new-password"
          showPasswordToggle
          disabled={submitting}
        />

        <div className={`auth-agree${agreeError ? " auth-agree-invalid" : ""}`}>
          <input
            id="policyAgree"
            ref={agreeBox}
            type="checkbox"
            className="auth-agree-box"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) {
                setAgreeError(false);
                setError((current) => (current === AGREE_MESSAGE ? "" : current));
              }
            }}
            aria-invalid={agreeError || undefined}
            required
            disabled={submitting}
          />
          <label htmlFor="policyAgree" className="auth-agree-label">
            I have read and agree to the{" "}
            {/* New tab, so the details typed above stay on this page. */}
            <a href="/terms" target="_blank" rel="noreferrer" className="auth-text-link">Terms of Use<span className="auth-visually-hidden"> (opens in a new tab)</span></a>
            {" and "}
            <a href="/privacy" target="_blank" rel="noreferrer" className="auth-text-link">Privacy Notice<span className="auth-visually-hidden"> (opens in a new tab)</span></a>.
          </label>
        </div>

        <AuthFormError message={error} />

        {error && showAccountHelp && (
          <p className="auth-footer-link">
            <Link to="/login" className="auth-text-link">Log In</Link>
            {" or "}
            <Link to="/forgot-password" className="auth-text-link">Reset Password</Link>
          </p>
        )}

        <AuthSubmitButton
          label="Sign Up"
          submitting={submitting}
          submittingLabel="Creating Account…"
        />

        <p className="auth-footer-link">
          Already have an account?{" "}
          <Link to="/login" className="auth-text-link">
            Log In
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
