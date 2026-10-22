import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { DiagnosticLanguage } from "../types/diagnostic";

export async function synthesizeDiagnosticSpeech(
  text: string,
  language: DiagnosticLanguage,
) {
  const headers = await getSessionAuthHeaders("Your session has expired. Please sign in again.");
  const response = await api.post<Blob>(
    "/api/tts",
    {
      text,
      language,
    },
    {
      headers,
      responseType: "blob",
    },
  );

  return response.data;
}
