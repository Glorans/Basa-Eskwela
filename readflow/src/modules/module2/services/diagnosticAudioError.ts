export type DiagnosticAudioErrorCode =
  | "AUDIO_TOO_LONG"
  | "NO_SPEECH"
  | "STT_INVALID_AUDIO"
  | "STT_BAD_REQUEST"
  | "STT_DEADLINE"
  | "STT_PERMISSION"
  | "STT_QUOTA"
  | "STT_PROVIDER_ERROR"
  | "AUTH_REQUIRED"
  | "SPEECH_FORBIDDEN"
  | "AUDIO_TOO_LARGE"
  | "SPEECH_RATE_LIMITED"
  | "SPEECH_NOT_CONFIGURED"
  | "PRONUNCIATION_UNSUPPORTED"
  | "PRONUNCIATION_CHECK_IN_PROGRESS"
  | "PRONUNCIATION_STORE_UNAVAILABLE"
  | "PRONUNCIATION_CHECK_INTERRUPTED"
  | "PRONUNCIATION_RECORDING_MISMATCH"
  | "PRONUNCIATION_RECORDING_MISSING"
  | "RECORDING_STORAGE_UNAVAILABLE";

const SAFE_ERROR_CODES = new Set<DiagnosticAudioErrorCode>([
  "AUDIO_TOO_LONG",
  "NO_SPEECH",
  "STT_INVALID_AUDIO",
  "STT_BAD_REQUEST",
  "STT_DEADLINE",
  "STT_PERMISSION",
  "STT_QUOTA",
  "STT_PROVIDER_ERROR",
  "AUTH_REQUIRED",
  "SPEECH_FORBIDDEN",
  "AUDIO_TOO_LARGE",
  "SPEECH_RATE_LIMITED",
  "SPEECH_NOT_CONFIGURED",
  "PRONUNCIATION_UNSUPPORTED",
  "PRONUNCIATION_CHECK_IN_PROGRESS",
  "PRONUNCIATION_STORE_UNAVAILABLE",
  "PRONUNCIATION_CHECK_INTERRUPTED",
  "PRONUNCIATION_RECORDING_MISMATCH",
  "PRONUNCIATION_RECORDING_MISSING",
  "RECORDING_STORAGE_UNAVAILABLE",
]);

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

const DEFAULT_MESSAGE = "We couldn't process your reading. Please try processing it again.";

interface HttpErrorLike {
  isAxiosError?: boolean;
  response?: {
    status?: number;
    data?: {
      code?: unknown;
      message?: unknown;
    };
  };
}

export class DiagnosticAudioUploadError extends Error {
  readonly code: DiagnosticAudioErrorCode;
  readonly httpStatus?: number;

  constructor(
    code: DiagnosticAudioErrorCode,
    message = DEFAULT_MESSAGE,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "DiagnosticAudioUploadError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isSafeErrorCode(value: unknown): value is DiagnosticAudioErrorCode {
  return typeof value === "string"
    && SAFE_ERROR_CODES.has(value as DiagnosticAudioErrorCode);
}

export function toDiagnosticAudioUploadError(error: unknown) {
  if (error instanceof DiagnosticAudioUploadError) return error;

  const httpError = error as HttpErrorLike;
  const response = httpError?.isAxiosError ? httpError.response : undefined;
  const responseCode = response?.data?.code;
  const code = isSafeErrorCode(responseCode)
    ? responseCode
    : "STT_PROVIDER_ERROR";
  const responseMessage = response?.data?.message;
  const message = isSafeErrorCode(responseCode)
    && typeof responseMessage === "string"
    && responseMessage.trim().length > 0
    && responseMessage.length <= 300
    ? responseMessage.trim()
    : DEFAULT_MESSAGE;

  return new DiagnosticAudioUploadError(code, message, response?.status);
}

/** M2 renders bounded application wording, never arbitrary provider detail. Audio stays in page memory on failure. */
export function diagnosticProcessingMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "NO_SPEECH": return "No speech could be recognized in part of the recording. Listen to your recording and try again.";
    case "STT_INVALID_AUDIO": return "The recording could not be processed. Please record it again.";
    case "AUDIO_TOO_LONG": case "AUDIO_TOO_LARGE": return "The recording is too long or too large to process. Please make a shorter recording.";
    case "STT_QUOTA": case "SPEECH_RATE_LIMITED": return "Speech processing is temporarily busy. Please wait and try processing the same recording again.";
    case "STT_PERMISSION": case "SPEECH_NOT_CONFIGURED": case "STT_BAD_REQUEST": return "Speech processing is temporarily unavailable. Please try again later. Your recording is still available on this page.";
    case "STT_DEADLINE": return "Speech processing timed out. Please try processing the same recording again.";
    case "AUTH_REQUIRED": return SESSION_EXPIRED_MESSAGE;
    default: return DEFAULT_MESSAGE;
  }
}
