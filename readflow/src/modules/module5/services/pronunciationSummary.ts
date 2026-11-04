// Pronunciation check results for English read-alouds: the speech service's own
// 0-100 scores, summarized and saved by the server (one result per attempt),
// kept apart from the transcript-based reading accuracy saved with the attempt.
// Filipino readings are never assessed.

export interface PronunciationWord {
  word: string;
  accuracy: number | null;
  errorType: "None" | "Mispronunciation" | "Omission" | "Insertion" | null;
}

export interface PronunciationUtterance {
  text: string;
  accuracy: number | null;
  fluency: number | null;
  words: PronunciationWord[];
}

export interface PronunciationPartResult {
  provider: "azure";
  locale: "en-US";
  scale: "0-100";
  utterances: PronunciationUtterance[];
  /** False when Azure heard speech it could not assess; silence and noise do not count. */
  complete?: boolean;
  durationSeconds?: number;
  unassessedSegments?: number;
  /** Null when the length of some unassessed speech is unknown. */
  unassessedSeconds?: number | null;
}

/** Computed and saved by the server; the browser never computes or sends scores. */
export interface PronunciationSummary {
  parts: number;
  utterances: number;
  /** Word-weighted mean of the utterance accuracy scores, or null if none were given. */
  accuracy: number | null;
  /** Word-weighted mean of the utterance fluency scores, or null if none were given. */
  fluency: number | null;
  /** Words marked as mispronounced or scored below 60. */
  wordsToPractice: string[];
  /** Seconds of saved recording that were sent for assessment. */
  assessedSeconds?: number;
  /** True only when every part covered all of its speech. */
  complete?: boolean;
  /** Seconds of speech that could not be assessed (null if unmeasured); 0 when complete. */
  unassessedSeconds?: number | null;
}

/** One pronunciation check as the server returns it. */
export interface PronunciationCheckResult {
  summary: PronunciationSummary;
  /** True only when the server confirmed the result is permanently saved. */
  saved: boolean;
  checkedAt?: string | null;
  /** Why an unsaved result was not saved, for the learner. */
  notice?: string;
}

/** The saved state of one attempt's check, read without running a new check. */
export type SavedPronunciationStatus = "none" | "running" | "completed" | "unsupported" | "unavailable";

export interface SavedPronunciationCheck {
  status: SavedPronunciationStatus;
  check: PronunciationCheckResult | null;
}

/** Saved scores shown in Reading History (F7). */
export interface SavedPronunciationScores {
  accuracy: number | null;
  fluency: number | null;
  complete: boolean;
  checkedAt: string;
}

export class PronunciationCheckInProgressError extends Error {
  constructor(message = "A pronunciation check for this reading is already running. Please wait a moment.") {
    super(message);
    this.name = "PronunciationCheckInProgressError";
  }
}

/** Plain-language meaning of a 0-100 pronunciation score for young readers. */
export function pronunciationMessage(accuracy: number) {
  if (accuracy >= 85) return "Your words sounded very clear!";
  if (accuracy >= 70) return "Most of your words sounded clear.";
  return "Some words need more practice.";
}

export function noSpeechMessage(summary: PronunciationSummary) {
  return summary.complete === false
    ? "We heard speech but couldn't check its pronunciation. Try reading again clearly, in a quiet place."
    : "We couldn't hear enough speech to check pronunciation. Try reading again a little louder.";
}

/**
 * F2 feedback in words only: no scores, no word list, no transcript. Built only
 * from the pronunciation check, never from transcript differences.
 */
export function pronunciationFeedbackText(summary: PronunciationSummary) {
  if (summary.utterances === 0) return noSpeechMessage(summary);
  if (summary.accuracy === null) {
    return "We could not measure your pronunciation this time. Try reading again clearly, in a quiet place.";
  }
  return [
    pronunciationMessage(summary.accuracy),
    summary.wordsToPractice.length > 0
      ? "Open Words to Practice to hear the words that need clearer pronunciation, then say each one slowly."
      : "The words we checked sounded clear. Great job!",
    ...(summary.complete === false ? ["Some of your speech could not be checked, perhaps because it was unclear or noisy."] : []),
    "Keep reading slowly and say each sound clearly.",
  ].join(" ");
}

export type PronunciationCheckStep = "loading" | "preparing" | "uploading" | "assessing";

export interface AssessRecordingDependencies {
  loadRecording: (attemptId: string) => Promise<{ available: boolean; segments: string[] }>;
  fetchAudio: (url: string, signal?: AbortSignal) => Promise<Blob>;
  /** Returns one saved file as one WAV: the server expects exactly one WAV per saved file. */
  convert: (audio: Blob) => Promise<Blob>;
  /** The one paid request: every WAV, in order; the server assesses, summarizes and saves. */
  assess: (attemptId: string, wavs: Blob[], options: { signal?: AbortSignal; onAssessing?: () => void }) => Promise<PronunciationCheckResult>;
  signal?: AbortSignal;
  onStep?: (step: PronunciationCheckStep) => void;
}

export class PronunciationUnavailableError extends Error {
  constructor(message = "There is no saved recording to check yet.") {
    super(message);
    this.name = "PronunciationUnavailableError";
  }
}

export class PronunciationIncompleteError extends Error {
  constructor() {
    super("Only part of your recording could be checked. Please try again.");
    this.name = "PronunciationIncompleteError";
  }
}

/**
 * Checks an English reading's whole saved recording. A recording saved as one
 * file (every M5 reading since the continuous recorder) is one WAV; older
 * readings saved as several files send one WAV per file, in recorder order,
 * in the same single request. The server assesses them, computes the summary
 * (including speech it could not assess) and saves it. Any failure or
 * cancellation rejects with no summary.
 */
export async function assessRecordingPronunciation(
  attemptId: string,
  { loadRecording, fetchAudio, convert, assess, signal, onStep }: AssessRecordingDependencies,
): Promise<PronunciationCheckResult> {
  onStep?.("loading");
  const recording = await loadRecording(attemptId);
  if (!recording.available || recording.segments.length === 0) throw new PronunciationUnavailableError();
  const wavs: Blob[] = [];
  for (const url of recording.segments) {
    const audio = await fetchAudio(url, signal);
    onStep?.("preparing");
    wavs.push(await convert(audio));
    if (signal?.aborted) throw new PronunciationIncompleteError();
  }
  onStep?.("uploading");
  return assess(attemptId, wavs, { signal, onAssessing: () => onStep?.("assessing") });
}
