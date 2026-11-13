import { supabase } from "../lib/supabaseClient.ts";
import { normalizeAuthEmail } from "../modules/module1/utils/authOnboarding.ts";
import { clearAllModuleDrafts } from "../modules/module3/utils/moduleDraftStorage.ts";
import { clearPasswordRecovery } from "../auth/recoverySession.ts";

/** account_help: the page should offer Log In and Forgot Password as next steps. */
export type AuthServiceErrorKind = "account_help";

/**
 * What the auth provider reported, from its stable error codes and statuses (never its text).
 * Pages can word the same failure differently for their context.
 */
export type AuthServiceErrorReason =
  | "same_password"
  | "weak_password"
  | "reauthentication"
  | "rate_limited"
  | "session_expired"
  | "invalid_email"
  | "network"
  | "unavailable";

export class AuthServiceError extends Error {
  constructor(message: string, readonly kind?: AuthServiceErrorKind, readonly reason?: AuthServiceErrorReason) {
    super(message);
    this.name = "AuthServiceError";
  }
}

type ProviderError = { message: string; code?: string; status?: number; name?: string };

/** No HTTP status at all, or supabase-js's retryable fetch failure: the service wasn't reached. */
const isNetworkFailure = (error: ProviderError) => !error.status || error.name === "AuthRetryableFetchError";

// Sign-up failures get clear next steps instead of Supabase's internal text. The wording never
// confirms that an account exists; with email confirmation on, Supabase may hide that anyway.
function signupError(error: { message: string; code?: string; status?: number }) {
  const code = error.code ?? "";
  if (["user_already_exists", "email_exists", "identity_already_exists"].includes(code)
    || /already (registered|exists)/i.test(error.message)) {
    return new AuthServiceError(
      "We couldn't create a new account with this email. If you already have a Basa Eskwela account, log in or reset your password.",
      "account_help",
    );
  }
  if (code.startsWith("over_") || error.status === 429) {
    return new AuthServiceError(
      "Too many sign-up attempts right now. Please wait a few minutes and try again. If you already have an account, log in or reset your password.",
      "account_help",
    );
  }
  if (code === "weak_password") return new AuthServiceError("Choose a stronger password and try again.");
  if (code === "email_address_invalid") return new AuthServiceError("Enter a valid email address.");
  if (code === "signup_disabled" || code === "email_provider_disabled") {
    return new AuthServiceError("New accounts can't be created right now. Please try again later.");
  }
  return new AuthServiceError("We couldn't create your account right now. Please try again.");
}

function throwIfAuthError(error: { message: string } | null) {
  if (error) {
    throw new AuthServiceError(error.message);
  }
}

export async function register(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email: normalizeAuthEmail(email),
    password,
  });

  if (error) throw signupError(error);
  // A new identity with a recorded send time is the only reliable sign that a confirmation email
  // went out; Supabase hides existing accounts behind an empty identity list.
  const identities = data.user?.identities ?? [];
  return {
    hasSession: Boolean(data.session),
    confirmationSent: identities.length > 0 && Boolean(data.user?.confirmation_sent_at),
  };
}

export type ResendConfirmationErrorKind = "rate_limited" | "network" | "unavailable";

export class ResendConfirmationError extends Error {
  constructor(readonly kind: ResendConfirmationErrorKind) {
    super(kind);
    this.name = "ResendConfirmationError";
  }
}

/**
 * Asks Supabase to send a new sign-up confirmation email. Resolves the same way whether or not
 * the address has an account, so the result never reveals account existence.
 */
export async function resendSignupConfirmation(email: string) {
  const { error } = await supabase.auth.resend({ type: "signup", email: normalizeAuthEmail(email) });
  if (!error) return;
  if ((error.code ?? "").startsWith("over_") || error.status === 429) throw new ResendConfirmationError("rate_limited");
  if (!error.status || error.name === "AuthRetryableFetchError") throw new ResendConfirmationError("network");
  if (error.status >= 500) throw new ResendConfirmationError("unavailable");
  // Other client errors (for example, an already confirmed address) stay neutral on purpose.
}

