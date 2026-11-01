import { FormEvent, useState } from "react";
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

export default function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [showAccountHelp, setShowAccountHelp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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

    setSubmitting(true);
    try {
      const { hasSession, confirmationSent } = await register(email, password);

      if (!hasSession) {
        navigate("/login", {
          state: { signupPendingConfirmation: true, confirmationSent, email: normalizeAuthEmail(email) },
        });
        return;
      }

      navigate("/select-role", { replace: true });
    } catch (signupError) {
      setShowAccountHelp(signupError instanceof AuthServiceError && signupError.kind === "account_help");
      setError(
        signupError instanceof AuthServiceError
          ? signupError.message
          : "We couldn't finish account setup. If your account was created, log in to continue.",
      );
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
