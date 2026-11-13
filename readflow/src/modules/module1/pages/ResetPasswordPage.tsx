import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import AuthFormError from "../components/AuthFormError";
import AuthLayout from "../components/AuthLayout";
import AuthSubmitButton from "../components/AuthSubmitButton";
import TextField from "../components/TextField";
import {
  logout,
  updatePassword,
} from "../../../services/authService";
import {
  getPasswordValidationError,
  PASSWORD_REQUIREMENTS,
} from "../utils/authOnboarding";
import { recoveryPasswordUpdateFailure } from "../utils/passwordRecoveryMessages";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, loading: checkingSession, authEvent } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [linkExpired, setLinkExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryEventReceived, setRecoveryEventReceived] = useState(
    authEvent === "PASSWORD_RECOVERY",
  );
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hasRecoveryLink = search.has("code") || hash.get("type") === "recovery";
  const hasRecoverySession = Boolean(user)
    && (recoveryEventReceived || hasRecoveryLink);

  useEffect(() => {
    if (authEvent === "PASSWORD_RECOVERY") setRecoveryEventReceived(true);
  }, [authEvent]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!password || !confirmPassword) {
      setError("Please enter and confirm your new password.");
      return;
    }

    const validationError = getPasswordValidationError(password);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setLinkExpired(false);
    setSubmitting(true);

    try {
      await updatePassword(password);
      await logout();
      navigate("/login", {
        replace: true,
        state: { passwordReset: true },
      });
    } catch (updateError) {
      // Only an ended recovery session is reported as an expired link; a rejected password says why.
      const failure = recoveryPasswordUpdateFailure(updateError);
      setError(failure.message);
      setLinkExpired(failure.linkExpired);
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return null;
  }

  if (!hasRecoverySession) {
    return (
      <AuthLayout title="Reset Password" backTo="/login" backLabel="Back to Login">
        <AuthFormError message="This password reset link is invalid or has expired." />
        <p className="auth-footer-link">
          <Link to="/forgot-password" className="auth-text-link">
            Request a new reset link
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset Password" backTo="/login" backLabel="Back to Login">
      <form className="auth-form auth-recovery-form" onSubmit={handleSubmit} noValidate>
        <TextField
          id="newPassword"
          label="Enter New Password"
          type="password"
          placeholder="Enter your new password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError("");
          }}
          autoComplete="new-password"
          showPasswordToggle
          disabled={submitting}
        />

        <div className="auth-password-checks">
          {PASSWORD_REQUIREMENTS.map((requirement) => (
            <span key={requirement.label} data-passed={requirement.test(password)}>
              {requirement.test(password) ? "✓" : "○"} {requirement.label}
            </span>
          ))}
        </div>

        <TextField
          id="confirmNewPassword"
          label="Confirm Password"
          type="password"
          placeholder="Confirm your password"
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            if (error) setError("");
          }}
          autoComplete="new-password"
          showPasswordToggle
          disabled={submitting}
        />

        <AuthFormError message={error} />
        {linkExpired && (
          <p className="auth-footer-link">
            <Link to="/forgot-password" className="auth-text-link">
              Request a new reset link
            </Link>
          </p>
        )}

        <AuthSubmitButton
          label="Save New Password"
          submitting={submitting}
          submittingLabel="Updating Password…"
        />
      </form>
    </AuthLayout>
  );
}
