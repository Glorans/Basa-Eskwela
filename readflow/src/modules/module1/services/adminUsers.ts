import axios from "axios";
import { supabase } from "../../../lib/supabaseClient";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";

export interface ManagedUser {
  id: string;
  email: string | null;
  fullName: string;
  nickname: string;
  role: string;
  status: string;
  // M1 F7: whether Supabase Auth currently refuses sign-in (null when the account has no Auth user).
  signInBlocked?: boolean | null;
  // System Admin only: the recorded authorization decision and invitation state (null for non-School Admin accounts).
  schoolAdminAuthorization?: SchoolAdminAuthorization | null;
  createdAt: string;
  teacherStatus?: "pending" | "approved" | "rejected" | null;
  // M1 multi-tenancy, System Admin view only: the account's school (null for System Admins and Independent Learners).
  schoolId?: string | null;
  schoolName?: string | null;
}

// What the signed-in manager may do, decided by the server from the role stored in the database (M1 F6/F7/F8).
// The UI only reflects it; every request is re-checked on the server.
export interface AccountPermissions {
  role: string;
  visibleRoles: string[] | "all";
  deletableRoles: string[];
  // M1 F7: roles this manager may deactivate and reactivate (re-checked on the server).
  statusRoles: string[];
  canCreateSchoolAdmin: boolean;
  // M1 F8 Create School (System Admin only).
  canManageSchools?: boolean;
}

interface ManagedUsersResponse {
  success: true;
  users: ManagedUser[];
  permissions?: AccountPermissions;
}

// A System Admin's RECORDED decision. It is not verification of identity or school affiliation.
export type SchoolAdminAuthorization =
  | { state: "unavailable" }
  | {
    id: string;
    state: "pending" | "expired" | "accepted" | "cancelled";
    authorizedByName: string;
    authorizedAt: string;
    reference: string;
    confirmationMethod: string;
    confirmationLabel: string;
    authorizingPosition: string;
    note: string | null;
    lastSentAt: string | null;
    sendCount: number;
    expiresAt: string;
    acceptedAt: string | null;
    cancelledAt: string | null;
  };

export const CONFIRMATION_METHODS = [
  ["official_school_email", "Email from an official school address"],
  ["official_school_phone", "Call to the school's official phone number"],
  ["signed_letter", "Signed letter or form from the school"],
  ["in_person", "In-person meeting with the school representative"],
  ["other_documented", "Other documented confirmation"],
] as const;

export interface SchoolAdminAuthorizationInput {
  reference: string;
  confirmationMethod: string;
  authorizingPosition: string;
  note?: string;
}

export interface CreatedSchoolAdmin {
  id: string;
  invitationId: string;
  email: string;
  fullName: string;
  role: null;
  invitationStatus: "pending";
  setupEmailSent: boolean;
  expiresAt: string | null;
}

const NO_PERMISSIONS: AccountPermissions = {
  role: "", visibleRoles: [], deletableRoles: [], statusRoles: [], canCreateSchoolAdmin: false,
};

const getAdminRequestHeaders = () =>
  getSessionAuthHeaders("Your session could not be verified. Please sign in again.");

export async function getManagedUsers() {
  return (await getManagedAccounts()).users;
}

export async function getManagedAccounts() {
  const response = await api.get<ManagedUsersResponse>("/api/admin/users", {
    headers: await getAdminRequestHeaders(),
  });
  const permissions = response.data.permissions;
  return { users: response.data.users, permissions: permissions ? { ...permissions, statusRoles: permissions.statusRoles ?? [] } : NO_PERMISSIONS };
}

// M1 F8/F9 (System Admin only). The server sets the role; the request carries the email, name and the ONE school the
// School Admin will manage (re-checked on the server and in the database: it must exist and be active).
export async function createSchoolAdmin(input: { email: string; fullName: string; schoolId: string; authorization: SchoolAdminAuthorizationInput }) {
  const response = await api.post<{ success: true; account: CreatedSchoolAdmin; message: string }>(
    "/api/admin/users/school-admins",
    { email: input.email, fullName: input.fullName, schoolId: input.schoolId, authorization: input.authorization },
    { headers: await getAdminRequestHeaders() },
  );
  return response.data;
}

// System Admin only (re-checked on the server and in the database).
export async function resendSchoolAdminInvitation(invitationId: string) {
  const response = await api.post<{ success: true; message: string; invitation: { setupEmailSent: boolean; expiresAt: string } }>(
    `/api/admin/users/school-admins/invitations/${encodeURIComponent(invitationId)}/resend`, {},
    { headers: await getAdminRequestHeaders() },
  );
  return response.data;
}

export async function cancelSchoolAdminInvitation(invitationId: string, reason: string) {
  const response = await api.post<{ success: true; message: string }>(
    `/api/admin/users/school-admins/invitations/${encodeURIComponent(invitationId)}/cancel`, { reason },
    { headers: await getAdminRequestHeaders() },
  );
  return response.data;
}

// M1 F7 Deactivate ("inactive") / Reactivate ("active"). Reversible: the account and its records are kept.
export type ManagedAccountStatus = "active" | "inactive";

export async function setManagedUserStatus(userId: string, status: ManagedAccountStatus) {
  const response = await api.patch<{ success: true; account: { id: string; status: ManagedAccountStatus }; message: string }>(
    `/api/admin/users/${encodeURIComponent(userId)}/status`,
    { status },
    { headers: await getAdminRequestHeaders() },
  );
  return response.data;
}


export async function reviewTeacherRegistration(userId: string, decision: "approved" | "rejected") {
  const { data, error } = await supabase.rpc("review_teacher_registration", {
    target_user: userId, decision,
  });
  if (error) throw new Error(error.message);
  if (data !== "approved" && data !== "rejected") throw new Error("Unable to verify Teacher approval status.");
  return data;
}

export function getAdminUserError(error: unknown) {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to complete the user-management request.";
  }

  return error instanceof Error
    ? error.message
    : "Unable to complete the user-management request.";
}
