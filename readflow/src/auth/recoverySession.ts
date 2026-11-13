/**
 * Remembers, for one browser tab, that its Supabase session came from a password-reset link, so
 * that visit is not treated as a genuine sign-in (it must not earn the M8 daily-login reward).
 * Only a state word is stored. Token values are never read or kept, and nothing expires on a timer.
 *
 * - "pending": a reset link was seen in this page's address (set before the Supabase client
 *   starts). Kept in memory only, so it can never outlive the page load that saw the link.
 * - "active": Supabase accepted the link and saved its session (see confirmPasswordRecovery).
 *   Kept in sessionStorage: it survives a refresh of this tab, ends when the tab closes, and
 *   never affects other tabs.
 *
 * Cleared on sign-out, a successful password sign-in, another email-link sign-in, a different
 * user's sign-in, or when the link turns out to be invalid.
 */
export type PasswordRecoveryState = "pending" | "active" | null;

const KEY = "basa.auth.passwordRecovery";
const RESET_PASSWORD_PATH = "/reset-password";
let pending = false;
let memoryActive = false; // used only when sessionStorage is unavailable
const listeners = new Set<() => void>();

function tabStore(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readActive() {
  try {
    const store = tabStore();
    if (store) return store.getItem(KEY) === "active";
  } catch {
    // Fall back to memory below.
  }
  return memoryActive;
}

function writeActive(active: boolean) {
  memoryActive = active;
  try {
    if (active) tabStore()?.setItem(KEY, "active");
    else tabStore()?.removeItem(KEY);
  } catch {
    // Memory still holds the value for this page.
  }
}

export function getPasswordRecoveryState(): PasswordRecoveryState {
  if (readActive()) return "active";
  return pending ? "pending" : null;
}

function update(change: () => void) {
  const before = getPasswordRecoveryState();
  change();
  if (getPasswordRecoveryState() !== before) listeners.forEach((listener) => listener());
}

/** A reset link was found in this page's address. Not yet proof that it is valid. */
export const markPasswordRecoveryPending = () => update(() => { pending = true; });

/** Supabase accepted the reset link (or reported PASSWORD_RECOVERY in this tab). */
export const confirmPasswordRecovery = () => update(() => {
  pending = false;
  if (!readActive()) writeActive(true); // both Supabase's start-up result and its event confirm
});

export const clearPasswordRecovery = () => update(() => { pending = false; writeActive(false); });

export const isPasswordRecoveryPending = () => getPasswordRecoveryState() === "pending";
export const isPasswordRecoveryMarked = () => getPasswordRecoveryState() !== null;

export function onPasswordRecoveryChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The app's reset page: exactly /reset-password (a trailing slash is the same route). */
export const isResetPasswordPath = (pathname: string) =>
  pathname === RESET_PASSWORD_PATH || pathname === `${RESET_PASSWORD_PATH}/`;

/** True when a recovery visit or the reset page must not count as a daily login. */
export const blocksDailyLogin = (pathname: string) =>
  isPasswordRecoveryMarked() || isResetPasswordPath(pathname);