/** True only when Supabase holds a session whose user has a confirmed email address. */
export async function hasConfirmedEmailSession() {
  const { data, error } = await supabase.auth.getSession();
  return !error && Boolean(data.session?.user?.email_confirmed_at);
}

export async function login(email: string, password: string) {
  const result = await supabase.auth.signInWithPassword({
    email: normalizeAuthEmail(email),
    password,
  });
  // A genuine password sign-in replaces any session that came from a password-reset link.
  if (!result.error && result.data.session) clearPasswordRecovery();
  return result;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  // Unsaved module text kept for recovery must not outlive an explicit logout.
  if (!error) clearAllModuleDrafts();
  return !error;
}

export async function requestPasswordReset(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    normalizeAuthEmail(email),
    { redirectTo },
  );

  if (error) throw passwordResetRequestError(error);
}

// Supabase answers success whether or not the address has an account, so none of these messages
// can reveal one. Delivery problems (for example, a recipient the email sender won't accept) and
// unknown failures share one message; provider wording is never shown.
export function passwordResetRequestError(error: ProviderError) {
  const code = error.code ?? "";
  if (code.startsWith("over_") || error.status === 429) {
    return new AuthServiceError(
      "Too many password reset requests have been made. Please wait a while before trying again. If a reset email already arrived, use the newest link.",
      undefined,
      "rate_limited",
    );
  }
  if (code === "email_address_invalid") {
    return new AuthServiceError("Please enter a valid email address.", undefined, "invalid_email");
  }
  if (isNetworkFailure(error)) {
    return new AuthServiceError(
      "We couldn't reach the password recovery service. Check your internet connection and try again.",
      undefined,
      "network",
    );
  }
  return new AuthServiceError(
    "We couldn't send the password reset email right now. Please try again later. If this keeps happening, contact your teacher or school administrator.",
    undefined,
    "unavailable",
  );
}

function passwordChangeReason(error: ProviderError): AuthServiceErrorReason {
  const code = error.code ?? "";
  if (code === "same_password") return "same_password";
  if (code === "weak_password") return "weak_password";
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid") return "reauthentication";
  if (code.startsWith("over_") || error.status === 429) return "rate_limited";
  if (code === "session_not_found" || code === "session_expired" || error.status === 401
    || error.name === "AuthSessionMissingError") return "session_expired";
  if (isNetworkFailure(error)) return "network";
  return "unavailable";
}

// Messages only describe what the auth provider actually reported. "same_password" means the
// provider compared the new password with the current one; there is no password history.
// Settings shows these messages unchanged; the reset-password page words the reasons for its context.
export function passwordChangeError(error: ProviderError) {
  const code = error.code ?? "";
  const reason = passwordChangeReason(error);
  if (code === "same_password") {
    return new AuthServiceError("Your new password must be different from your current password. Your password was not changed.", undefined, reason);
  }
  if (code === "weak_password") {
    return new AuthServiceError("Choose a stronger password. Your password was not changed.", undefined, reason);
  }
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid") {
    return new AuthServiceError("For your security, sign out and sign in again, then change your password. Your password was not changed.", undefined, reason);
  }
  if (code.startsWith("over_") || error.status === 429) {
    return new AuthServiceError("Too many attempts. Please wait a few minutes before changing your password again.", undefined, reason);
  }
  if (code === "session_not_found" || code === "session_expired" || error.status === 401) {
    return new AuthServiceError("Your session has ended. Sign in again to change your password.", undefined, reason);
  }
  return new AuthServiceError("We couldn't change your password right now. Please try again. Your password was not changed.", undefined, reason);
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw passwordChangeError(error);
}

export async function updateEmail(email: string) {
  const { error } = await supabase.auth.updateUser({
    email: normalizeAuthEmail(email),
  });
  throwIfAuthError(error);
}
