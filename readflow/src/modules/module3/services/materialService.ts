import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type {
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
export async function createMaterialQuestionSet(materialId: string, questionCount = 6) {
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
