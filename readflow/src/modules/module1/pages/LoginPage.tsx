import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthFormError from "../components/AuthFormError.tsx";
import AuthLayout from "../components/AuthLayout.tsx";
import AuthSubmitButton from "../components/AuthSubmitButton.tsx";
import TextField from "../components/TextField.tsx";
import {
  getLoginErrorMessage,
  loginAndResolveDestination,
} from "../services/authLogin.ts";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const passwordWasReset = Boolean(
    (location.state as { passwordReset?: boolean } | null)?.passwordReset,
  );
  const signupNeedsConfirmation = Boolean(
    (location.state as { signupPendingConfirmation?: boolean } | null)
      ?.signupPendingConfirmation,
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setSubmitting(true);

    try {
      const destination = await loginAndResolveDestination(email, password);
      navigate(destination, { replace: true });
    } catch (loginError) {
      setError(getLoginErrorMessage(loginError));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Welcome Back!" subtitle="Log in to continue your learning journey">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email Address"
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={submitting}
        />

        <TextField
          id="password"
          label="Password"
          type="password"
          placeholder="Enter Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          showPasswordToggle
          disabled={submitting}
        />

        {passwordWasReset && !error && (
          <p className="auth-status" role="status">
            Your password was changed successfully. Log in with your new password.
          </p>
        )}

        {signupNeedsConfirmation && !error && (
          <p className="auth-status" role="status">
            Account created. Check your email to confirm it before logging in.
          </p>
        )}

        <AuthFormError message={error} />

        <div className="auth-forgot-row">
          <Link to="/forgot-password" className="auth-text-link">
            Forgot password?
          </Link>
        </div>

        <AuthSubmitButton
          label="Log In"
          submitting={submitting}
          submittingLabel="Logging In…"
        />

        <p className="auth-footer-link">
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="auth-text-link">
            Sign Up
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
