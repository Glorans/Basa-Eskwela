import axios from "axios";
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

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    throw new OralReadingServiceError("Your session has expired. Please sign in again.");
  }
  return { Authorization: `Bearer ${accessToken}` };
}

function toServiceError(error: unknown, fallback: string) {
  if (error instanceof OralReadingServiceError) return error;
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
    const response = await api.get<ModuleResponse>(
      context.materialId
        ? `/api/oral-reading/materials/${encodeURIComponent(context.materialId)}`
        : `/api/oral-reading/modules/${encodeURIComponent(moduleId ?? "")}`,
      { headers: await getAuthHeaders(), params: context },
    );
    return response.data.module;
  } catch (error) {
    throw toServiceError(error, "Unable to load the oral-reading activity.");
  }
}

export async function createOralReadingAttempt(input: CreateOralReadingAttemptInput) {
  try {
    const response = await api.post<AttemptResponse>(
      "/api/oral-reading/attempts",
      input,
      { headers: await getAuthHeaders() },
    );
    return response.data.attempt;
  } catch (error) {
    throw toServiceError(error, "Your result could not be saved. Please try again.");
  }
}

export async function getOralReadingAttempt(attemptId: string) {
  try {
    const response = await api.get<AttemptResponse>(
      `/api/oral-reading/attempts/${encodeURIComponent(attemptId)}`,
      { headers: await getAuthHeaders() },
    );
    return response.data.attempt;
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
      { headers: await getAuthHeaders() },
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
      headers: await getAuthHeaders(), params: { moduleId, ...context },
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
      headers: await getAuthHeaders(),
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
      { headers: await getAuthHeaders() },
    );
    return response.data.recording;
  } catch (error) {
    throw toServiceError(error, "Unable to load recording. Please retry.");
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
