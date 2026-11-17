import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type {
  MaterialLanguageCode,
  ReviewableComprehensionQuestion,
  UploadedMaterial,
  MaterialQuestionSet,
  MaterialQuestionSetSummary,
} from "../types/content";

interface MaterialApiError {
  success?: false;
  message?: string;
}

const getMaterialAuthHeaders = () =>
  getSessionAuthHeaders("Your session could not be verified. Please sign in again and retry.");

export async function getMaterials() {
  const response = await api.get<{ success: true; materials: UploadedMaterial[] }>(
    "/api/materials",
    { headers: await getMaterialAuthHeaders() },
  );
  return response.data.materials;
}

export async function deleteMaterial(materialId: string) {
  await api.delete(`/api/materials/${encodeURIComponent(materialId)}`, {
    headers: await getMaterialAuthHeaders(),
  });
}

/** Corrects a saved material's language. The server refuses once it is assigned or has results. */
export async function updateMaterialLanguage(materialId: string, language: MaterialLanguageCode) {
  const { data } = await api.patch<{ material: { id: string; language: MaterialLanguageCode; changed: boolean } }>(
    `/api/materials/${encodeURIComponent(materialId)}/language`,
    { language },
    { headers: await getMaterialAuthHeaders() },
  );
  return data.material;
}

/** New question sets offer 9 or 12 questions (3 or 4 of each type); older sets keep their size. */
export const NEW_QUESTION_SET_COUNTS = [9, 12] as const;
export const DEFAULT_NEW_QUESTION_SET_COUNT = 9;

export function getMaterialServiceError(
  error: unknown,
  fallback = "Unable to process the material. Please try again.",
) {
  if (axios.isAxiosError<MaterialApiError>(error)) {
    return error.response?.data?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export { getMaterialAuthHeaders };

const setPath = (materialId: string, setId?: string) =>
  `/api/materials/${encodeURIComponent(materialId)}/question-sets${setId ? `/${encodeURIComponent(setId)}` : ""}`;

export async function getMaterialQuestionSets(materialId: string) {
  const { data } = await api.get<{ sets: MaterialQuestionSetSummary[] }>(setPath(materialId),
    { headers: await getMaterialAuthHeaders() });
  return data.sets;
}
export async function getMaterialQuestionSet(materialId: string, setId: string) {
  const { data } = await api.get<{ set: MaterialQuestionSet }>(setPath(materialId, setId),
    { headers: await getMaterialAuthHeaders() });
  return data.set;
}
export async function createMaterialQuestionSet(materialId: string, questionCount: number = DEFAULT_NEW_QUESTION_SET_COUNT) {
  const { data } = await api.post<{ set: MaterialQuestionSet }>(setPath(materialId), { questionCount },
    { headers: await getMaterialAuthHeaders() });
  return data.set;
}
export async function regenerateMaterialQuestionSet(materialId: string, setId: string, revision: number) {
  const { data } = await api.post<{ set: MaterialQuestionSet }>(`${setPath(materialId, setId)}/regenerate`, { revision },
    { headers: await getMaterialAuthHeaders() });
  return data.set;
}
export async function saveMaterialQuestionSet(materialId: string, setId: string, revision: number, questions: ReviewableComprehensionQuestion[]) {
  const { data } = await api.put<{ set: MaterialQuestionSet }>(setPath(materialId, setId), {
    revision,
    questions: questions.map(({ id, type, questionText, options, scaffoldingHint }) => ({ id, type, questionText, options, scaffoldingHint })),
  }, { headers: await getMaterialAuthHeaders() });
  return data.set;
}

export async function reviewMaterialQuestionSet(materialId: string, setId: string, revision: number) {
  const { data } = await api.post<{ set: MaterialQuestionSet }>(`${setPath(materialId, setId)}/review`, { revision },
    { headers: await getMaterialAuthHeaders() });
  return data.set;
}

export const ASSIGNED_QUESTION_SET_MESSAGE =
  "This question set is assigned to a class activity. Remove the assignment first.";

export async function deleteMaterialQuestionSet(materialId: string, setId: string, revision: number) {
  try {
    await api.delete(setPath(materialId, setId), {
      headers: await getMaterialAuthHeaders(), data: { revision },
    });
  } catch (error) {
    // The server explains 409s; keep the assignment message if a proxy drops it.
    if (axios.isAxiosError<MaterialApiError>(error) && error.response?.status === 409 && !error.response.data?.message) {
      throw new Error(ASSIGNED_QUESTION_SET_MESSAGE);
    }
    throw error;
  }
}

// ==========================
// INDEPENDENT LEARNER: personal practice, text correction, question preview (no answer keys), Trash and Restore
// ==========================
export interface PersonalPracticeState {
  revision: string; reviewed: boolean; missingPages: number[] | null;
  questionSetId: string | null; readingId: string | null;
  attemptId: string | null; attemptStatus: "in_progress" | "completed" | null;
  /** Questions exist only for an older version of the text: new questions are needed before answering. */
  questionsOutdated?: boolean;
  canEditText?: boolean;
  textLockedReason?: "assessment_unfinished" | "practice_started" | null;
  /** New questions for the same text (before any assessment), when the database supports it. */
  canGetNewQuestions?: boolean;
  /** Why the questions can no longer change: an assessment exists (its frozen copy is what is scored). */
  questionsLockedReason?: "assessment_unfinished" | "assessment_completed" | null;
}

export interface PersonalQuestionPreview {
  questionSetId: string | null;
  // Exactly what the learner sees while answering; the server never sends answers, explanations, evidence or hints.
  questions: { id: string; type: "literal" | "inferential" | "critical"; questionText: string; options: string[] }[];
}

export type TrashedMaterial = UploadedMaterial & { deletedAt: string };

const personalPracticePath = (materialId: string) => `/api/materials/${encodeURIComponent(materialId)}/personal-practice`;

export async function getPersonalPracticeState(materialId: string) {
  const { data } = await api.get<{ state: PersonalPracticeState }>(personalPracticePath(materialId), { headers: await getMaterialAuthHeaders() });
  return data.state;
}

/** Saves corrected reading text (before practice starts). Changed text must be confirmed again. */
export async function savePersonalMaterialText(materialId: string, contentText: string, revision: string) {
  const { data } = await api.put<{ state: PersonalPracticeState }>(`${personalPracticePath(materialId)}/text`,
    { contentText, revision }, { headers: await getMaterialAuthHeaders() });
  return data.state;
}

export async function confirmPersonalMaterialText(materialId: string, revision: string) {
  await api.post(`${personalPracticePath(materialId)}/confirm`, { confirmed: true, revision }, { headers: await getMaterialAuthHeaders() });
}

export async function getPersonalQuestionPreview(materialId: string) {
  const { data } = await api.get<PersonalQuestionPreview>(`${personalPracticePath(materialId)}/questions`, { headers: await getMaterialAuthHeaders() });
  return data;
}

export async function getTrashedMaterials() {
  const { data } = await api.get<{ materials: TrashedMaterial[] }>("/api/materials/trash", { headers: await getMaterialAuthHeaders() });
  return data.materials;
}

export async function restorePersonalMaterial(materialId: string) {
  await api.post(`${personalPracticePath(materialId)}/restore`, {}, { headers: await getMaterialAuthHeaders() });
}

/** Regenerate Questions: replaces the current private questions with a new set for the same text (before any assessment). */
export async function getNewPersonalQuestions(materialId: string) {
  await api.post(`${personalPracticePath(materialId)}/new-questions`, {}, { headers: await getMaterialAuthHeaders(), timeout: 150000 });
}
