import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type {
  DiagnosticLanguage,
  DiagnosticTranscription,
} from "../types/diagnostic";
import {
  DiagnosticAudioUploadError,
  SESSION_EXPIRED_MESSAGE,
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

/** Module 2 parts name the diagnostic and recording so the server can sign the transcript. */
export interface DiagnosticRecordingIdentity {
  recordingId: string;
  assessmentId: string;
  assessmentVersion: string;
}

export interface DiagnosticSegmentIdentity extends DiagnosticRecordingIdentity {
  segmentIndex: number;
}

export async function uploadDiagnosticAudio(
  audioBlob: Blob,
  language: DiagnosticLanguage,
  segment?: DiagnosticSegmentIdentity,
) {
  const formData = new FormData();
  formData.append("audio", audioBlob, getRecordingFilename(audioBlob));
  formData.append("language", language);
  if (segment) {
    formData.append("recordingId", segment.recordingId);
    formData.append("segmentIndex", String(segment.segmentIndex));
    formData.append("assessmentId", segment.assessmentId);
    formData.append("assessmentVersion", segment.assessmentVersion);
  }

  let headers: Awaited<ReturnType<typeof getSessionAuthHeaders>>;
  try {
    headers = await getSessionAuthHeaders(SESSION_EXPIRED_MESSAGE);
  } catch {
    // No upload is attempted without a session; the recording stays in memory.
    throw new DiagnosticAudioUploadError("AUTH_REQUIRED", SESSION_EXPIRED_MESSAGE, 401);
  }

  try {
    const response = await api.post<DiagnosticAudioUploadResult>(
      "/api/diagnostic/audio",
      formData,
      { headers },
    );

    return response.data;
  } catch (error) {
    throw toDiagnosticAudioUploadError(error);
  }
}
