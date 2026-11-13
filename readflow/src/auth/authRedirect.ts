import { clearPasswordRecovery, isResetPasswordPath, markPasswordRecoveryPending } from "./recoverySession.ts";

/**
 * Reads the outcome of a Supabase email link before the Supabase client or the router see the URL.
 * Supabase sends a failed or replaced confirmation link back as
 * `#error=access_denied&error_code=otp_expired&error_description=…`, and a successful one as
 * `#access_token=…&type=signup`. Only these facts are kept; token values are never read or stored.
 * Password-reset links are handled by /reset-password. A successful one that arrives on another
 * page (for example, when Supabase falls back to the Site URL) is moved there with its fragment
 * intact, so the Supabase client still validates it and the user sees the reset form instead of
 * being silently signed in.
 */
export type AuthRedirectResult =
  | { kind: "link-error"; expired: boolean }
  | { kind: "signup-link" }
  | null;

const RESET_PASSWORD_PATH = "/reset-password";

function successfulCallbackType(href: string) {
  const hash = new URLSearchParams(new URL(href).hash.replace(/^#/, ""));
  if (!hash.has("access_token") || hash.has("error") || hash.has("error_code") || hash.has("error_description")) return null;
  return hash.get("type") ?? "other";
}

/** A successful implicit-flow password-reset callback: `#access_token=…&type=recovery`. */
export const isRecoveryCallback = (href: string) => successfulCallbackType(href) === "recovery";

export function parseAuthRedirect(href: string): { result: AuthRedirectResult; cleanUrl: string | null } {
  const url = new URL(href);
  // Only the real reset page (not, for example, /reset-password-other) handles its own links.
  if (isResetPasswordPath(url.pathname)) return { result: null, cleanUrl: null };
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const read = (key: string) => hash.get(key) ?? url.searchParams.get(key);
  if (read("error_code") || read("error_description")) {
    // The error details are dropped from the address bar; the login page explains them instead.
    return { result: { kind: "link-error", expired: read("error_code") === "otp_expired" }, cleanUrl: "/login" };
  }
  if (hash.get("type") === "signup" && hash.has("access_token")) {
    // The fragment stays so the Supabase client can finish the callback; it removes it afterwards.
    return { result: { kind: "signup-link" }, cleanUrl: `/login${url.hash}` };
  }
  if (isRecoveryCallback(href)) {
    // A fixed same-origin path; the fragment stays for the Supabase client to validate.
    return { result: null, cleanUrl: `${RESET_PASSWORD_PATH}${url.hash}` };
  }
  return { result: null, cleanUrl: null };
}

let pending: AuthRedirectResult = null;

export function captureAuthRedirect(win: Window = window) {
  // Runs before the Supabase client starts. A reset link makes this visit a pending recovery (no
  // daily-login reward until AuthProvider learns whether Supabase accepted it). Any other email-link
  // sign-in replaces the session, so an earlier recovery in this tab no longer applies.
  const callbackType = successfulCallbackType(win.location.href);
  if (callbackType === "recovery") markPasswordRecoveryPending();
  else if (callbackType !== null) clearPasswordRecovery();
  const { result, cleanUrl } = parseAuthRedirect(win.location.href);
  if (!cleanUrl) return;
  if (result) pending = result;
  win.history.replaceState(win.history.state, "", cleanUrl);
}

export const getAuthRedirectResult = () => pending;

export function clearAuthRedirectResult() {
  pending = null;
}
