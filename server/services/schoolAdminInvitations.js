// M1 F8 Create School Admin: authorization record + invitation lifecycle (System Admin only).
//
// Lifecycle (database functions in supabase/proposed/m1_school_admin_invitations_PROPOSED.sql):
//   authorized -> pending (Auth user exists, profiles.role stays NULL = no School Admin access anywhere)
//   -> accepted (setup link opened, password set, accepted in that link session) -> active School Admin
//   cancelled (terminal: profile inactive + Auth ban, so Forgot Password cannot revive it). Expired = pending past
//   expires_at: cannot be accepted until a System Admin resends (re-authorizes).
//
// The invitation email is the existing password-setup (recovery) email, verified locally against GoTrue 2.197:
// the account is created UNCONFIRMED, opening the link confirms the email, and the link session carries an
// amr method "otp" timestamped after the send. Acceptance requires exactly that (never last_sign_in_at).
const { getSupabaseAdmin } = require("./supabaseAdmin");

const VALID_DAYS = 7;
const CANCEL_BAN = "876000h";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIRMATION_METHODS = Object.freeze({
  official_school_email: "Email from an official school address",
  official_school_phone: "Call to the school's official phone number",
  signed_letter: "Signed letter or form from the school",
  in_person: "In-person meeting with the school representative",
  other_documented: "Other documented confirmation",
});
// Sign-in methods GoTrue records for a session created from an emailed link.
const LINK_METHODS = new Set(["otp", "recovery", "magiclink", "invite", "email/signup"]);

// The route maps AdminUserOperationError to its status code (adminUserService loads this module lazily: no cycle).
const { AdminUserOperationError } = require("./adminUserService");
// Validation errors default to 400 (AdminUserOperationError itself defaults to 500).
class InvitationError extends AdminUserOperationError {
  constructor(message, statusCode = 400) { super(message, statusCode); }
}

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Validates the System Admin's recorded authorization basis. Records a decision; it does not verify anything. */
function readAuthorization(input) {
  const reference = text(input?.reference);
  const method = String(input?.confirmationMethod ?? "");
  const position = text(input?.authorizingPosition);
  const note = text(input?.note);
  if (reference.length < 5 || reference.length > 300) throw new InvitationError("Enter the authorization reference (5 to 300 characters).");
  if (!Object.prototype.hasOwnProperty.call(CONFIRMATION_METHODS, method)) throw new InvitationError("Choose how the request was confirmed.");
  if (position.length < 2 || position.length > 100) throw new InvitationError("Enter the position of the person who authorized the request (2 to 100 characters).");
  if (note.length > 500) throw new InvitationError("The note can be at most 500 characters.");
  return { reference, method, position, note: note || null };
}

function databaseError(error, fallback = "The invitation could not be saved. No change was made.") {
  const message = `${error?.code ?? ""} ${error?.message ?? ""}`;
  if (/PGRST202|Could not find the function|PGRST205|Could not find the table|42P01/i.test(message)) {
    return new InvitationError("School Admin invitations need the M1 invitation database update. No change was made.", 503);
  }
  const known = {
    m1_invite_actor_not_system_admin: ["Only an active System Admin can manage School Admin invitations.", 403],
    m1_invite_duplicate: ["This account already has a School Admin invitation.", 409],
    m1_invite_target_not_unassigned: ["This account cannot receive a School Admin invitation.", 409],
    m1_invite_email_mismatch: ["The invitation email does not match the account.", 409],
    m1_invite_not_pending: ["Only a pending invitation can be resent or cancelled.", 409],
    m1_invite_none: ["There is no School Admin invitation for this account.", 404],
    m1_invite_already_accepted: ["This invitation has already been accepted.", 409],
    m1_invite_cancelled: ["This invitation was cancelled. Ask your System Admin for a new one.", 410],
    m1_invite_expired: ["This invitation has expired. Ask your System Admin to resend it.", 410],
    m1_invite_link_not_current: ["Open the most recent setup link from your invitation email, then set your password again.", 403],
    m1_invite_email_unconfirmed: ["Open the setup link from your invitation email first.", 403],
    m1_invite_password_not_set: ["Set your password first.", 403],
  };
  const key = Object.keys(known).find((k) => message.includes(k));
  return key ? new InvitationError(...known[key]) : new InvitationError(fallback, 502);
}

function setupRedirect(env = process.env) {
  const origin = String(env.FRONTEND_ORIGIN || "").split(",").map((v) => v.trim()).find(Boolean);
  if (!origin || !/^https?:\/\/[^\s/]+$/i.test(origin.replace(/\/$/, ""))) return null;
  return `${origin.replace(/\/$/, "")}/reset-password`;
}

