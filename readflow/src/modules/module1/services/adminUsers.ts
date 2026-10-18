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
  createdAt: string;
  teacherStatus?: "pending" | "approved" | "rejected" | null;
}

interface ManagedUsersResponse {
  success: true;
  users: ManagedUser[];
}

const getAdminRequestHeaders = () =>
  getSessionAuthHeaders("Your session could not be verified. Please sign in again.");

export async function getManagedUsers() {
  const response = await api.get<ManagedUsersResponse>("/api/admin/users", {
    headers: await getAdminRequestHeaders(),
  });
  return response.data.users;
}

export async function deleteManagedUser(userId: string) {
  await api.delete(`/api/admin/users/${encodeURIComponent(userId)}`, {
    headers: await getAdminRequestHeaders(),
  });
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
