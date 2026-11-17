import { numberSavedAttempts } from "./savedAttemptOrder.ts";
import axios from "axios";
import { ReadingDataCache } from "./readingDataCache.ts";
import { supabase } from "../../../lib/supabaseClient";
import api from "../../../services/api";
import type {
  CreateOralReadingAttemptInput,
  OralReadingAttempt,
  OralReadingModule,
  OralReadingContext,
  TeacherOralReadingAttemptDetail,
  TeacherOralReadingAttemptSummary,
} from "../types/oralReading";
import type { SavedPronunciationScores } from "./pronunciationSummary";
import {
  parseTeacherComprehensionDetail,
  parseTeacherComprehensionSummary,
} from "./teacherComprehension";

interface ModuleResponse {
  success: boolean;
  module: OralReadingModule;
}

interface AttemptResponse {
  success: boolean;
  attempt: OralReadingAttempt;
}

interface TeacherAttemptsResponse {
  success: boolean;
  attempts: (Omit<TeacherOralReadingAttemptSummary, "comprehension"> & { comprehension?: unknown })[];
}

interface TeacherAttemptResponse {
  success: boolean;
  attempt: Omit<TeacherOralReadingAttemptDetail, "comprehension"> & { comprehension?: unknown };
}

export class OralReadingServiceError extends Error {
  /** The server's reason code, when it sends one (for example CLASSROOM_ASSIGNMENT_REQUIRED). */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "OralReadingServiceError";
    if (code) this.code = code;
  }
}

/** Student refusals that mean "read silently here; Read Aloud needs a classroom assignment" (not a fault). */
export const STUDENT_ASSIGNMENT_CODES = ["CLASSROOM_ASSIGNMENT_REQUIRED", "SELECTED_STUDENTS_ONLY", "MODULE_REMOVED_FROM_CLASSROOM"] as const;
export function isStudentAssignmentRefusal(error: unknown): error is OralReadingServiceError {
  return error instanceof OralReadingServiceError && (STUDENT_ASSIGNMENT_CODES as readonly string[]).includes(error.code ?? "");
}

const readingData = new ReadingDataCache();
// Clear cached data at sign-out/account changes as well as token changes.
supabase.auth.onAuthStateChange((_event, session) => {
  readingData.setSession(session?.access_token ?? "", session?.user.id);
});

export function peekOralReadingAttempt(attemptId: string | undefined, userId?: string) {
  return attemptId ? readingData.peek<OralReadingAttempt>(`attempt:${attemptId}`, userId) : undefined;
}

/** Only a server-saved attempt may seed the next screen; never a local score/input. */
export function rememberOralReadingAttempt(attempt: OralReadingAttempt) {
  if (attempt.userId && Array.isArray(attempt.wordMetrics)) {
    readingData.putForUser(attempt.userId, `attempt:${attempt.id}`, attempt);
  }
}

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  readingData.setSession(accessToken ?? "", data.session?.user?.id);
  if (error || !accessToken) {
    throw new OralReadingServiceError("Your session has expired. Please sign in again.");
  }
  return { Authorization: `Bearer ${accessToken}` };
}

// A slow or dropped connection ends with a retryable message instead of waiting
// forever. Saves are safe to retry: the server keeps the first saved result and recording.
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 180_000;
export const SLOW_CONNECTION_MESSAGE =
  "The connection is too slow right now. Please check your internet and try again.";

export function isTimeoutError(error: unknown) {
  return axios.isAxiosError(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT");
}

/** Rejects with the slow-connection message if the work takes longer than ms. */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function toServiceError(error: unknown, fallback: string) {
  if (error instanceof OralReadingServiceError) return error;
  if (isTimeoutError(error)) return new OralReadingServiceError(SLOW_CONNECTION_MESSAGE);
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; code?: unknown } | undefined;
    const message = data?.message;
    if (typeof message === "string" && message.trim()) {
      return new OralReadingServiceError(message, typeof data?.code === "string" ? data.code : undefined);
    }
  }
  return new OralReadingServiceError(fallback);
}

