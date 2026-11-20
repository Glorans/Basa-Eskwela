import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { ReadingLevel } from "../../../data/dashboardData";

/**
 * M2 F5 — View Reading Progress. Built by the server ONLY from official, server-verified M2 results (the initial
 * diagnostic and official reassessments). F7 Practice Mode, unverified rows, M5/M6 practice and M8 XP never count.
 */
export interface ProgressPoint {
  id: string;
  assessmentType: string;
  title: string | null;
  version: string | null;
  completedAt: string;
  readingLevel: ReadingLevel;
  wordRecognitionScore: number | null;
  comprehensionScore: number | null;
}

export interface LanguageProgress {
  language: "en" | "fil";
  /** The classification placement uses: the initial diagnostic while the placement switch is OFF (default). */
  current: { readingLevel: ReadingLevel; source: string; completedAt: string; rule: "initial" | "latest-official" } | null;
  initial: ProgressPoint | null;
  reassessments: ProgressPoint[];
  change:
    | { status: "none" | "insufficient"; message: string }
    | { status: "compared"; direction: "higher" | "lower" | "same"; from: ReadingLevel; to: ReadingLevel; basedOn: number; message: string };
  /** Set when reassessments exist but placement still follows the initial diagnostic. */
  placementNote: string | null;
}

export type ReadingProgress = Record<"en" | "fil", LanguageProgress>;

export interface ProgressStudent {
  id: string;
  name: string;
  rooms?: { id: string; name: string }[];
  progress: ReadingProgress;
}

const headers = () => getSessionAuthHeaders("Your session could not be verified. Please sign in again.");

/** Students and Independent Learners: their own progress. */
export async function getMyReadingProgress() {
  const response = await api.get<{ success: true; followsReassessment: boolean; progress: ReadingProgress }>(
    "/api/diagnostic-history/progress/me", { headers: await headers() },
  );
  return response.data.progress;
}

/** Approved Teachers: Students currently enrolled in the Teacher's own active Learning Rooms. */
export async function getTeacherReadingProgress() {
  const response = await api.get<{ success: true; students: ProgressStudent[] }>(
    "/api/diagnostic-history/progress/teacher", { headers: await headers() },
  );
  return response.data.students;
}

/** School Admin (single-school pilot): every Student; Independent Learners are excluded. */
export async function getSchoolReadingProgress() {
  const response = await api.get<{ success: true; students: ProgressStudent[] }>(
    "/api/diagnostic-history/progress/school", { headers: await headers() },
  );
  return response.data.students;
}
