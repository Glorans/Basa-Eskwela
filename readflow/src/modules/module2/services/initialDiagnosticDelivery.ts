import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { DiagnosticLanguage } from "../types/diagnostic";
import { resolveInitialDiagnostic, type InitialDelivery, type InitialDiagnosticLoad } from "../utils/initialDelivery";

async function fetchDelivery(language: DiagnosticLanguage, version?: string) {
  const headers = await getSessionAuthHeaders("Your session could not be verified. Please sign in again.");
  const response = await api.get<{ success: true } & InitialDelivery>(`/api/diagnostic/initial/${language}`,
    { headers, params: version ? { version } : undefined });
  return response.data;
}

const storedDraft = (key: string) => {
  try { return sessionStorage.getItem(key) !== null; } catch { return false; }
};

/**
 * M2 F6: loads the learner's initial diagnostic as chosen by the server (the active version, or a still-accepted
 * version the learner already started). A failure is shown as an error with Try Again; the bundled version is used
 * only when the server predates F6 (no delivery endpoint), because that server accepts nothing else.
 */
export function loadInitialDiagnostic(language: DiagnosticLanguage, userId: string): Promise<InitialDiagnosticLoad> {
  return resolveInitialDiagnostic(language, userId, fetchDelivery, storedDraft);
}
