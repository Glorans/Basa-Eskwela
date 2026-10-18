import { FormEvent, useState } from "react";
import AuthFormError from "../components/AuthFormError";
import AuthLayout from "../components/AuthLayout";
import AuthSubmitButton from "../components/AuthSubmitButton";
import TextField from "../components/TextField";
import {
  AuthServiceError,
  requestPasswordReset,
} from "../../../services/authService";
import { isValidSignupEmail, normalizeAuthEmail } from "../utils/authOnboarding";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = normalizeAuthEmail(email);

    if (!normalizedEmail) {
      setError("Please enter your email address.");
      return;
    }

    if (!isValidSignupEmail(normalizedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      await requestPasswordReset(
        normalizedEmail,
        `${window.location.origin}/reset-password`,
      );
      setSubmitted(true);
    } catch (recoveryError) {
      setError(
        recoveryError instanceof AuthServiceError
          ? "We couldn't send password reset instructions. Please try again."
          : "We couldn't reach the password recovery service. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Forgot Password" backTo="/login" backLabel="Back to Login">
      <form className="auth-form auth-recovery-form" onSubmit={handleSubmit} noValidate>
        {submitted ? (
          <p className="auth-status" role="status">
            If an account exists for this email, we&apos;ve sent password reset
            instructions. Check your inbox.
          </p>
        ) : (
          <>
        <TextField
          id="recoveryEmail"
          label="Enter your email address"
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError("");
          }}
          autoComplete="email"
          disabled={submitting}
        />

        <AuthFormError message={error} />

        <AuthSubmitButton
          label="Send Reset Link"
          submitting={submitting}
          submittingLabel="Sending…"
        />
          </>
        )}
      </form>
    </AuthLayout>
  );
}
