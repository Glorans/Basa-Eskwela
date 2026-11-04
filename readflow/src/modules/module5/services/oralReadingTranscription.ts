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
import {
  PronunciationCheckInProgressError,
  type PronunciationCheckResult,
  type PronunciationSummary,
  type SavedPronunciationCheck,
} from "./pronunciationSummary.ts";

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

/**
 * The server checks an older multi-file recording one file after another, each
 * with its own deadline, so the wait after upload allows one deadline per file.
 */
export function pronunciationTimeoutMs(fileCount: number, recordingDurationSeconds: number) {
  return 150_000 * Math.max(1, fileCount) + Math.ceil(Math.max(0, recordingDurationSeconds) * 1000 / 2);
}

type UploadProgress = { loaded: number; total?: number };
type PostConfig = {
  headers: Record<string, string>;
  signal: AbortSignal;
  onUploadProgress: (event: UploadProgress) => void;
};
type PostReadAloudAudio = (form: FormData, config: PostConfig) => Promise<{ data: DiagnosticAudioUploadResult }>;
type ServerCheck = { summary?: PronunciationSummary; saved?: boolean; checkedAt?: string | null };
type PronunciationResponse = { success: boolean; code?: string; message?: string; saved?: boolean; check?: ServerCheck };
type SavedPronunciationResponse = { success: boolean; status?: SavedPronunciationCheck["status"]; check?: ServerCheck | null };
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
  { wavBytes, recordingDurationSeconds, signal, onUploaded, timing, processingTimeoutMs }: {
    wavBytes: number; recordingDurationSeconds: number; signal?: AbortSignal; processingTimeoutMs?: number;
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
          arm(processingTimeoutMs ?? recognitionTimeoutMs(recordingDurationSeconds),
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

function toCheckResult(check: ServerCheck | null | undefined, saved: boolean, notice?: string): PronunciationCheckResult | null {
  if (!check?.summary || typeof check.summary.utterances !== "number") return null;
  return { summary: check.summary, saved, checkedAt: check.checkedAt ?? null, ...(notice ? { notice } : {}) };
}

/**
 * English pronunciation check of a saved recording's prepared WAVs (normally
 * one: the whole reading), sent in one request. The server returns a saved
 * result without a new assessment, or assesses, summarizes and saves it.
 * `saved` is true only when the server confirmed the save. Uses the same
 * progress deadline and cancellation as speech-to-text.
 */
export async function assessOralReadingPronunciation(
  attemptId: string,
  wavs: Blob | readonly Blob[],
  { signal, onAssessing, post = postPronunciationAudio }: {
    signal?: AbortSignal; onAssessing?: () => void; post?: PostPronunciationAudio;
  } = {},
): Promise<PronunciationCheckResult> {
  const parts = Array.isArray(wavs) ? wavs : [wavs as Blob];
  const startedAt = Date.now();
  const wavBytes = parts.reduce((total, wav) => total + wav.size, 0);
  const recordingDurationSeconds = parts.reduce((total, wav) => total + speechWavSeconds(wav), 0);
  const timing: Record<string, unknown> = { recordingSeconds: Math.round(recordingDurationSeconds), wavBytes, parts: parts.length };
  const headers = await sessionHeaders();
  const form = new FormData();
  parts.forEach((wav, index) => form.append("audio", wav, `part-${index}.wav`));
  let response: PronunciationResponse;
  try {
    response = await sendWithProgressDeadline((config) => post(attemptId, form, { ...config, headers }), {
      wavBytes, recordingDurationSeconds, signal, timing, onUploaded: onAssessing,
      processingTimeoutMs: pronunciationTimeoutMs(parts.length, recordingDurationSeconds),
    });
  } catch (error) {
    if (error instanceof DiagnosticAudioUploadError && error.code === "PRONUNCIATION_CHECK_IN_PROGRESS") {
      throw new PronunciationCheckInProgressError();
    }
    throw error;
  } finally {
    timing.totalMs = Date.now() - startedAt;
    developmentTiming({ step: "pronunciation", ...timing });
  }
  const saved = response.success === true && response.saved === true;
  const result = response.success
    ? toCheckResult(response.check, saved, saved ? undefined : typeof response.message === "string" ? response.message : undefined)
    : null;
  if (!result) {
    throw new DiagnosticAudioUploadError("STT_PROVIDER_ERROR",
      typeof response.message === "string" && response.message.trim()
        ? response.message
        : "Pronunciation feedback is unavailable right now. Please try again.");
  }
  return result;
}

const SAVED_CHECK_STATUSES = new Set(["none", "running", "completed", "unsupported", "unavailable"]);

async function getSavedCheck(path: string, fallback: string): Promise<SavedPronunciationCheck> {
  let data: SavedPronunciationResponse;
  try {
    data = (await api.get<SavedPronunciationResponse>(path, { headers: await sessionHeaders(), timeout: 30_000 })).data;
  } catch (error) {
    throw error instanceof DiagnosticAudioUploadError ? error : toDiagnosticAudioUploadError(error);
  }
  if (!data?.success || !data.status || !SAVED_CHECK_STATUSES.has(data.status)) throw new Error(fallback);
  const check = data.status === "completed" ? toCheckResult(data.check, true) : null;
  if (data.status === "completed" && !check) throw new Error(fallback);
  return { status: data.status, check };
}

/** The learner's saved check for one attempt. Free: never runs a new check. */
export function getSavedPronunciationCheck(attemptId: string) {
  return getSavedCheck(`/api/oral-reading/attempts/${encodeURIComponent(attemptId)}/pronunciation`,
    "Saved pronunciation results could not be loaded.");
}

/** A student's saved check, for a Teacher allowed to review the attempt. */
export function getTeacherPronunciationCheck(attemptId: string) {
  return getSavedCheck(`/api/oral-reading/teacher/attempts/${encodeURIComponent(attemptId)}/pronunciation`,
    "The saved pronunciation check could not be loaded.");
}
