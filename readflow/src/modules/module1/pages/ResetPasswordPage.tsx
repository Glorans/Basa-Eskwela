import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import AuthFormError from "../components/AuthFormError";
import AuthLayout from "../components/AuthLayout";
import AuthSubmitButton from "../components/AuthSubmitButton";
import TextField from "../components/TextField";
import {
  AuthServiceError,
  logout,
  updatePassword,
} from "../../../services/authService";
import {
  getPasswordValidationError,
  PASSWORD_REQUIREMENTS,
} from "../utils/authOnboarding";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, loading: checkingSession, authEvent } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
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
    setSubmitting(true);

    try {
      await updatePassword(password);
      await logout();
      navigate("/login", {
        replace: true,
        state: { passwordReset: true },
      });
    } catch (updateError) {
      setError(
        updateError instanceof AuthServiceError
          ? "We couldn't update your password. The reset link may have expired."
          : "We couldn't reach the password service. Please try again.",
      );
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

        <AuthSubmitButton
          label="Save New Password"
          submitting={submitting}
          submittingLabel="Updating Password…"
        />
      </form>
    </AuthLayout>
  );
}
