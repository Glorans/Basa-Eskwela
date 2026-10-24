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
import {
  parseTeacherComprehensionDetail,
  parseTeacherComprehensionSummary,
} from "./teacherComprehension";
import type { PronunciationPartResult } from "./pronunciationSummary";

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
  constructor(message: string) {
    super(message);
    this.name = "OralReadingServiceError";
  }
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
    const message = (error.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof message === "string" && message.trim()) {
      return new OralReadingServiceError(message);
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
      { headers: await getAuthHeaders() },
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
    const response = await api.get("/api/oral-reading/attempts", {
      headers: await getAuthHeaders(), params: { moduleId, ...context }, timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data.attempts;
  } catch (error) {
    throw toServiceError(error, "Unable to load your saved results.");
  }
}

export interface OwnOralReadingSummary {
  id: string;
  moduleId: string;
  moduleTitle: string;
  passageTitle: string;
  /** Saved reading language; null for attempts saved before it was recorded. */
  language: "en" | "fil" | null;
  completedAt: string;
  pronunciationAccuracy: number;
  readingSpeedWpm: number;
  detectedErrorCount: number;
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
  teacher = false,
): Promise<{ available: boolean; segments: string[] }> {
  try {
    const response = await api.get(
      `/api/oral-reading/${teacher ? "teacher/" : ""}attempts/${encodeURIComponent(attemptId)}/recording`,
      { headers: await getAuthHeaders(), timeout: REQUEST_TIMEOUT_MS },
    );
    return response.data.recording;
  } catch (error) {
    throw toServiceError(error, "Unable to load recording. Please retry.");
  }
}

/**
 * Azure Pronunciation Assessment of one saved recording part (16 kHz WAV) of an
 * English reading. The server compares it with the attempt's saved passage.
 */
export async function assessOralReadingPronunciationPart(
  attemptId: string,
  wav: Blob,
): Promise<PronunciationPartResult> {
  try {
    const form = new FormData();
    form.append("audio", wav, "part.wav");
    const response = await api.post(
      `/api/oral-reading/attempts/${encodeURIComponent(attemptId)}/pronunciation`,
      form,
      { headers: await getAuthHeaders(), timeout: REQUEST_TIMEOUT_MS },
    );
    return response.data.pronunciation;
  } catch (error) {
    throw toServiceError(error, "Pronunciation feedback is unavailable right now. Please try again.");
  }
}

export interface AdminReadingPassage {
  moduleId: string;
  moduleTitle: string;
  passageId: string | null;
  passageTitle: string;
  language: "en" | "fil";
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
