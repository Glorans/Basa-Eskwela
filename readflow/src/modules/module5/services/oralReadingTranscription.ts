import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { DiagnosticLanguage, DiagnosticTranscription } from "../../module2/types/diagnostic";
import type { DiagnosticAudioUploadResult } from "../../module2/services/diagnosticAudio";
import {
  DiagnosticAudioUploadError,
  SESSION_EXPIRED_MESSAGE,
  toDiagnosticAudioUploadError,
} from "../../module2/services/diagnosticAudioError";
import { SpeechWavTooLongError, convertToSpeechWavRecording } from "../../module2/services/speechWav";
import type { PronunciationPartResult } from "./pronunciationSummary";

export type ReadAloudTranscriptionStep = "preparing" | "uploading" | "recognizing";

export const SLOW_UPLOAD_MESSAGE = "The connection is too slow right now. Please check your internet and try again.";
export const RECOGNITION_TIMEOUT_MESSAGE = "Speech processing timed out. Please try again.";

// The upload of a whole reading's WAV (up to about 9.6 MB) is timed by its
// progress, not by its total length: a slow but moving upload may continue,
// while one that sends nothing for this long is treated as a lost connection.
export const UPLOAD_STALL_TIMEOUT_MS = 45_000;

/**
 * After the upload, Azure runs one session over the whole reading. The server's
 * deadline is its configured limit (at most 120 s) plus half the recording,
 * because audio is sent to Azure at twice real time (wholeRecordingDeadlineMs in
 * server/services/azureSpeechService.js); 30 s more covers the server's reply.
 */
export function recognitionTimeoutMs(recordingDurationSeconds: number) {
  return 150_000 + Math.ceil(Math.max(0, recordingDurationSeconds) * 1000 / 2);
}

type UploadProgress = { loaded: number; total?: number };
type PostConfig = {
  headers: Record<string, string>;
  signal: AbortSignal;
  onUploadProgress: (event: UploadProgress) => void;
};
type PostReadAloudAudio = (form: FormData, config: PostConfig) => Promise<{ data: DiagnosticAudioUploadResult }>;
type PronunciationResponse = { success: boolean; code?: string; message?: string; pronunciation?: PronunciationPartResult };
type PostPronunciationAudio = (attemptId: string, form: FormData, config: PostConfig) => Promise<{ data: PronunciationResponse }>;

const postReadAloudAudio: PostReadAloudAudio = (form, config) =>
  api.post<DiagnosticAudioUploadResult>("/api/read-aloud/audio", form, config);
const postPronunciationAudio: PostPronunciationAudio = (attemptId, form, config) =>
  api.post<PronunciationResponse>(`/api/oral-reading/attempts/${encodeURIComponent(attemptId)}/pronunciation`, form, config);

/** Seconds of audio in a 16 kHz mono 16-bit WAV made by speechWav.ts. */
export const speechWavSeconds = (wav: Blob) => Math.max(0, wav.size - 44) / 32000;

/**
 * Sends one prepared WAV and waits for the reply. The upload is timed by its
 * progress (UPLOAD_STALL_TIMEOUT_MS without progress means a lost connection);
 * once it is fully sent, the wait is the server's Azure deadline for audio of
 * this length. A timeout or the caller's signal aborts the request itself, so
 * nothing keeps uploading or running on Azure behind a retry.
 */
async function sendWithProgressDeadline<T>(
  send: (config: Omit<PostConfig, "headers">) => Promise<{ data: T }>,
  { wavBytes, recordingDurationSeconds, signal, onUploaded, timing }: {
    wavBytes: number; recordingDurationSeconds: number; signal?: AbortSignal;
    onUploaded?: () => void; timing: Record<string, unknown>;
  },
): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut: DiagnosticAudioUploadError | undefined;
  const arm = (ms: number, error: DiagnosticAudioUploadError) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = error; controller.abort(); }, ms);
  };
  const stalled = () => new DiagnosticAudioUploadError("STT_PROVIDER_ERROR", SLOW_UPLOAD_MESSAGE);
  const uploadStartedAt = Date.now();
  let uploaded = false;
  arm(UPLOAD_STALL_TIMEOUT_MS, stalled());
  try {
    return (await send({
      signal: controller.signal,
      onUploadProgress: ({ loaded, total }) => {
        if (uploaded) return;
        if (loaded >= (total ?? wavBytes)) {
          uploaded = true;
          timing.uploadMs = Date.now() - uploadStartedAt;
          onUploaded?.();
          arm(recognitionTimeoutMs(recordingDurationSeconds),
            new DiagnosticAudioUploadError("STT_DEADLINE", RECOGNITION_TIMEOUT_MESSAGE));
        } else {
          // Still moving: restart the stall window.
          arm(UPLOAD_STALL_TIMEOUT_MS, stalled());
        }
      },
    })).data;
  } catch (error) {
    timing.outcome = timedOut ? timedOut.code : "failed";
    throw timedOut ?? toDiagnosticAudioUploadError(error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
    if (uploaded) timing.waitMs = Date.now() - uploadStartedAt - (timing.uploadMs as number);
  }
}

