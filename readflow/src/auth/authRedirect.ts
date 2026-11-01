/**
 * Reads the outcome of a Supabase email link before the Supabase client or the router see the URL.
 * Supabase sends a failed or replaced confirmation link back as
 * `#error=access_denied&error_code=otp_expired&error_description=…`, and a successful one as
 * `#access_token=…&type=signup`. Only these facts are kept; token values are never read or stored.
 * Password-reset links are left entirely to /reset-password.
 */
export type AuthRedirectResult =
  | { kind: "link-error"; expired: boolean }
  | { kind: "signup-link" }
  | null;

export function parseAuthRedirect(href: string): { result: AuthRedirectResult; cleanUrl: string | null } {
  const url = new URL(href);
  if (url.pathname.startsWith("/reset-password")) return { result: null, cleanUrl: null };
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
  return { result: null, cleanUrl: null };
}

let pending: AuthRedirectResult = null;

export function captureAuthRedirect(win: Window = window) {
  const { result, cleanUrl } = parseAuthRedirect(win.location.href);
  if (!result || !cleanUrl) return;
  pending = result;
  win.history.replaceState(win.history.state, "", cleanUrl);
}

export const getAuthRedirectResult = () => pending;

export function clearAuthRedirectResult() {
  pending = null;
}
