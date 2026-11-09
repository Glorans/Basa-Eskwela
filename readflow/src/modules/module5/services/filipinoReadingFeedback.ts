// Filipino F2, F3, F4 and F7 content, built only from one saved attempt. Display
// only: it never scores, saves or calls a speech service, and it uses the same
// saved values as F5 and F6. A difference here is the story compared with what
// the recognizer wrote. It is not a pronunciation finding, and the recognizer can
// be wrong, so nothing here says how a word was pronounced.
import type { ActivityText } from "../../../pages/reading-activity/activityLanguage.ts";
import type { OralReadingAttempt } from "../types/oralReading.ts";
import { placeStoryWords, readingAccuracyMessage, type TextPiece } from "./resultWords.ts";

/** F2 names only a few words to start with; F4 has the full list. */
export const MAX_START_WORDS = 3;
const LOW_MATCH_SHARE = 0.5;
const UNHEARD_ENDING_WORDS = 3;

export type FilipinoFeedbackAttempt = Pick<OralReadingAttempt,
  "wordMetrics" | "expectedWordCount" | "pronunciationAccuracy" | "readingSpeedWpm" | "transcript" | "passageSnapshot" | "passageTitle" | "moduleTitle" | "scoringVersion">;

/** F3: the saved F6 values. Nothing is recalculated. */
export type FilipinoReadingStats =
  | { status: "unavailable" }
  | {
    status: "ready";
    accuracy: number;
    total: number;
    /** null when the saved word alignment is missing: F3 does not claim "0 matched". */
    matched: number | null;
    differenceCount: number | null;
    /** Only attempts saved under the current scoring rule get its explanation. */
    currentScoringRule: boolean;
  };

export function filipinoReadingStats(attempt: FilipinoFeedbackAttempt): FilipinoReadingStats {
  if (!Number.isFinite(attempt.pronunciationAccuracy) || !(attempt.expectedWordCount > 0)) return { status: "unavailable" };
  const metrics = Array.isArray(attempt.wordMetrics) ? attempt.wordMetrics : [];
  return {
    status: "ready",
    accuracy: Math.round(attempt.pronunciationAccuracy),
    total: attempt.expectedWordCount,
    matched: metrics.length ? metrics.filter((metric) => metric.type === "match").length : null,
    differenceCount: metrics.length ? metrics.filter((metric) => metric.type !== "match").length : null,
    currentScoringRule: attempt.scoringVersion === 2,
  };
}

/** F4: one saved difference, in reading order. Repeated words keep one row per occurrence. */
export interface ReadingDifference {
  kind: "different" | "skipped" | "extra";
  /** The story's own spelling when the saved alignment lines up with the story. */
  story: string | null;
  heard: string | null;
  /** The sentence around this occurrence, with it marked. An extra word marks nothing. Null when it cannot be placed. */
  context: TextPiece[] | null;
}

export type FilipinoFeedback =
  | { status: "unavailable" }
  | {
    status: "ready";
    summary: ActivityText;
    counts: { different: number; skipped: number; extra: number };
    differences: ReadingDifference[];
    /** F2: the first few different or unheard story words, once each, in story order. */
    startWords: string[];
    /** A digit stands where a story word was: possibly the recognizer's spelling of a number. */
    digitDifference: boolean;
    tip: ActivityText;
  };

const isDigits = (word: string | null) => word !== null && /^\p{N}+$/u.test(word);
const plainText = (pieces: TextPiece[]): TextPiece[] => [{ text: pieces.map((piece) => piece.text).join("") }];

