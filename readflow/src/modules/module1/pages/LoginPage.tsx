import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clearAuthRedirectResult, getAuthRedirectResult } from "../../../auth/authRedirect.ts";
import AuthFormError from "../components/AuthFormError.tsx";
import AuthLayout from "../components/AuthLayout.tsx";
import AuthSubmitButton from "../components/AuthSubmitButton.tsx";
import EmailConfirmationNotice, { type EmailConfirmationNoticeKind } from "../components/EmailConfirmationNotice.tsx";
import TextField from "../components/TextField.tsx";
import {
  getLoginErrorMessage,
  hasConfirmedEmailSession,
  isEmailNotConfirmedError,
  loginAndResolveDestination,
} from "../services/authLogin.ts";

type LoginLocationState = {
  passwordReset?: boolean;
  signupPendingConfirmation?: boolean;
  confirmationSent?: boolean;
  email?: string;
} | null;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LoginLocationState;
  const [email, setEmail] = useState(() => state?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [redirect] = useState(getAuthRedirectResult);
  const [notice, setNotice] = useState<EmailConfirmationNoticeKind | null>(() => {
    if (redirect?.kind === "link-error") return redirect.expired ? "expired" : "invalid";
    if (state?.signupPendingConfirmation) return state.confirmationSent ? "sent" : "maybe-sent";
    return null;
  });
  const passwordWasReset = Boolean(state?.passwordReset);

  useEffect(() => clearAuthRedirectResult(), []);

  // A confirmation link alone proves nothing; show success only once a confirmed session exists.
  useEffect(() => {
    if (redirect?.kind !== "signup-link") return;
    let active = true;
    void hasConfirmedEmailSession().then((confirmed) => {
      if (active && confirmed) setNotice("verified");
    });
    return () => {
      active = false;
    };
  }, [redirect]);

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
      if (isEmailNotConfirmedError(loginError)) {
        setNotice("not-verified");
      } else {
        setError(getLoginErrorMessage(loginError));
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Welcome Back!" subtitle="Log in to continue your learning journey">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {notice && (
          <EmailConfirmationNotice
            key={notice}
            kind={notice}
            getEmail={() => email}
            onLogIn={() => document.getElementById(email.trim() ? "password" : "email")?.focus()}
            onDismiss={() => setNotice(null)}
          />
        )}

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