export async function getOralReadingModule(moduleId: string | undefined, context: OralReadingContext = {}) {
  try {
    const headers = await getAuthHeaders();
    const key = JSON.stringify(["module", moduleId, context.materialId, context.activityAssignmentId,
      context.passageId, context.roomId, context.assignmentId, context.passageRevision]);
    return await readingData.load(headers.Authorization.slice(7), key, async () => {
      const response = await api.get<ModuleResponse>(
        context.materialId
          ? `/api/oral-reading/materials/${encodeURIComponent(context.materialId)}`
          : `/api/oral-reading/modules/${encodeURIComponent(moduleId ?? "")}`,
        { headers, params: context, timeout: REQUEST_TIMEOUT_MS },
      );
      return response.data.module;
    });
  } catch (error) {
    throw toServiceError(error, "Unable to load the oral-reading activity.");
  }
}

export async function createOralReadingAttempt(input: CreateOralReadingAttemptInput) {
  try {
    const headers = await getAuthHeaders();
    const response = await api.post<AttemptResponse>(
      "/api/oral-reading/attempts",
      input,
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
    const attempt = response.data.attempt;
    // Read-aloud-only completion is updated after this response. Fetch its final
    // status on the result page rather than caching a premature success status.
    if (!attempt.readAloudOnly && attempt.userId && Array.isArray(attempt.wordMetrics)) {
      readingData.put(headers.Authorization.slice(7), `attempt:${attempt.id}`, attempt);
    }
    return attempt;
  } catch (error) {
    throw toServiceError(error, "Your result could not be saved. Please try again.");
  }
}

export async function getOralReadingAttempt(attemptId: string, refresh = false) {
  try {
    const headers = await getAuthHeaders();
    return await readingData.load(headers.Authorization.slice(7), `attempt:${attemptId}`, async () => {
      const response = await api.get<AttemptResponse>(
        `/api/oral-reading/attempts/${encodeURIComponent(attemptId)}`,
        { headers, timeout: REQUEST_TIMEOUT_MS },
      );
      return response.data.attempt;
    }, refresh);
  } catch (error) {
    throw toServiceError(error, "Unable to load the oral-reading result.");
  }
}

export async function getTeacherOralReadingAttempts() {
  try {
    const response = await api.get<TeacherAttemptsResponse>(
      "/api/oral-reading/teacher/attempts",
      // A stalled connection ends in the page's error and Refresh state instead of loading indefinitely.
      { headers: await getAuthHeaders(), timeout: REQUEST_TIMEOUT_MS },
    );
    return response.data.attempts.map((attempt): TeacherOralReadingAttemptSummary => ({
      ...attempt,
      comprehension: parseTeacherComprehensionSummary(attempt.comprehension),
    }));
  } catch (error) {
    throw toServiceError(error, "Unable to load student reading results.");
  }
}

export async function getTeacherOralReadingAttempt(attemptId: string) {
  try {
    const response = await api.get<TeacherAttemptResponse>(
      `/api/oral-reading/teacher/attempts/${encodeURIComponent(attemptId)}`,
      { headers: await getAuthHeaders(), timeout: REQUEST_TIMEOUT_MS },
    );
    const { attempt } = response.data;
    return {
      ...attempt,
      comprehension: parseTeacherComprehensionDetail(attempt.comprehension),
    } satisfies TeacherOralReadingAttemptDetail;
  } catch (error) {
    throw toServiceError(error, "Unable to load the student reading result.");
  }
}

export async function getOwnOralReadingAttempts(moduleId?: string, context: OralReadingContext = {}): Promise<OwnOralReadingSummary[]> {
  try {
    const headers = await getAuthHeaders();
    const response = await api.get("/api/oral-reading/attempts", {
      headers, params: { moduleId, ...context }, timeout: REQUEST_TIMEOUT_MS,
    });
    const attempts: OwnOralReadingSummary[] = response.data.attempts;
    // Only activity-scoped history defines result numbers, never the all-activity list.
    if (moduleId || context.materialId) {
      for (const row of numberSavedAttempts(attempts)) {
        readingData.put(headers.Authorization.slice(7), `attempt-number:${row.id}`, row.resultNumber);
      }
    }
    return attempts;
  } catch (error) {
    throw toServiceError(error, "Unable to load your saved results.");
  }
}

export function peekOralReadingAttemptNumber(attemptId: string | undefined, userId?: string) {
  return attemptId ? readingData.peek<number>(`attempt-number:${attemptId}`, userId) : undefined;
}

export async function getOralReadingAttemptNumber(attempt: OralReadingAttempt) {
  const cached = peekOralReadingAttemptNumber(attempt.id, attempt.userId);
  if (cached !== undefined) return cached;
  if (!attempt.moduleId && !attempt.materialId) return undefined;
  const rows = await getOwnOralReadingAttempts(attempt.moduleId ?? undefined, attempt.materialId
    ? { materialId: attempt.materialId, activityAssignmentId: attempt.activityAssignmentId } : {});
  return numberSavedAttempts(rows).find(row => row.id === attempt.id)?.resultNumber;
}

export interface OwnOralReadingSummary {
  /** "personal" when saved outside any classroom; "classroom" otherwise. Absent from older servers. */
  practiceContext?: "personal" | "classroom";
  id: string;
  moduleId: string;
  materialId?: string | null;
  activityAssignmentId?: string | null;
  passageId?: string | null;
  roomId?: string | null;
  assignmentId?: string | null;
  moduleTitle: string;
  passageTitle: string;
  /** Saved reading language; null for attempts saved before it was recorded. */
  language: "en" | "fil" | null;
  completedAt: string;
  pronunciationAccuracy: number;
  readingSpeedWpm: number;
  detectedErrorCount: number;
  /** F7: the saved English pronunciation check, when there is one. */
  pronunciationCheck?: SavedPronunciationScores;
}

export interface AssignedReadingProgress {
  readAloudOnly?: boolean;
  activityAssignmentId: string;
  materialId: string;
  roomId: string;
  status: "Not Started" | "Oral Reading Saved" | "Comprehension In Progress" | "Completed";
  oralReadingAttemptId: string | null;
  comprehensionAttemptId: string | null;
}

export async function getAssignedReadingProgress(roomId: string): Promise<AssignedReadingProgress[]> {
  try {
    const response = await api.get(`/api/oral-reading/rooms/${encodeURIComponent(roomId)}/progress`, {
      headers: await getAuthHeaders(),
    });
    return response.data.progress;
  } catch (error) {
    throw toServiceError(error, "Unable to load assessment progress. Please retry.");
  }
}

export const RECORDING_UPLOAD_ERROR =
  "Your result is saved, but recording upload failed. Retry saving the recording before leaving this page.";

/** Segments are appended in recorder order; the server stores and replays them in that order. */
export async function uploadOralReadingRecording(attemptId: string, segments: readonly Blob[]) {
  try {
    const form = new FormData();
    segments.forEach((blob, index) => form.append("audio", blob, `segment-${String(index).padStart(3, "0")}`));
    await api.post(`/api/oral-reading/attempts/${encodeURIComponent(attemptId)}/recording`, form, {
      headers: await getAuthHeaders(), timeout: UPLOAD_TIMEOUT_MS,
    });
  } catch (error) {
    throw toServiceError(error, RECORDING_UPLOAD_ERROR);
  }
}

export async function getOralReadingRecording(
  attemptId: string,
  /** Whose route: own (false), Teacher review (true) or Admin student review ("admin"). */
  reviewer: boolean | "admin" = false,
): Promise<{ available: boolean; segments: string[] }> {
  const scope = reviewer === "admin" ? "admin/" : reviewer ? "teacher/" : "";
  try {
    const headers = await getAuthHeaders();
    const fetchRecording = async () => (await api.get<{ recording: { available: boolean; segments: string[] } }>(
      `/api/oral-reading/${scope}attempts/${encodeURIComponent(attemptId)}/recording`,
      { headers, timeout: REQUEST_TIMEOUT_MS },
    )).data.recording;
    // Teacher and Admin review always ask the server.
    if (reviewer !== false) return await fetchRecording();
    // The learner's own recording: opening Pronunciation Feedback starts the player and the pronunciation check at the
    // same moment, and both used to ask for the links separately (one extra request and audio download). One request now
    // serves both. Per signed-in session only (cleared on sign-out or another account), kept for the cache's 60 s (the
    // links are valid for 300 s), and never while the recording is not saved yet.
    const key = `recording:${attemptId}`;
    const recording = await readingData.load(headers.Authorization.slice(7), key, fetchRecording);
    if (!recording.available || recording.segments.length === 0) readingData.forget(key);
    return recording;
  } catch (error) {
    throw toServiceError(error, "Unable to load recording. Please retry.");
  }
}

// --- Admin "Student Reading Assessments": read-only; these never use the learner cache. ---

export interface AdminStudentSummary {
  id: string;
  name: string;
  readingCount: number;
  latestCompletedAt: string;
}

/** Null language: the reading was saved before its language was recorded. */
export type AdminStudentAttempt = Omit<OralReadingAttempt, "language"> & {
  language: "en" | "fil" | null;
  learnerName: string;
};

export async function getAdminStudents() {
  try {
    const response = await api.get<{ students: AdminStudentSummary[] }>("/api/oral-reading/admin/students",
      { headers: await getAuthHeaders(), timeout: REQUEST_TIMEOUT_MS });
    return response.data.students;
  } catch (error) {
    throw toServiceError(error, "Unable to load student reading assessments.");
  }
}

export async function getAdminStudentReadings(studentId: string) {
  try {
    const response = await api.get<{ student: { id: string; name: string }; attempts: OwnOralReadingSummary[] }>(
      `/api/oral-reading/admin/students/${encodeURIComponent(studentId)}/attempts`,
      { headers: await getAuthHeaders(), timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    throw toServiceError(error, "Unable to load this student's readings.");
  }
}

export async function getAdminStudentAttempt(attemptId: string) {
  try {
    const response = await api.get<{ attempt: AdminStudentAttempt }>(
      `/api/oral-reading/admin/attempts/${encodeURIComponent(attemptId)}`,
      { headers: await getAuthHeaders(), timeout: REQUEST_TIMEOUT_MS });
    return response.data.attempt;
  } catch (error) {
    throw toServiceError(error, "Unable to load this saved assessment.");
  }
}

export interface AdminReadingPassage {
  moduleId: string;
  moduleTitle: string;
  passageId: string | null;
  passageTitle: string;
  language: "en" | "fil";
}

/** Approved-Teacher reading practice: published modules in the shared catalog (titles only). */
export async function getPracticeReadingPassages(): Promise<AdminReadingPassage[]> {
  try {
    const { data } = await api.get<{ success: boolean; passages: AdminReadingPassage[] }>(
      "/api/oral-reading/practice/passages",
      { headers: await getAuthHeaders() },
    );
    return data.passages;
  } catch (error) {
    throw toServiceError(error, "Unable to load reading passages.");
  }
}

export async function getAdminReadingPassages(): Promise<AdminReadingPassage[]> {
  try {
    const { data } = await api.get<{ success: boolean; passages: AdminReadingPassage[] }>(
      "/api/oral-reading/admin/passages",
      { headers: await getAuthHeaders() },
    );
    return data.passages;
  } catch (error) {
    throw toServiceError(error, "Unable to load reading passages.");
  }
}
