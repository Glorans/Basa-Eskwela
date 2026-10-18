import api from "../../../services/api";
import type { DiagnosticLanguage } from "../types/diagnostic";

export async function synthesizeDiagnosticSpeech(
  text: string,
  language: DiagnosticLanguage,
) {
  const response = await api.post<Blob>(
    "/api/tts",
    {
      text,
      language,
    },
    {
      responseType: "blob",
    },
  );

  return response.data;
}