async function listAuthUsers(supabase) {
  const users = []; let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new InvitationError("Unable to check existing accounts.", 502);
    users.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < 1000) return users;
    page += 1;
  }
}

async function sendSetupEmail(supabase, email, redirectTo) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return !error;
}

/**
 * Authorize + invite. Order (fails closed):
 *  1. create the Auth user UNCONFIRMED (the signup trigger gives it a role-less profile: no access);
 *  2. record the authorization and pending invitation atomically; on failure the never-used Auth user is removed;
 *  3. record the send (sets the validity window), then send the setup email; a failed send is recorded and the
 *     invitation stays pending for Resend. At no point does the account hold the School Admin role.
 */
async function createSchoolAdmin(input, dependencies = {}, requester = {}) {
  const email = String(input?.email ?? "").trim().toLowerCase();
  const fullName = text(input?.fullName);
  if (!EMAIL_PATTERN.test(email)) throw new InvitationError("Enter a valid email address.");
  if (!fullName || fullName.length > 100) throw new InvitationError("Enter the School Admin's full name (up to 100 characters).");
  const authorization = readAuthorization(input?.authorization);
  const actorId = requester.userId;
  if (!actorId) throw new InvitationError("Only an active System Admin can create School Admin invitations.", 403);
  const redirectTo = (dependencies.passwordSetupRedirect ?? setupRedirect)();
  if (!redirectTo) throw new InvitationError("The password-setup link is not configured on the server.", 503);

  const supabase = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  if ((await listAuthUsers(supabase)).some((u) => String(u.email ?? "").toLowerCase() === email)) {
    throw new InvitationError("An account with this email address already exists.", 409);
  }
  // app_metadata (writable only with the service role) marks the account as invited so the browser can show the
  // invitation screens WITHOUT asking the backend. It is a display hint only: access is decided in the database.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email, email_confirm: false, app_metadata: { school_admin_invitation: true },
  });
  const newId = created?.user?.id;
  if (createError || !newId) {
    throw new InvitationError(createError?.status === 422 ? "An account with this email address already exists." : "Unable to create the account.",
      createError?.status === 422 ? 409 : 502);
  }

  const invited = await supabase.rpc("m1_create_school_admin_invitation", {
    p_actor: actorId, p_user: newId, p_email: email, p_full_name: fullName, p_reference: authorization.reference,
    p_method: authorization.method, p_position: authorization.position, p_note: authorization.note, p_valid_days: VALID_DAYS,
  });
  if (invited.error || !invited.data) {
    // The Auth user was created moments ago by this request and never used: remove it so nothing half-made remains.
    const cleanup = await supabase.auth.admin.deleteUser(newId).catch(() => ({ error: true }));
    if (cleanup?.error) console.error("[M1 invitation] cleanup of an unused Auth user failed; it has no role and no access.");
    throw databaseError(invited.error, "The invitation could not be recorded. No School Admin was created.");
  }
  const invitationId = invited.data;
  const recorded = await supabase.rpc("m1_record_school_admin_invitation_email", { p_actor: actorId, p_invitation: invitationId, p_outcome: "sent", p_valid_days: VALID_DAYS });
  let setupEmailSent = false;
  if (!recorded.error) {
    setupEmailSent = await sendSetupEmail(supabase, email, redirectTo);
    if (!setupEmailSent) await supabase.rpc("m1_record_school_admin_invitation_email", { p_actor: actorId, p_invitation: invitationId, p_outcome: "failed", p_valid_days: VALID_DAYS });
  }
  return { id: newId, invitationId, email, fullName, role: null, invitationStatus: "pending", setupEmailSent, expiresAt: recorded.data ?? null };
}

async function loadInvitation(supabase, invitationId) {
  const { data, error } = await supabase.from("m1_school_admin_invitations").select("id, user_id, email, status, expires_at").eq("id", invitationId).maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new InvitationError("Invitation not found.", 404);
  return data;
}

/** Resend: re-authorizes (renews the validity window) and sends a new setup link. Pending invitations only. */
async function resendSchoolAdminInvitation(actorId, invitationId, dependencies = {}) {
  const supabase = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const redirectTo = (dependencies.passwordSetupRedirect ?? setupRedirect)();
  if (!redirectTo) throw new InvitationError("The password-setup link is not configured on the server.", 503);
  const invitation = await loadInvitation(supabase, invitationId);
  if (invitation.status !== "pending") throw new InvitationError("Only a pending invitation can be resent.", 409);
  const recorded = await supabase.rpc("m1_record_school_admin_invitation_email", { p_actor: actorId, p_invitation: invitationId, p_outcome: "resent", p_valid_days: VALID_DAYS });
  if (recorded.error) throw databaseError(recorded.error);
  const sent = await sendSetupEmail(supabase, invitation.email, redirectTo);
  if (!sent) await supabase.rpc("m1_record_school_admin_invitation_email", { p_actor: actorId, p_invitation: invitationId, p_outcome: "failed", p_valid_days: VALID_DAYS });
  return { invitationId, setupEmailSent: sent, expiresAt: recorded.data };
}

