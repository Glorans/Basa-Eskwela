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

export interface AssessRecordingDependencies {
  loadRecording: (attemptId: string) => Promise<{ available: boolean; segments: string[] }>;
  fetchAudio: (url: string) => Promise<Blob>;
  convert: (audio: Blob) => Promise<Blob>;
  assessPart: (attemptId: string, wav: Blob) => Promise<PronunciationPartResult>;
}

export class PronunciationUnavailableError extends Error {
  constructor(message = "There is no saved recording to check yet.") {
    super(message);
    this.name = "PronunciationUnavailableError";
  }
}

/** Assesses every saved part of an English reading, in recorder order. */
export async function assessRecordingPronunciation(
  attemptId: string,
  { loadRecording, fetchAudio, convert, assessPart }: AssessRecordingDependencies,
): Promise<PronunciationSummary> {
  const recording = await loadRecording(attemptId);
  if (!recording.available || recording.segments.length === 0) throw new PronunciationUnavailableError();
  const parts: PronunciationPartResult[] = [];
  for (const url of recording.segments) {
    const wav = await convert(await fetchAudio(url));
    parts.push(await assessPart(attemptId, wav));
  }
  return summarizePronunciation(parts);
}
