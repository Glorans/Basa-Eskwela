import { useState } from "react";
import { confirmReadFlow } from "../../../../components/ReadFlowDialog";
import {
  cancelSchoolAdminInvitation,
  getAdminUserError,
  resendSchoolAdminInvitation,
  type ManagedUser,
  type SchoolAdminAuthorization,
} from "../../services/adminUsers";

type Recorded = Exclude<SchoolAdminAuthorization, { state: "unavailable" }>;
const STATE_LABEL: Record<Recorded["state"], string> = {
  pending: "Invitation pending", expired: "Invitation no longer open", accepted: "Accepted", cancelled: "Invitation cancelled",
};
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "—");

/** One line under a School Admin's name: the recorded authorization, or that no record exists (never invented). */
export function SchoolAdminAuthorizationNote({ authorization }: { authorization?: SchoolAdminAuthorization | null }) {
  if (!authorization) return null;
  if (authorization.state === "unavailable") {
    return <small className="admin-users-authorization">Authorization record unavailable (created before authorization records)</small>;
  }
  return (
    <small className="admin-users-authorization">
      Authorization recorded by {authorization.authorizedByName} on {day(authorization.authorizedAt)} · {authorization.confirmationLabel}
    </small>
  );
}

/**
 * System Admin only: invitations that are not yet active School Admins. Pending invitees have NO School Admin access
 * (the server and database enforce this); this panel only shows state and offers Resend and Cancel.
 */
export default function SchoolAdminInvitationsPanel({ users, onChanged }: { users: ManagedUser[]; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const invitations = users
    .filter((user) => user.schoolAdminAuthorization && user.schoolAdminAuthorization.state !== "unavailable"
      && user.schoolAdminAuthorization.state !== "accepted")
    .map((user) => ({ user, invitation: user.schoolAdminAuthorization as Recorded }));

  async function act(kind: "resend" | "cancel", user: ManagedUser, invitation: Recorded) {
    if (busy) return;
    const name = user.fullName || user.email || "this invitee";
    const confirmed = await confirmReadFlow(
      kind === "resend"
        ? `Send a new setup link to ${name}? The invitation stays open for 7 days from now and earlier links stop working.`
        : `Cancel the School Admin invitation for ${name}? The invitation can never be used again and the account cannot sign in.`,
      { confirm: kind === "resend" ? "Resend invitation" : "Cancel invitation", cancel: "Keep" },
    );
    if (!confirmed) return;
    setBusy(invitation.id);
    setMessage(null);
    try {
      const result = kind === "resend"
        ? await resendSchoolAdminInvitation(invitation.id)
        : await cancelSchoolAdminInvitation(invitation.id, "Cancelled by System Admin");
      setMessage({ kind: "success", text: result.message });
      onChanged();
    } catch (error) {
      setMessage({ kind: "error", text: getAdminUserError(error) });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="admin-users-invitations" aria-labelledby="school-admin-invitations-title">
      <h2 id="school-admin-invitations-title">School Admin Invitations</h2>
      <p>Invite authorized School Admins and manage pending invitations.</p>
      <p className="admin-users-invitations-note">Invitations are valid for 7 days. If an email link expires, send a new invitation link.</p>
      {message && <p className={`admin-users-message admin-users-message--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      {!invitations.length ? <p className="admin-users-empty">No pending invitations.</p> : (
        <div className="admin-users-table-scroll" tabIndex={0} role="region" aria-label="School Admin Invitations">
          <table className="admin-users-table">
            <thead><tr><th>Invitee</th><th>Status</th><th>Authorization recorded</th><th>Last sent</th><th>Invitation open until</th><th>Actions</th></tr></thead>
            <tbody>
              {invitations.map(({ user, invitation }) => (
                <tr key={invitation.id}>
                  <td>{user.fullName || "—"}<br /><small>{user.email}</small></td>
                  <td><span className="admin-users-role-readonly" data-invitation-state={invitation.state}>{STATE_LABEL[invitation.state]}</span></td>
                  <td>{invitation.authorizedByName}, {day(invitation.authorizedAt)}<br /><small>{invitation.authorizingPosition} · {invitation.confirmationLabel} · {invitation.reference}</small></td>
                  <td>{day(invitation.lastSentAt)}{invitation.sendCount > 1 ? ` (${invitation.sendCount} sends)` : ""}</td>
                  <td>{invitation.state === "cancelled" ? "—" : invitation.state === "expired" ? `Closed ${day(invitation.expiresAt)}` : day(invitation.expiresAt)}</td>
                  <td>
                    {invitation.state === "cancelled" ? <span className="admin-users-managed-note">Cannot be reused</span> : <>
                      <button type="button" className="admin-users-clear" disabled={Boolean(busy)} onClick={() => void act("resend", user, invitation)}>
                        {busy === invitation.id ? "Working…" : "Resend invitation"}
                      </button>{" "}
                      <button type="button" className="admin-users-delete" disabled={Boolean(busy)} onClick={() => void act("cancel", user, invitation)}>Cancel invitation</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