/** Cancel (terminal). Ban first so the account can never sign in; if the database step fails, the ban is undone. */
async function cancelSchoolAdminInvitation(actorId, invitationId, reason, dependencies = {}) {
  const supabase = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const invitation = await loadInvitation(supabase, invitationId);
  if (invitation.status !== "pending") throw new InvitationError("Only a pending invitation can be cancelled. Deactivate an active School Admin instead.", 409);
  const banned = await supabase.auth.admin.updateUserById(invitation.user_id, { ban_duration: CANCEL_BAN });
  if (banned.error) throw new InvitationError("The invitation could not be cancelled. No change was made.", 502);
  const cancelled = await supabase.rpc("m1_cancel_school_admin_invitation", { p_actor: actorId, p_invitation: invitationId, p_reason: text(reason).slice(0, 300) || null });
  if (cancelled.error) {
    await supabase.auth.admin.updateUserById(invitation.user_id, { ban_duration: "none" });
    throw databaseError(cancelled.error, "The invitation could not be cancelled. No change was made.");
  }
  return { invitationId, status: "cancelled" };
}

/** The latest time this session was created from an emailed link, from the verified access token's amr claim. */
function linkSessionTime(accessToken, userId) {
  try {
    const claims = JSON.parse(Buffer.from(String(accessToken).split(".")[1], "base64url").toString("utf8"));
    if (claims.sub !== userId) return null;
    const times = (claims.amr ?? []).filter((a) => LINK_METHODS.has(a?.method) && Number.isFinite(a?.timestamp)).map((a) => a.timestamp);
    return times.length ? new Date(Math.max(...times) * 1000).toISOString() : null;
  } catch { return null; }
}

/** The invitee accepts in the session created by the setup link, after setting a password. */
async function acceptSchoolAdminInvitation(user, accessToken, dependencies = {}) {
  const supabase = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const linkAt = linkSessionTime(accessToken, user.id);
  if (!linkAt) throw new InvitationError("Open the setup link from your invitation email, then set your password to accept.", 403);
  const { data, error } = await supabase.rpc("m1_accept_school_admin_invitation", { p_user: user.id, p_link_at: linkAt });
  if (error) throw databaseError(error, "The invitation could not be accepted. Try the setup link again.");
  return { role: data };
}

/** The signed-in user's own invitation state (none when there is no invitation or the update is not installed). */
async function ownInvitationState(user, dependencies = {}) {
  const supabase = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const { data, error } = await supabase.from("m1_school_admin_invitations").select("status, expires_at").eq("user_id", user.id).maybeSingle();
  if (error) {
    if (/PGRST205|Could not find the table|42P01/i.test(`${error.code} ${error.message}`)) return { state: "none" };
    throw new InvitationError("Unable to check the invitation.", 502);
  }
  if (!data) return { state: "none" };
  const state = data.status === "pending" && Date.parse(data.expires_at) <= Date.now() ? "expired" : data.status;
  return { state, expiresAt: data.expires_at };
}

/** System Admin view: authorization records and invitation states, keyed by account id (null if not installed). */
async function loadInvitationRecords(supabase) {
  const { data, error } = await supabase.from("m1_school_admin_invitations")
    .select("id, user_id, authorized_by, authorized_at, authorization_reference, confirmation_method, authorizing_position, note, status, last_sent_at, send_count, expires_at, accepted_at, cancelled_at");
  if (error) return null;
  return new Map((data ?? []).map((row) => [row.user_id, {
    id: row.id,
    state: row.status === "pending" && Date.parse(row.expires_at) <= Date.now() ? "expired" : row.status,
    authorizedBy: row.authorized_by, authorizedAt: row.authorized_at, reference: row.authorization_reference,
    confirmationMethod: row.confirmation_method, confirmationLabel: CONFIRMATION_METHODS[row.confirmation_method] ?? row.confirmation_method,
    authorizingPosition: row.authorizing_position, note: row.note, lastSentAt: row.last_sent_at, sendCount: row.send_count,
    expiresAt: row.expires_at, acceptedAt: row.accepted_at, cancelledAt: row.cancelled_at,
  }]));
}

module.exports = {
  CONFIRMATION_METHODS, VALID_DAYS, acceptSchoolAdminInvitation, cancelSchoolAdminInvitation, createSchoolAdmin,
  linkSessionTime, loadInvitationRecords, ownInvitationState, readAuthorization, resendSchoolAdminInvitation,
};
