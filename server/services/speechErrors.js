// Learner-safe speech errors shared by the M2 diagnostic and M5 read-aloud
// endpoints. Codes are stable: the frontend recognises them
// (readflow/src/modules/module2/services/diagnosticAudioError.ts).
const SAFE_SPEECH_ERRORS = Object.freeze({
  AUDIO_TOO_LONG: {
    status: 422,
    message: "The recording is too long to process. Please make a shorter recording and try again.",
  },
  NO_SPEECH: {
    status: 422,
    message: "No speech could be recognized from the recording.",
  },
  STT_INVALID_AUDIO: {
    status: 422,
    message: "The recording could not be processed. Please record it again.",
  },
  STT_BAD_REQUEST: {
    status: 503,
    message: "Speech processing could not accept the request. Please try again later. Your recording does not need to be replaced.",
  },
  STT_DEADLINE: {
    status: 504,
    message: "Speech processing timed out. Please try again.",
  },
  STT_PERMISSION: {
    status: 503,
    message: "Speech processing is temporarily unavailable. Please try again later.",
  },
  STT_QUOTA: {
    status: 503,
    message: "Speech processing is temporarily busy. Please try again later.",
  },
  STT_PROVIDER_ERROR: {
    status: 502,
    message: "Unable to process the recording. Please try again.",
  },
  SPEECH_NOT_CONFIGURED: {
    status: 503,
    message: "Speech services are not configured on the server. Please contact your administrator.",
  },
  PRONUNCIATION_UNSUPPORTED: {
    status: 422,
    message: "Pronunciation feedback is available for English readings only.",
  },
});

class SpeechTranscriptionError extends Error {
  constructor(code, message = SAFE_SPEECH_ERRORS[code]?.message) {
    super(message);
    this.name = "SpeechTranscriptionError";
    this.code = code;
  }
}

/** Thrown when AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are missing or malformed. */
class SpeechConfigurationError extends SpeechTranscriptionError {
  constructor() {
    super("SPEECH_NOT_CONFIGURED");
    this.name = "SpeechConfigurationError";
  }
}

function isAudioTooLongError(error) {
  return error instanceof SpeechTranscriptionError && error.code === "AUDIO_TOO_LONG";
}

function getSpeechErrorResponse(error) {
  const code = error instanceof SpeechTranscriptionError && SAFE_SPEECH_ERRORS[error.code]
    ? error.code
    : "STT_PROVIDER_ERROR";
  return { code, status: SAFE_SPEECH_ERRORS[code].status, message: SAFE_SPEECH_ERRORS[code].message };
}

module.exports = {
  SAFE_SPEECH_ERRORS,
  SpeechConfigurationError,
  SpeechTranscriptionError,
  getSpeechErrorResponse,
  isAudioTooLongError,
};
