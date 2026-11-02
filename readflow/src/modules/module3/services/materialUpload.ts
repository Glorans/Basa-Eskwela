import axios, { type AxiosProgressEvent } from "axios";
import { supabase } from "../../../lib/supabaseClient";
import api from "../../../services/api";
import type {
  MaterialFileType,
  MaterialLanguageCode,
} from "../types/content";
import { getMaterialAuthHeaders } from "./materialService";

export type MaterialExtractionStatus = "completed";

/** How the server read the language from the extracted text. */
export interface MaterialLanguageDetection {
  language: MaterialLanguageCode | null;
  certain: boolean;
  reason: "clear" | "mixed" | "too_short" | "no_signal";
  suggestedLanguage: MaterialLanguageCode | null;
}

export interface TemporaryUploadedMaterial {
  id: string;
  title: string;
  /** Detected language; null when detection was uncertain and the teacher must choose. */
  language: MaterialLanguageCode | null;
  languageDetection?: MaterialLanguageDetection | null;
  uploadedBy: string;
  originalFilename: string;
  storedFilename: string;
  mimeType: string;
  fileType: MaterialFileType;
  size: number;
  uploadedAt: string;
  extractionStatus: MaterialExtractionStatus;
  extractedText: string | null;
  ocrConfidence: number | null;
  pageCount?: number;
  pagesWithoutText?: number[];
}

interface MaterialUploadResponse {
  success: true;
  material: TemporaryUploadedMaterial;
}

interface MaterialDeleteResponse {
  success: true;
  message: string;
}

interface MaterialPersistenceResponse {
  success: true;
  material: {
    id: string;
    uploadedBy: string;
    createdAt: string;
  };
}

interface MaterialApiError {
  success?: false;
  extractionStatus?: "failed";
  message?: string;
}

export interface MaterialUploadInput {
  file: File;
  title: string;
  /** Omitted: the server detects English or Filipino from the extracted text. */
  language?: MaterialLanguageCode;
  /** Cancels the request when the teacher removes or replaces the file. */
  signal?: AbortSignal;
}

export interface PersistUploadedMaterialInput {
  file: File;
  material: TemporaryUploadedMaterial;
  contentText: string;
  /** The teacher-confirmed language that is saved with the material. */
  language: MaterialLanguageCode;
}

export const MAX_MATERIAL_TEXT_LENGTH = 1_000_000;
export const MAX_MATERIAL_UPLOAD_BYTES = 25 * 1024 * 1024;
const MATERIAL_STORAGE_BUCKET = "reading-materials";

function getMaterialFileExtension(file: File, fileType: MaterialFileType) {
  const filenameExtension = file.name.split(".").pop()?.toLowerCase();

  if (fileType === "JPG" && (filenameExtension === "jpg" || filenameExtension === "jpeg")) {
    return filenameExtension;
  }

  const extensions: Record<MaterialFileType, string> = {
    PDF: "pdf",
    DOCX: "docx",
    JPG: "jpg",
    PNG: "png",
  };

  return extensions[fileType];
}

export async function uploadReadingMaterial(
  input: MaterialUploadInput,
  onUploadComplete?: () => void,
) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("title", input.title);
  if (input.language) formData.append("language", input.language);

  let processingReported = false;
  const onUploadProgress = (event: AxiosProgressEvent) => {
    if (!processingReported && event.total && event.loaded >= event.total) {
      processingReported = true;
      onUploadComplete?.();
    }
  };

  const response = await api.post<MaterialUploadResponse>("/api/materials/upload", formData, {
    headers: await getMaterialAuthHeaders(),
    onUploadProgress,
    signal: input.signal,
  });
  onUploadComplete?.();
  return response.data.material;
}

export async function persistUploadedMaterial({
  file,
  material,
  contentText,
  language,
}: PersistUploadedMaterialInput) {
  if (contentText.length > MAX_MATERIAL_TEXT_LENGTH) {
    throw new Error("The reviewed text is too long to save. Please shorten it before saving.");
  }
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (sessionError || !session?.access_token || authError || !user) {
    throw new Error("Your session could not be verified. Please sign in again and retry.");
  }

  const materialId = crypto.randomUUID();
  const extension = getMaterialFileExtension(file, material.fileType);
  const storagePath = `${user.id}/${materialId}.${extension}`;
  const { error: storageError } = await supabase.storage
    .from(MATERIAL_STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: material.mimeType || file.type,
      upsert: false,
    });

  if (storageError) {
    throw new Error("The original file could not be saved. Please try again.");
  }

  try {
    const response = await api.post<MaterialPersistenceResponse>(
      "/api/materials/finalize",
      {
        temporaryMaterialId: material.id,
        storagePath,
        contentText,
        language,
      },
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    return response.data.material;
  } catch (persistenceError) {
    const { error: cleanupError } = await supabase.storage
      .from(MATERIAL_STORAGE_BUCKET)
      .remove([storagePath]);

    if (cleanupError) {
      throw new Error(
        "The material could not be added, and its uploaded file could not be cleaned up. Please retry or contact support.",
      );
    }

    throw new Error(
      getMaterialRequestError(
        persistenceError,
        "The material could not be added. The uploaded file was cleaned up; please try again.",
      ),
    );
  }
}

export async function deleteTemporaryMaterial(materialId: string) {
  const response = await api.delete<MaterialDeleteResponse>(
    `/api/materials/temporary/${encodeURIComponent(materialId)}`,
    { headers: await getMaterialAuthHeaders() },
  );
  return response.data;
}

export function getMaterialRequestError(
  error: unknown,
  fallback = "Unable to process the material. Please try again.",
) {
  if (axios.isAxiosError<MaterialApiError>(error)) {
    return error.response?.data?.message || fallback;
  }

  return fallback;
}

export function getMaterialPersistenceError(
  error: unknown,
  fallback = "Unable to add the material. Please try again.",
) {
  return error instanceof Error ? error.message : fallback;
}
