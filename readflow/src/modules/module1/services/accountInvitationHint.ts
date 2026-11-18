/**
 * True when the server marked this Auth account as an invited School Admin (app_metadata can only be written with
 * the service role). A DISPLAY hint: it decides which screen to show, never what the account may do. Ordinary
 * accounts have no marker, so their registration and password recovery make no invitation request at all.
 */
export function isInvitedSchoolAdmin(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  return user?.app_metadata?.school_admin_invitation === true;
}
