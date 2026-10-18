const fs = require("fs/promises");
const speech = require("@google-cloud/speech");

let speechClient;
function getSpeechClient() { return speechClient ??= new speech.SpeechClient(); }
// Google Speech-to-Text v1 requires sampleRateHertz for WEBM_OPUS. The tested
// browser capture is 48 kHz; GOOGLE_STT_SAMPLE_RATE remains an override for a
// deployment whose native capture rate differs.
const DEFAULT_SAMPLE_RATE_HERTZ = 48000;
const MAX_SYNCHRONOUS_AUDIO_BYTES = 10 * 1024 * 1024;

const SAFE_SPEECH_ERRORS = {
  AUDIO_TOO_LONG: {
    status: 422,
    message:
      "The recording is too long to process. Please make a shorter recording and try again.",
  },
  NO_SPEECH: {
    status: 422,
    message: "No speech could be recognized from the recording.",
  },
  STT_INVALID_AUDIO: {
    status: 422,
    message: "The recording could not be processed as WebM audio. Please record it again.",
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
};

class SpeechTranscriptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpeechTranscriptionError";
    this.code = code;
  }
}

function getSampleRateHertz() {
  const configuredValue = process.env.GOOGLE_STT_SAMPLE_RATE;
  const sampleRateHertz = configuredValue
    ? Number.parseInt(configuredValue, 10)
    : DEFAULT_SAMPLE_RATE_HERTZ;

  if (!Number.isInteger(sampleRateHertz) || sampleRateHertz <= 0) {
    throw new Error("GOOGLE_STT_SAMPLE_RATE must be a positive integer.");
  }

  return sampleRateHertz;
}

function isGoogleAudioTooLongError(error) {
  const rawMessage = error instanceof Error
    ? error.message
    : error && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : "";
  const message = rawMessage.toLowerCase();

  return (
    message.includes("audio too long") ||
    message.includes("input too long") ||
    message.includes("sync input too long") ||
    message.includes("inline audio exceeds duration limit") ||
    message.includes("exceeds 60 seconds") ||
    message.includes("exceeds the maximum allowed size")
  );
}

function isAudioTooLongError(error) {
  return (
    error instanceof SpeechTranscriptionError &&
    error.code === "AUDIO_TOO_LONG"
  );
}

function mapGoogleSpeechError(error) {
  if (error instanceof SpeechTranscriptionError) return error;

  if (isGoogleAudioTooLongError(error)) {
    return new SpeechTranscriptionError(
      "AUDIO_TOO_LONG",
      SAFE_SPEECH_ERRORS.AUDIO_TOO_LONG.message,
    );
  }

  if (/credential|ENOENT|private.key|default.*authentication/i.test(error?.message ?? "")) {
    return new SpeechTranscriptionError("STT_PERMISSION", SAFE_SPEECH_ERRORS.STT_PERMISSION.message);
  }
  const rawCode = error && typeof error === "object" ? error.code : undefined;
  const numericCode = Number(rawCode);
  const namedCode = typeof rawCode === "string" ? rawCode.toUpperCase() : "";

  if (numericCode === 3 || namedCode === "INVALID_ARGUMENT") {
    return new SpeechTranscriptionError(
      "STT_INVALID_AUDIO",
      SAFE_SPEECH_ERRORS.STT_INVALID_AUDIO.message,
    );
  }

  if (numericCode === 4 || namedCode === "DEADLINE_EXCEEDED") {
    return new SpeechTranscriptionError(
      "STT_DEADLINE",
      SAFE_SPEECH_ERRORS.STT_DEADLINE.message,
    );
  }

  if (numericCode === 8 || namedCode === "RESOURCE_EXHAUSTED") {
    return new SpeechTranscriptionError(
      "STT_QUOTA",
      SAFE_SPEECH_ERRORS.STT_QUOTA.message,
    );
  }

  if (
    numericCode === 7
    || numericCode === 16
    || namedCode === "PERMISSION_DENIED"
    || namedCode === "UNAUTHENTICATED"
  ) {
    return new SpeechTranscriptionError(
      "STT_PERMISSION",
      SAFE_SPEECH_ERRORS.STT_PERMISSION.message,
    );
  }

  return new SpeechTranscriptionError(
    "STT_PROVIDER_ERROR",
    SAFE_SPEECH_ERRORS.STT_PROVIDER_ERROR.message,
  );
}

function getSpeechErrorResponse(error) {
  const mappedError = mapGoogleSpeechError(error);
  const safeError = SAFE_SPEECH_ERRORS[mappedError.code]
    || SAFE_SPEECH_ERRORS.STT_PROVIDER_ERROR;

  return {
    code: SAFE_SPEECH_ERRORS[mappedError.code]
      ? mappedError.code
      : "STT_PROVIDER_ERROR",
    status: safeError.status,
    message: safeError.message,
  };
}

function buildRecognitionRequest(audioBuffer, languageCode) {
  return {
    audio: {
      content: audioBuffer.toString("base64"),
    },
    config: {
      encoding: "WEBM_OPUS",
      sampleRateHertz: getSampleRateHertz(),
      languageCode,
      ...(languageCode === "en-US" ? { model: "latest_long" } : {}),
      enableAutomaticPunctuation: true,
    },
  };
}

async function transcribeWebm(filePath, languageCode) {
  const audioBuffer = await fs.readFile(filePath);

  // Synchronous recognition fits the current short diagnostic prototype.
  // TODO: Recordings near/over 60 seconds or 10 MB need a later long-audio
  // strategy using Cloud Storage and long-running recognition.
  if (audioBuffer.length > MAX_SYNCHRONOUS_AUDIO_BYTES) {
    throw new SpeechTranscriptionError(
      "AUDIO_TOO_LONG",
      "The recording exceeds the synchronous recognition size limit.",
    );
  }

  try {
    const [response] = await getSpeechClient().recognize(
      buildRecognitionRequest(audioBuffer, languageCode),
    );

    const alternatives = (response.results || [])
      .map((result) => result.alternatives?.[0])
      .filter(Boolean);
    const text = alternatives
      .map((alternative) => alternative.transcript || "")
      .join(" ")
      .trim();
    const confidences = alternatives
      .map((alternative) => alternative.confidence)
      .filter((confidence) => Number.isFinite(confidence));

    if (!text) {
      throw new SpeechTranscriptionError(
        "NO_SPEECH",
        SAFE_SPEECH_ERRORS.NO_SPEECH.message,
      );
    }

    if (confidences.length === 0) {
      return { text };
    }

    const confidence =
      confidences.reduce((total, value) => total + value, 0) /
      confidences.length;

    return {
      text,
      confidence: Number(confidence.toFixed(4)),
    };
  } catch (error) {
    if (error instanceof SpeechTranscriptionError) {
      throw error;
    }

    console.error("Google Speech-to-Text recognize failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error && typeof error === "object" ? error.code : undefined,
      message: error instanceof Error ? error.message : String(error),
    });

    throw mapGoogleSpeechError(error);
  }
}

module.exports = {
  // Both recognition paths share the same server-side ADC credentials/client.
  createDiagnosticRecognitionStream: (request) => getSpeechClient().streamingRecognize(request),
  buildRecognitionRequest,
  getSpeechErrorResponse,
  isAudioTooLongError,
  mapGoogleSpeechError,
  SpeechTranscriptionError,
  transcribeWebm,
};