function chooseTip(
  metrics: FilipinoFeedbackAttempt["wordMetrics"],
  matched: number,
  total: number,
  counts: { different: number; skipped: number; extra: number },
  everyWordMatched: boolean,
): ActivityText {
  if (everyWordMatched) {
    return "Every story word matched what the computer heard. Read the story again to build your speed, or try a new story when you are ready.";
  }
  // Story words not heard at the very end, ignoring extra words after them.
  let unheardEnding = 0;
  for (let index = metrics.length - 1; index >= 0 && metrics[index].type !== "match" && metrics[index].type !== "substitution"; index -= 1) {
    if (metrics[index].type === "omission") unheardEnding += 1;
  }
  if (unheardEnding >= UNHEARD_ENDING_WORDS) {
    return "The last part of the story was not heard. Check whether the whole story was read before the recording stopped, then read that part again.";
  }
  if (matched / total < LOW_MATCH_SHARE) {
    return "Only some story words matched what the computer heard. Noise or a faraway microphone can cause this. If your recording is available, listen to it, then read one sentence at a time in a quiet place.";
  }
  if (counts.skipped > counts.different && counts.skipped >= counts.extra) {
    return "Some story words were not heard. Follow the story with your finger and read each word. If your recording is available, listen to it to check.";
  }
  if (counts.extra > counts.different) {
    return "The computer heard some extra words. Keep your eyes on the story and read in a quiet place, so that other sounds are not picked up.";
  }
  return "If your recording is available, listen for these words. If a word came out differently from the story, read its sentence again slowly. If you read it correctly, the computer may have heard it wrongly, so you can ask a teacher or an adult to listen.";
}

export function buildFilipinoFeedback(attempt: FilipinoFeedbackAttempt): FilipinoFeedback {
  const metrics = Array.isArray(attempt.wordMetrics) ? attempt.wordMetrics : [];
  if (!attempt.transcript?.trim() || metrics.length === 0 || !(attempt.expectedWordCount > 0) || !Number.isFinite(attempt.pronunciationAccuracy)) {
    return { status: "unavailable" };
  }
  const matched = metrics.filter((metric) => metric.type === "match").length;
  const total = attempt.expectedWordCount;
  // The same rule as F6, so F2 and F6 never disagree.
  const everyWordMatched = metrics.every((metric) => metric.type === "match") && matched === total;

  // Saved story words, in story order. null means the alignment does not line up, so nothing is placed.
  const placed = placeStoryWords(attempt.passageSnapshot ?? "", attempt.passageTitle || attempt.moduleTitle, "fil", metrics);
  const differences: ReadingDifference[] = [];
  const candidates: { key: string; word: string; digit: boolean; order: number }[] = [];
  let storyIndex = -1;
  for (const metric of metrics) {
    if (metric.type !== "insertion") storyIndex += 1;
    if (metric.type === "match") continue;
    if (metric.type === "insertion") {
      if (!metric.actual) continue;
      // An extra word has no story word of its own: show the sentence it was heard beside, unmarked.
      const near = placed?.[storyIndex + 1] ?? placed?.[storyIndex];
      differences.push({ kind: "extra", story: null, heard: metric.actual, context: near ? plainText(near.excerpt) : null });
      continue;
    }
    if (!metric.expected) continue;
    const place = placed?.[storyIndex];
    const word = place?.word ?? metric.expected;
    differences.push(metric.type === "omission"
      ? { kind: "skipped", story: word, heard: null, context: place?.excerpt ?? null }
      : { kind: "different", story: word, heard: metric.actual, context: place?.excerpt ?? null });
    const key = word.normalize("NFKC").toLocaleLowerCase();
    if (!candidates.some((candidate) => candidate.key === key)) candidates.push({ key, word, digit: isDigits(metric.actual), order: storyIndex });
  }
  const counts = {
    different: differences.filter((item) => item.kind === "different").length,
    skipped: differences.filter((item) => item.kind === "skipped").length,
    extra: differences.filter((item) => item.kind === "extra").length,
  };
  // A digit may only be how the recognizer writes a number, so those words are named last.
  const startWords = [...candidates.filter((word) => !word.digit), ...candidates.filter((word) => word.digit)]
    .slice(0, MAX_START_WORDS)
    .sort((first, second) => first.order - second.order)
    .map((word) => word.word);

  return {
    status: "ready",
    summary: readingAccuracyMessage(Math.round(attempt.pronunciationAccuracy), everyWordMatched),
    counts,
    differences,
    startWords,
    digitDifference: differences.some((item) => item.kind === "different" && isDigits(item.heard)),
    tip: chooseTip(metrics, matched, total, counts, everyWordMatched),
  };
}
