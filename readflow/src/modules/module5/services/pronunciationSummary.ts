// Azure Pronunciation Assessment results for English read-alouds. These are
// Azure's own 0-100 scores, kept apart from the transcript-based reading
// accuracy saved with the attempt. Filipino readings are never assessed.

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

export interface PronunciationSummary {
  parts: number;
  utterances: number;
  /** Word-weighted mean of Azure's utterance accuracy scores, or null if Azure gave none. */
  accuracy: number | null;
  /** Word-weighted mean of Azure's utterance fluency scores, or null if Azure gave none. */
  fluency: number | null;
  /** Words Azure marked as mispronounced or scored below 60. */
  wordsToPractice: string[];
  /** Seconds of saved recording that were sent for assessment. */
  assessedSeconds?: number;
  /** True only when every part covered all of its speech. */
  complete?: boolean;
  /** Seconds of speech Azure could not assess (null if unmeasured); 0 when complete. */
  unassessedSeconds?: number | null;
}

const PRACTICE_THRESHOLD = 60;
const MAX_PRACTICE_WORDS = 10;

function weightedMean(utterances: readonly PronunciationUtterance[], pick: (utterance: PronunciationUtterance) => number | null) {
  let total = 0;
  let weight = 0;
  for (const utterance of utterances) {
    const value = pick(utterance);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const words = Math.max(1, utterance.words.length);
    total += value * words;
    weight += words;
  }
  return weight ? Math.round(total / weight) : null;
}

export function summarizePronunciation(parts: readonly PronunciationPartResult[]): PronunciationSummary {
  const utterances = parts.flatMap((part) => part.utterances ?? []);
  const practice = new Set<string>();
  for (const utterance of utterances) {
    for (const word of utterance.words) {
      const text = word.word.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
      if (!text) continue;
      if (word.errorType === "Mispronunciation"
        || (typeof word.accuracy === "number" && word.accuracy < PRACTICE_THRESHOLD)) practice.add(text);
    }
  }
  return {
    parts: parts.length,
    utterances: utterances.length,
    accuracy: weightedMean(utterances, (utterance) => utterance.accuracy),
    fluency: weightedMean(utterances, (utterance) => utterance.fluency),
    wordsToPractice: [...practice].slice(0, MAX_PRACTICE_WORDS),
  };
}

export type PronunciationCheckStep = "loading" | "preparing" | "uploading" | "assessing";

export interface AssessRecordingDependencies {
  loadRecording: (attemptId: string) => Promise<{ available: boolean; segments: string[] }>;
  fetchAudio: (url: string, signal?: AbortSignal) => Promise<Blob>;
  /** Returns the saved file as WAV for assessment: the whole file as one WAV. */
  convert: (audio: Blob) => Promise<Blob[]>;
  assessPart: (attemptId: string, wav: Blob, options: { signal?: AbortSignal; onAssessing?: () => void }) => Promise<PronunciationPartResult>;
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
 * Assesses an English reading's whole saved recording. A recording saved as one
 * file (every M5 reading since the continuous recorder) is one WAV and one
 * Azure session; older readings saved as several files send one per file, in
 * recorder order. Any failure or cancellation rejects with no summary. Speech
 * Azure could not assess is reported in `complete` and `unassessedSeconds`, so
 * the result is never presented as covering the whole reading when it does not.
 */
export async function assessRecordingPronunciation(
  attemptId: string,
  { loadRecording, fetchAudio, convert, assessPart, signal, onStep }: AssessRecordingDependencies,
): Promise<PronunciationSummary> {
  onStep?.("loading");
  const recording = await loadRecording(attemptId);
  if (!recording.available || recording.segments.length === 0) throw new PronunciationUnavailableError();
  const parts: PronunciationPartResult[] = [];
  let assessedSeconds = 0;
  let unassessedSeconds: number | null = 0;
  for (const url of recording.segments) {
    const audio = await fetchAudio(url, signal);
    onStep?.("preparing");
    for (const wav of await convert(audio)) {
      if (signal?.aborted) throw new PronunciationIncompleteError();
      onStep?.("uploading");
      const result = await assessPart(attemptId, wav, { signal, onAssessing: () => onStep?.("assessing") });
      if (result.complete === false) {
        unassessedSeconds = unassessedSeconds === null || typeof result.unassessedSeconds !== "number"
          ? null : unassessedSeconds + result.unassessedSeconds;
      }
      assessedSeconds += result.durationSeconds ?? Math.max(0, wav.size - 44) / 32000;
      parts.push(result);
    }
  }
  return {
    ...summarizePronunciation(parts),
    assessedSeconds: Math.round(assessedSeconds),
    complete: parts.every((part) => part.complete !== false),
    unassessedSeconds: unassessedSeconds === null ? null : Math.round(unassessedSeconds),
  };
}
