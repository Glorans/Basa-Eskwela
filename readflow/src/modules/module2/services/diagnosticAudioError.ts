export type DiagnosticAudioErrorCode =
  | "AUDIO_TOO_LONG"
  | "NO_SPEECH"
  | "STT_INVALID_AUDIO"
  | "STT_DEADLINE"
  | "STT_PERMISSION"
  | "STT_QUOTA"
  | "STT_PROVIDER_ERROR"
  | "AUTH_REQUIRED"
  | "SPEECH_FORBIDDEN"
  | "AUDIO_TOO_LARGE"
  | "SPEECH_RATE_LIMITED"
  | "SPEECH_NOT_CONFIGURED"
  | "PRONUNCIATION_UNSUPPORTED";

const SAFE_ERROR_CODES = new Set<DiagnosticAudioErrorCode>([
  "AUDIO_TOO_LONG",
  "NO_SPEECH",
  "STT_INVALID_AUDIO",
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
]);

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

const DEFAULT_MESSAGE = "We couldn't process your reading. Please record it again.";

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
