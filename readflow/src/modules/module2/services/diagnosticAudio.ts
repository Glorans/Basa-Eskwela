import api from "../../../services/api";
import type {
  DiagnosticLanguage,
  DiagnosticTranscription,
} from "../types/diagnostic";
import {
  toDiagnosticAudioUploadError,
  type DiagnosticAudioErrorCode,
} from "./diagnosticAudioError";

export interface DiagnosticAudioUploadResult {
  success: boolean;
  message: string;
  code?: DiagnosticAudioErrorCode;
  transcription?: DiagnosticTranscription;
}

const extensionByMimeType: Record<string, string> = {
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-wav": "wav",
};

function getRecordingFilename(audioBlob: Blob) {
  const mimeType = audioBlob.type.split(";", 1)[0].trim().toLowerCase();
  const extension = extensionByMimeType[mimeType];

  return extension
    ? `diagnostic-recording.${extension}`
    : "diagnostic-recording";
}

export async function uploadDiagnosticAudio(
  audioBlob: Blob,
  language: DiagnosticLanguage,
) {
  const formData = new FormData();
  formData.append("audio", audioBlob, getRecordingFilename(audioBlob));
  formData.append("language", language);

  try {
    const response = await api.post<DiagnosticAudioUploadResult>(
      "/api/diagnostic/audio",
      formData,
    );

    return response.data;
  } catch (error) {
    throw toDiagnosticAudioUploadError(error);
  }
}
