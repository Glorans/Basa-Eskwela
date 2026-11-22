// Terms of Use and Privacy Notice acknowledgment (m1_policy_acknowledgment_v1).
// Records only the user, the policy version, whether that version was a draft or an approved one, and the time. It is an
// acknowledgment, never verified parent or guardian consent. The database decides which version (if any) is active;
// the page never sends a version it was not shown.
import { supabase } from "../../../lib/supabaseClient";

export type PolicyVersionStatus = "draft" | "approved";

export type PolicyStatus =
  | { state: "acknowledged"; version: string; versionStatus: PolicyVersionStatus; acknowledgedAt: string }
  | { state: "required"; version: string; versionStatus: PolicyVersionStatus }
  /** No version is active, or the step is not installed yet: sign-in continues as before. */
  | { state: "unavailable" };

const MISSING = new Set(["PGRST202", "42883", "PGRST205", "42P01"]);
// One check per signed-in user per page load: the guard runs on every protected route.
const cache = new Map<string, Promise<PolicyStatus>>();

type StatusRow = { policy_version: string | null; policy_status: string | null; acknowledged_at: string | null; required?: boolean | null };
const versionStatus = (value: string | null | undefined): PolicyVersionStatus => (value === "approved" ? "approved" : "draft");

export function getPolicyStatus(userId: string): Promise<PolicyStatus> {
  let pending = cache.get(userId);
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabase.rpc("m1_my_policy_status" as never);
      if (error) {
        if (MISSING.has(String((error as { code?: string }).code))) return { state: "unavailable" } as const;
        throw new Error("Unable to check the Terms of Use and Privacy Notice. Please reload the page.");
      }
      const row = (Array.isArray(data) ? data[0] : data) as StatusRow | null;
      if (!row?.policy_version) return { state: "unavailable" } as const;
      return row.acknowledged_at
        ? { state: "acknowledged", version: row.policy_version, versionStatus: versionStatus(row.policy_status), acknowledgedAt: row.acknowledged_at } as const
        : { state: "required", version: row.policy_version, versionStatus: versionStatus(row.policy_status) } as const;
    })();
    pending.catch(() => cache.delete(userId));
    cache.set(userId, pending);
  }
  return pending;
}

/** Records "I Agree" for the version the user was shown. A repeat keeps the first time. Never reports success unless
 * the database returned the saved acknowledgment. */
export async function acknowledgePolicy(userId: string, version: string): Promise<string> {
  const { data, error } = await supabase.rpc("m1_acknowledge_policy" as never, { p_version: version } as never);
  const row = (Array.isArray(data) ? data[0] : data) as StatusRow | null;
  if (error || !row?.acknowledged_at) {
    cache.delete(userId);
    const message = (error as { message?: string } | null)?.message;
    throw new Error(message && /Reload the page/.test(message)
      ? message
      : "Your agreement could not be saved. Check your connection and press I Agree again.");
  }
  cache.set(userId, Promise.resolve({ state: "acknowledged", version, versionStatus: versionStatus(row.policy_status), acknowledgedAt: row.acknowledged_at }));
  return row.acknowledged_at;
}

/** Sign Up checkbox: right after a new account gets its own session, record the acknowledgment for the version the
 * database says is ACTIVE (the server stores whether that is a draft or an approved version). Best effort: if no version
 * is active, the step is not installed, or the save fails, nothing is recorded and the first-login I Agree screen still
 * asks. Never call this unless the user ticked the box. Returns true only when the database confirmed the save. */
export async function acknowledgePolicyAtSignup(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return false;
    const status = await getPolicyStatus(userId);
    if (status.state === "acknowledged") return true;
    if (status.state !== "required") return false;
    await acknowledgePolicy(userId, status.version);
    return true;
  } catch {
    return false;
  }
}

/** Clears the cached status (sign-out, another user). */
export function forgetPolicyStatus() { cache.clear(); }
