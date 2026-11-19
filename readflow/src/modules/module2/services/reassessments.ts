import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { DiagnosticLanguage } from "../types/diagnostic";

// M2 F9 Assign Reassessment (School Admin + approved Teachers). The server decides every permission and the database
// re-checks each assignment; while official reassessment is not enabled the server refuses to create assignments.

export interface AssignmentRoom { id: string; name: string; subject: DiagnosticLanguage | null; teacherName?: string }
export interface AssignablePackage {
  packageId: string;
  versionId: string | null;
  versionLabel: string | null;
  title: string;
  category: "teacher" | "school";
  language: DiagnosticLanguage;
  ownerName?: string;
  eligible: boolean;
  /** Why the package cannot be assigned (here), or null. */
  reason: string | null;
}
export interface RosterStudent { id: string; name: string; reason: string | null }
export type AssignmentStatus = "active" | "completed" | "cancelled";
export interface ReassessmentAssignment {
  id: string;
  status: AssignmentStatus;
  language: DiagnosticLanguage;
  packageTitle: string;
  versionLabel: string | null;
  roomId: string | null;
  roomName: string;
  studentId: string;
  studentName: string;
  assignedBy: string;
  assignedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
}
export interface IneligibleStudent { studentId: string; name: string | null; reason: string }

export class ReassessmentRequestError extends Error {
  code: string;
  ineligible: IneligibleStudent[];
  constructor(message: string, code = "REASSESSMENT_FAILED", ineligible: IneligibleStudent[] = []) {
    super(message);
    this.name = "ReassessmentRequestError";
    this.code = code;
    this.ineligible = ineligible;
  }
}

const BASE = "/api/reassessments";
const config = async (params?: Record<string, string>) => ({
  headers: await getSessionAuthHeaders("Your session could not be verified. Please sign in again."),
  ...(params ? { params } : {}),
});

async function request<T>(work: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await work()).data;
  } catch (error) {
    if (axios.isAxiosError<{ message?: string; code?: string; ineligible?: IneligibleStudent[] }>(error)) {
      const data = error.response?.data;
      throw new ReassessmentRequestError(data?.message || "Unable to complete the reassessment request.", data?.code,
        Array.isArray(data?.ineligible) ? data.ineligible : []);
    }
    throw error instanceof Error ? error : new Error("Unable to complete the reassessment request.");
  }
}

export const getAssignmentOverview = async () =>
  request<{ enabled: boolean; rooms: AssignmentRoom[]; packages: AssignablePackage[] }>(async () => api.get(`${BASE}/overview`, await config()));
export const getAssignablePackages = async (roomId: string) =>
  request<{ enabled: boolean; packages: AssignablePackage[] }>(async () => api.get(`${BASE}/assignable-packages`, await config({ roomId })));
export const getRoomRoster = async (roomId: string, packageVersionId?: string) =>
  request<{ room: { id: string; name: string }; students: RosterStudent[] }>(async () => api.get(
    `${BASE}/rooms/${encodeURIComponent(roomId)}/students`, await config(packageVersionId ? { packageVersionId } : undefined)));
export const listReassessmentAssignments = async (status?: AssignmentStatus) =>
  request<{ enabled: boolean; assignments: ReassessmentAssignment[] }>(async () => api.get(`${BASE}/assignments`,
    await config(status ? { status } : undefined)));
export const createReassessmentAssignments = async (input: {
  roomId: string; packageVersionId: string; mode: "selected" | "all_eligible"; studentIds?: string[]; dueDate?: string;
}) => request<{ created: number; skipped: IneligibleStudent[]; assignments: ReassessmentAssignment[] }>(async () =>
  api.post(`${BASE}/assignments`, input, await config()));
export const cancelReassessmentAssignment = async (id: string, reason: string) =>
  request<{ assignment: ReassessmentAssignment }>(async () => api.post(`${BASE}/assignments/${encodeURIComponent(id)}/cancel`,
    { reason }, await config()));

/** Dates are stored as UTC instants and shown in the Philippines' time zone. */
export function formatManilaDate(value: string | null, withTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

/** Today in the Philippines as YYYY-MM-DD (the earliest due date the server accepts). */
export const manilaToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
