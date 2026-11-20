import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { LearnerPlacement } from "./learnerPlacement";
import type { MaterialLanguageCode } from "../types/content";

/** The signed-in learner's own placement from the backend (GET /api/diagnostic-history/placement/:language). */
export async function getServerPlacement(language: MaterialLanguageCode): Promise<LearnerPlacement> {
  const headers = await getSessionAuthHeaders("Your session has expired. Please sign in again.");
  const response = await api.get<{ success: true; placement: LearnerPlacement }>(
    `/api/diagnostic-history/placement/${encodeURIComponent(language)}`, { headers });
  return response.data.placement;
}