async function sessionHeaders() {
  try {
    return await getSessionAuthHeaders(SESSION_EXPIRED_MESSAGE);
  } catch {
    // Nothing is uploaded without a session; the recording stays in memory.
    throw new DiagnosticAudioUploadError("AUTH_REQUIRED", SESSION_EXPIRED_MESSAGE, 401);
  }
}

interface TranscribeOptions {
  recordingDurationSeconds: number;
  /** Reports each step so the page can say what is happening. */
  onStep?: (step: ReadAloudTranscriptionStep) => void;
  /** Aborts the request, for example when the learner leaves the page. */
  signal?: AbortSignal;
  convert?: (audio: Blob) => Promise<Blob>;
  post?: PostReadAloudAudio;
}

// Durations and sizes only, in development: never audio, transcripts or tokens.
function developmentTiming(details: Record<string, unknown>) {
  if (import.meta.env?.DEV) console.info("[ReadAloud] timing", details);
}

/** Starts timing one step of the read-aloud flow; call the result when it ends. */
export function startReadAloudTiming(step: string) {
  const startedAt = Date.now();
  return (outcome = "ok") => developmentTiming({ step, outcome, ms: Date.now() - startedAt });
}

/**
 * Module 5 speech-to-text for one whole read-aloud. The continuous WebM
 * recording (the same file saved for playback) is decoded once into a single
 * 16 kHz WAV and sent in one request; the server runs one Azure
 * continuous-recognition session over it and replies only once that session
 * has ended. Resolves with the final transcript or rejects; never partial text.
 * A request that times out is aborted, so it never keeps uploading or
 * recognizing behind a retry.
 */
export async function transcribeOralReadingRecording(
  recording: Blob,
  language: DiagnosticLanguage,
  {
    recordingDurationSeconds, onStep, signal,
    convert = convertToSpeechWavRecording, post = postReadAloudAudio,
  }: TranscribeOptions,
): Promise<DiagnosticTranscription> {
  const startedAt = Date.now();
  const timing: Record<string, unknown> = { recordingSeconds: Math.round(recordingDurationSeconds) };
  const headers = await sessionHeaders();

  onStep?.("preparing");
  let wav: Blob;
  try {
    wav = await convert(recording);
  } catch (error) {
    throw error instanceof SpeechWavTooLongError
      ? new DiagnosticAudioUploadError("AUDIO_TOO_LONG", "This recording is too long to process. Please record it again.")
      : new DiagnosticAudioUploadError("STT_INVALID_AUDIO", "This recording could not be prepared. Please record it again.");
  }
  timing.prepareMs = Date.now() - startedAt;
  timing.wavBytes = wav.size;

  const form = new FormData();
  form.append("audio", wav, "read-aloud.wav");
  form.append("language", language);

  onStep?.("uploading");
  let result: DiagnosticAudioUploadResult;
  try {
    result = await sendWithProgressDeadline((config) => post(form, { ...config, headers }), {
      wavBytes: wav.size, recordingDurationSeconds, signal, timing, onUploaded: () => onStep?.("recognizing"),
    });
  } finally {
    timing.totalMs = Date.now() - startedAt;
    developmentTiming({ step: "transcription", ...timing });
  }
  if (!result.success || !result.transcription?.text.trim()) {
    throw new DiagnosticAudioUploadError(result.code ?? "NO_SPEECH", result.message);
  }
  return { text: result.transcription.text, confidence: result.transcription.confidence };
}

/**
 * English Azure Pronunciation Assessment of one prepared WAV of a saved
 * recording: normally the whole reading, assessed in one continuous session.
 * Uses the same progress deadline and cancellation as speech-to-text.
 */
export async function assessOralReadingPronunciation(
  attemptId: string,
  wav: Blob,
  { signal, onAssessing, post = postPronunciationAudio }: {
    signal?: AbortSignal; onAssessing?: () => void; post?: PostPronunciationAudio;
  } = {},
): Promise<PronunciationPartResult> {
  const startedAt = Date.now();
  const recordingDurationSeconds = speechWavSeconds(wav);
  const timing: Record<string, unknown> = { recordingSeconds: Math.round(recordingDurationSeconds), wavBytes: wav.size };
  const headers = await sessionHeaders();
  const form = new FormData();
  form.append("audio", wav, "part.wav");
  let response: PronunciationResponse;
  try {
    response = await sendWithProgressDeadline((config) => post(attemptId, form, { ...config, headers }), {
      wavBytes: wav.size, recordingDurationSeconds, signal, timing, onUploaded: onAssessing,
    });
  } finally {
    timing.totalMs = Date.now() - startedAt;
    developmentTiming({ step: "pronunciation", ...timing });
  }
  if (!response.success || !response.pronunciation) {
    throw new DiagnosticAudioUploadError("STT_PROVIDER_ERROR",
      typeof response.message === "string" && response.message.trim()
        ? response.message
        : "Pronunciation feedback is unavailable right now. Please try again.");
  }
  return response.pronunciation;
}
