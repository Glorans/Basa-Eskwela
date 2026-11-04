import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { DiagnosticLanguage } from "../types/diagnostic";

export interface DiagnosticSpeechOptions {
  /** M5 feedback only: en-PH / fil-PH voice. Omitted keeps the server's default voice. */
  voiceProfile?: "philippine" | "american";
}

export async function synthesizeDiagnosticSpeech(
  text: string,
  language: DiagnosticLanguage,
  options: DiagnosticSpeechOptions = {},
) {
  const headers = await getSessionAuthHeaders("Your session has expired. Please sign in again.");
  const response = await api.post<Blob>(
    "/api/tts",
    {
      text,
      language,
      ...(options.voiceProfile ? { voiceProfile: options.voiceProfile } : {}),
    },
    {
      headers,
      responseType: "blob",
    },
  );

  return response.data;
}
