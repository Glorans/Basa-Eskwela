// Wording for a failed "Save New Password" on the reset-password page. The reason comes from
// authService (stable provider codes); thrown errors that never reached the service are network.

export type RecoveryUpdateFailure = { message: string; linkExpired: boolean };

const NOT_CHANGED = "Your password was not changed.";

export function recoveryPasswordUpdateFailure(error: unknown): RecoveryUpdateFailure {
  const failure = typeof error === "object" && error !== null ? error as { name?: unknown; reason?: unknown } : {};
  const reason = failure.name === "AuthServiceError" ? failure.reason : "network";

  switch (reason) {
    case "same_password":
      return { message: `Your new password must be different from your current password. ${NOT_CHANGED}`, linkExpired: false };
    case "weak_password":
      return { message: `This password doesn't meet the security requirements. Choose a stronger password. ${NOT_CHANGED}`, linkExpired: false };
    case "rate_limited":
      return { message: `Too many attempts. Please wait a while before trying again. ${NOT_CHANGED}`, linkExpired: false };
    case "session_expired":
      return { message: `This password reset link has expired. Request a new reset link to continue. ${NOT_CHANGED}`, linkExpired: true };
    case "reauthentication":
      // Supabase asked for extra identity confirmation; the link itself may still be valid.
      return { message: `For your security, this password change needs extra confirmation that couldn't be completed here. Close this page and start again from Forgot Password. ${NOT_CHANGED}`, linkExpired: false };
    case "network":
      return { message: `We couldn't reach the password service. Check your internet connection and try again. ${NOT_CHANGED}`, linkExpired: false };
    default:
      return { message: `We couldn't update your password right now. Please try again. ${NOT_CHANGED}`, linkExpired: false };
  }
}
