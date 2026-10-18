import type { AxiosProgressEvent } from "axios";
import api from "../../../services/api";
import type { MaterialFileType, MaterialLanguageCode } from "../types/content";
import { getMaterialAuthHeaders } from "./materialService";
import { normalizeLanguageAlias } from "./moduleModel";

interface AdminModuleExtractionResponse {
  success: true;
  extraction: {
    fileType: MaterialFileType;
    extractedText: string;
    ocrConfidence: number | null;
  };
}

export interface AdminModuleExtractionInput {
  file: File;
  learningPathLanguage: string;
}

export const ADMIN_MODULE_FILE_ACCEPT =
  ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

export function getExtractionLanguage(learningPathLanguage: string): MaterialLanguageCode {
  const language = normalizeLanguageAlias(learningPathLanguage);
  if (language) return language;

  throw new Error("The selected learning path does not have a supported extraction language.");
}

export async function extractAdminModulePassage(
  input: AdminModuleExtractionInput,
  onUploadComplete?: () => void,
  signal?: AbortSignal,
) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("language", getExtractionLanguage(input.learningPathLanguage));

  let uploadReported = false;
  const onUploadProgress = (event: AxiosProgressEvent) => {
    if (!uploadReported && event.total && event.loaded >= event.total) {
      uploadReported = true;
      onUploadComplete?.();
    }
  };

  const response = await api.post<AdminModuleExtractionResponse>(
    "/api/admin/modules/extract",
    formData,
    {
      headers: await getMaterialAuthHeaders(),
      onUploadProgress,
      signal,
    },
  );
  onUploadComplete?.();
  return response.data.extraction;
}
