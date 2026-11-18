import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";

export type OwnInvitationState = "none" | "pending" | "expired" | "accepted" | "cancelled";

export { isInvitedSchoolAdmin } from "./accountInvitationHint";

export const INVITATION_LOOKUP_TIMEOUT_MS = 8000;
export const INVITATION_ACCEPT_TIMEOUT_MS = 30000; // allows a backend cold start

/** The signed-in user's own invitation state. Throws on failure or timeout: a failed check proves nothing. */
export async function getOwnSchoolAdminInvitation(timeout = INVITATION_LOOKUP_TIMEOUT_MS): Promise<OwnInvitationState> {
  const response = await api.get<{ success: true; invitation: { state: OwnInvitationState } }>("/api/account/school-admin-invitation", {
    headers: await getSessionAuthHeaders("Your session could not be verified. Please sign in again."),
    timeout,
  });
  return response.data.invitation.state;
}

/** Accept in the session opened from the setup link, after the password is set. The server and database re-check everything. */
export async function acceptSchoolAdminInvitation(timeout = INVITATION_ACCEPT_TIMEOUT_MS) {
  const response = await api.post<{ success: true; role: string; message: string }>("/api/account/school-admin-invitation/accept", {}, {
    headers: await getSessionAuthHeaders("Your session could not be verified. Open the setup link again."),
    timeout,
  });
  return response.data;
}
