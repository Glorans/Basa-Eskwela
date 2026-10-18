import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";

export interface TeacherInvitation {
  id: string;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  status: "active" | "revoked" | "expired" | "exhausted";
}
const root = "/api/admin/teacher-invitations";
const headers = () => getSessionAuthHeaders("Please sign in again.");
export async function listTeacherInvitations(): Promise<TeacherInvitation[]> {
  const response = await api.get(root, { headers: await headers() });
  return response.data.invitations;
}
export async function createTeacherInvitation(expiresAt: string, maxUses: number): Promise<{ invitation: TeacherInvitation; code: string }> {
  const response = await api.post(root, { expiresAt, maxUses }, { headers: await headers() });
  return response.data;
}
export async function revokeTeacherInvitation(id: string): Promise<TeacherInvitation> {
  const response = await api.post(`${root}/${encodeURIComponent(id)}/revoke`, {}, { headers: await headers() });
  return response.data.invitation;
}
export function invitationError(error: unknown) {
  if (axios.isAxiosError<{ message?: string }>(error)) return error.response?.data?.message || "Unable to confirm the request. Refresh the list before retrying; revoke any invitation whose code you did not receive.";
  return error instanceof Error ? error.message : "Unable to manage invitations. Please refresh and retry.";
}
