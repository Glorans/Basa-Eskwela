import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { ReadingLevel } from "../../../data/dashboardData";

/** One saved M2 assessment as returned by /api/diagnostic-history (display fields only; never answers or transcripts). */
export interface DiagnosticHistoryEntry {
  id: string;
  /** Stored assessment type: "initial" today; "reassessment" once reassessments exist. */
  assessmentType: string;
  language: "en" | "fil";
  completedAt: string;
  wordRecognitionScore: number | null;
  comprehensionScore: number | null;
  readingLevel: ReadingLevel;
  assessmentId: string | null;
  assessmentVersion: string | null;
  /** The diagnostic or reassessment title (null when not recorded). */
  assessmentTitle?: string | null;
  verified: boolean;
}

export interface TeacherDiagnosticStudent {
  id: string;
  name: string;
  /** The Teacher's active Learning Rooms this Student is currently enrolled in (archived rooms grant no access). */
  rooms: { id: string; name: string }[];
  results: DiagnosticHistoryEntry[];
}

const headers = () => getSessionAuthHeaders("Your session could not be verified. Please sign in again.");

/** Students and Independent Learners: the signed-in learner's own results (the server decides the role). */
export async function getMyDiagnosticHistory() {
  const response = await api.get<{ success: true; results: DiagnosticHistoryEntry[] }>(
    "/api/diagnostic-history/me", { headers: await headers() },
  );
  return response.data.results;
}

/** Approved Teachers: Students currently enrolled in the Teacher's own active Learning Rooms. */
export async function getTeacherDiagnosticResults() {
  const response = await api.get<{ success: true; students: TeacherDiagnosticStudent[] }>(
    "/api/diagnostic-history/teacher", { headers: await headers() },
  );
  return response.data.students;
}

export function getDiagnosticHistoryError(error: unknown) {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to load diagnostic results.";
  }
  return error instanceof Error ? error.message : "Unable to load diagnostic results.";
}
