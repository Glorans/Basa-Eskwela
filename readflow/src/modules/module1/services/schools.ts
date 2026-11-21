import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";

// M1 F8 Create School (System Admin only). Every rule (System Admin role, unique name and code, status) is enforced
// on the server and in the database; this module only sends the request.
export interface School {
  id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
  isLegacy: boolean;
  createdAt: string;
  updatedAt: string;
  schoolAdmins: number;
  teachers: number;
  students: number;
}

const headers = () => getSessionAuthHeaders("Your session could not be verified. Please sign in again.");

export async function listSchools() {
  const response = await api.get<{ success: true; schools: School[] }>("/api/admin/schools", { headers: await headers() });
  return response.data.schools;
}

export async function createSchool(input: { name: string; code: string; status: School["status"] }) {
  const response = await api.post<{ success: true; school: School; message: string }>("/api/admin/schools", input, { headers: await headers() });
  return response.data;
}

export async function updateSchool(schoolId: string, input: { name?: string; status?: School["status"] }) {
  const response = await api.patch<{ success: true; school: School; message: string }>(
    `/api/admin/schools/${encodeURIComponent(schoolId)}`, input, { headers: await headers() });
  return response.data;
}

/** Client-side hints only (the server validates again): 2-32 letters, numbers or hyphens. */
export const SCHOOL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,30}[A-Z0-9]$/;
export const normalizeSchoolCode = (value: string) => value.trim().toUpperCase();
export const normalizeSchoolName = (value: string) => value.replace(/\s+/g, " ").trim();
