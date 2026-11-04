// Display-only word placement for the M5 result panels (F3, F4 and F5).
//
// Nothing here scores a reading or changes a saved result. It places saved
// words in the story text the learner was shown, and it only marks a word when
// the placement can be checked exactly. Whenever the saved data and the text
// do not line up word for word, it returns no marks instead of guessing.
//
// Limits of the saved data, which this module respects:
//  - The saved pronunciation check keeps a list of distinct practice words.
//    Newer servers also say where each was flagged (practiceOccurrences, from
//    the saved detailed results); a position is used only after checking that
//    the story has that exact word there. Without positions, a word is placed
//    only if it appears once in the story: a repeated word ("Santos" twice) is
//    never guessed onto one of its occurrences.
//  - Saved recordings have no word timestamps, so no word can be clipped from
//    the learner's audio.
//  - Transcript word metrics are an alignment of the story and the transcript.
//    They show which words matched, were different, or were not heard; they
//    are not a pronunciation check.
import { getReadingWords } from "../../module2/services/diagnosticScoring.ts";
import type { DiagnosticLanguage } from "../../module2/types/diagnostic.ts";
import { storyParagraphs } from "../../../pages/reading-activity/storyDisplay.ts";
import type { OralReadingWordMetric } from "../types/oralReading.ts";
import { practiceWordKey, type PracticeOccurrence } from "./pronunciationSummary.ts";

/** One run of text; at most one flag is set. */
export interface TextPiece {
  text: string;
  /** F3/F4: a word the pronunciation check flagged for practice. */
  practice?: boolean;
  /** F5 story: a story word that was not heard. */
  skipped?: boolean;
  /** F5 transcript: a heard word that is different from the story. */
  differs?: boolean;
  /** F5 transcript: the story word(s) in its place, when the alignment shows them. */
  expected?: string[];
}

interface StoryToken {
  /** Leading punctuation, the word itself, trailing punctuation. */
  lead: string;
  core: string;
  trail: string;
  /** Normalized words, exactly as the scorer splits this token. */
  words: string[];
  key: string;
  index: number;
  sentence: number;
}

type StoryItem = StoryToken | string;

// M5 treats "missus" as "mrs" (normalizeOralReadingAbbreviations); compare both the same way.
const canonical = (word: string, language: DiagnosticLanguage) => (language === "en" && word === "missus" ? "mrs" : word);

function tokenWords(text: string, language: DiagnosticLanguage) {
  return getReadingWords(text, language).map((word) => canonical(word, language));
}

const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;
// Titles such as "Mrs." end with a full stop but never end a sentence.
const ABBREVIATION = /^(mr|mrs|ms|dr|st|jr|sr|sir|prof)\.$/i;

/** The story as shown on the read-aloud screen (embedded title removed), split into tokens. */
function layoutStory(passage: string, title: string, language: DiagnosticLanguage) {
  const paragraphs: StoryItem[][] = [];
  const tokens: StoryToken[] = [];
  let sentence = 0;
  for (const paragraph of storyParagraphs(passage, title)) {
    const items: StoryItem[] = [];
    for (const part of paragraph.split(/(\s+)/)) {
      if (!part) continue;
      if (!part.trim()) { items.push(part); continue; }
      const match = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(part);
      const [lead, core, trail] = match && match[2] ? [match[1], match[2], match[3]] : ["", part, ""];
      const token: StoryToken = {
        lead, core, trail, words: tokenWords(part, language), key: practiceWordKey(part),
        index: tokens.length, sentence,
      };
      tokens.push(token);
      items.push(token);
      if (SENTENCE_END.test(part) && !ABBREVIATION.test(part)) sentence += 1;
    }
    paragraphs.push(items);
    sentence += 1;
  }
  return { paragraphs, tokens };
}

function tokenPieces(token: StoryToken, flag: Partial<TextPiece> | null): TextPiece[] {
  if (!flag) return [{ text: token.lead + token.core + token.trail }];
  return [
    ...(token.lead ? [{ text: token.lead }] : []),
    { text: token.core, ...flag },
    ...(token.trail ? [{ text: token.trail }] : []),
  ];
}

/** Joins neighbouring unflagged pieces so React renders fewer nodes. */
function compact(pieces: TextPiece[]) {
  const result: TextPiece[] = [];
  for (const piece of pieces) {
    const last = result[result.length - 1];
    const plain = (value: TextPiece) => !value.practice && !value.skipped && !value.differs;
    if (last && plain(last) && plain(piece)) last.text += piece.text;
    else result.push({ ...piece });
  }
  return result;
}

/**
 * F5 "The Story": story paragraphs with the words that were not heard marked.
 * Returns null unless every story word lines up exactly with the saved word
 * metrics, so a word is never marked as not heard by guesswork.
 */
export function markStory(
  passage: string,
  title: string,
  language: DiagnosticLanguage,
  metrics: readonly OralReadingWordMetric[],
): TextPiece[][] | null {
  if (!passage.trim()) return null;
  const expected = metrics.filter((metric) => metric.type !== "insertion");
  if (expected.some((metric) => typeof metric.expected !== "string")) return null;
  const { paragraphs, tokens } = layoutStory(passage, title, language);
  let cursor = 0;
  const skipped = new Set<number>();
  for (const token of tokens) {
    for (const word of token.words) {
      const metric = expected[cursor++];
      if (!metric || canonical(metric.expected as string, language) !== word) return null;
      if (metric.type === "omission") skipped.add(token.index);
    }
  }
  if (cursor !== expected.length) return null;
  return paragraphs.map((items) => compact(items.flatMap((item) => (typeof item === "string"
    ? [{ text: item }]
    : tokenPieces(item, skipped.has(item.index) ? { skipped: true } : null)))));
}

/**
 * F5 "What We Heard": transcript words that are different from the story.
 * When the saved metrics line up exactly with the transcript (reliable), each
 * different word also carries the story word(s) in its place; an extra word
 * carries none. Otherwise only words that were never matched are highlighted,
 * with no story word attached.
 */
export function markTranscript(
  transcript: string,
  metrics: readonly OralReadingWordMetric[],
  language: DiagnosticLanguage,
): { pieces: TextPiece[]; reliable: boolean } {
  const parts = transcript.split(/(\s+)/).filter(Boolean);
  const heard = metrics.filter((metric) => metric.actual !== null);
  const aligned: TextPiece[] = [];
  let cursor = 0;
  let reliable = heard.every((metric) => typeof metric.actual === "string");
  for (const text of parts) {
    if (!reliable) break;
    const words = text.trim() ? tokenWords(text, language) : [];
    if (!words.length) { aligned.push({ text }); continue; }
    // The scorer may split one heard token into two story words ("sunflower" ->
    // "sun flower"); the joined letters must still be identical.
    const target = words.join("");
    let joined = "";
    const used: OralReadingWordMetric[] = [];
    while (joined.length < target.length && cursor < heard.length) {
      const metric = heard[cursor++];
      used.push(metric);
      joined += canonical(metric.actual as string, language);
    }
    if (joined !== target) { reliable = false; break; }
    const differs = used.some((metric) => metric.type !== "match");
    const expected = used.filter((metric) => metric.type === "substitution" && metric.expected).map((metric) => metric.expected as string);
    aligned.push(differs ? { text, differs, expected } : { text });
  }
  if (reliable && cursor === heard.length) return { pieces: compact(aligned), reliable: true };

  // Fallback (older or unusual results): a word is highlighted only if it was
  // never heard as a matching word anywhere in the reading.
  const matched = new Set(heard.filter((metric) => metric.type === "match").map((metric) => canonical(metric.actual ?? "", language)));
  const different = new Set(heard.filter((metric) => metric.type !== "match").map((metric) => canonical(metric.actual ?? "", language)));
  return {
    reliable: false,
    pieces: compact(parts.map((text) => {
      const words = text.trim() ? tokenWords(text, language) : [];
      const differs = words.length > 0 && words.every((word) => different.has(word) && !matched.has(word));
      return differs ? { text, differs } : { text };
    })),
  };
}

export interface PracticeWordPlacement {
  key: string;
  /** The story's own spelling when the word was placed, otherwise the saved word. */
  word: string;
  /** The sentence (or part of it) around the word's first placed occurrence, with the word marked. */
  excerpt: TextPiece[] | null;
  /** Token index of the first placed occurrence; null when the word could not be placed reliably. */
  position: number | null;
  sentence: number | null;
  /** Token indices of every placed occurrence (F3 marks each one). */
  positions: number[];
}

const EXCERPT_LIMIT = 16;
const EXCERPT_CONTEXT = 6;

function excerptPieces(tokens: StoryToken[], marked: Set<number>): TextPiece[] {
  const sentence = tokens;
  let start = 0;
  let end = sentence.length;
  if (sentence.length > EXCERPT_LIMIT) {
    const positions = sentence.map((token, index) => (marked.has(token.index) ? index : -1)).filter((index) => index >= 0);
    start = Math.max(0, Math.min(...positions) - EXCERPT_CONTEXT);
    end = Math.min(sentence.length, Math.max(...positions) + EXCERPT_CONTEXT + 1);
  }
  const pieces: TextPiece[] = start > 0 ? [{ text: "… " }] : [];
  sentence.slice(start, end).forEach((token, index) => {
    if (index > 0) pieces.push({ text: " " });
    pieces.push(...tokenPieces(token, marked.has(token.index) ? { practice: true } : null));
  });
  if (end < sentence.length) pieces.push({ text: " …" });
  return compact(pieces);
}

/**
 * F4: each distinct practice word once, in story order, with the story's
 * spelling and a short excerpt where it was flagged.
 *
 * With `occurrences` (newer servers), each word is placed where the check
 * flagged it, after confirming the story has that exact word at that position.
 * Without them, a word is placed only if it appears exactly once in the story.
 * A word that cannot be placed keeps its saved spelling, has no excerpt and is
 * listed last; nothing is guessed.
 */
export function placePracticeWords(
  words: readonly string[], passage: string, title: string, occurrences?: readonly PracticeOccurrence[],
): PracticeWordPlacement[] {
  const { tokens } = passage.trim() ? layoutStory(passage, title, "en") : { tokens: [] as StoryToken[] };
  const bySentence = new Map<number, StoryToken[]>();
  for (const token of tokens) bySentence.set(token.sentence, [...(bySentence.get(token.sentence) ?? []), token]);
  // Story word index (as the server counts them: title excluded) -> its token.
  const byStoryWord: { token: StoryToken; word: string }[] = [];
  for (const token of tokens) for (const word of token.words) byStoryWord.push({ token, word });
  const tokensByKey = new Map<string, StoryToken[]>();
  for (const token of tokens) if (token.key) tokensByKey.set(token.key, [...(tokensByKey.get(token.key) ?? []), token]);

  const positionsFor = (key: string): StoryToken[] => {
    if (occurrences) {
      const placed = occurrences.filter((occurrence) => {
        const at = byStoryWord[occurrence.storyWordIndex];
        return practiceWordKey(occurrence.word) === key && at !== undefined && at.word === occurrence.word && at.token.key === key;
      }).map((occurrence) => byStoryWord[occurrence.storyWordIndex].token);
      return [...new Set(placed)].sort((a, b) => a.index - b.index);
    }
    const found = tokensByKey.get(key) ?? [];
    return found.length === 1 ? found : [];
  };

  const seen = new Set<string>();
  const placed: PracticeWordPlacement[] = [];
  for (const saved of words) {
    const key = practiceWordKey(saved);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const found = positionsFor(key);
    const first = found[0];
    placed.push(first
      ? { key, word: first.core, position: first.index, sentence: first.sentence, positions: found.map((token) => token.index),
        excerpt: excerptPieces(bySentence.get(first.sentence) ?? [first], new Set([first.index])) }
      : { key, word: saved, position: null, sentence: null, positions: [], excerpt: null });
  }
  return placed.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}

/**
 * F3: a short story excerpt (at most `maxSentences` sentences) with every
 * placed practice word in those sentences marked, in story order.
 */
export function practiceExcerpt(placed: readonly PracticeWordPlacement[], passage: string, title: string, maxSentences = 2): TextPiece[][] {
  const { tokens } = passage.trim() ? layoutStory(passage, title, "en") : { tokens: [] as StoryToken[] };
  const marked = new Set(placed.flatMap((word) => word.positions));
  const sentences = [...new Set(tokens.filter((token) => marked.has(token.index)).map((token) => token.sentence))]
    .sort((a, b) => a - b).slice(0, maxSentences);
  return sentences.map((sentence) => excerptPieces(tokens.filter((token) => token.sentence === sentence), marked));
}

// Capitalized words that are not names, or are recognized well without help.
const NOT_NAMES = new Set(["i", "mr", "mrs", "ms", "dr", "sir", "miss", "st", "jr", "sr", "prof",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);
const NAME = /^\p{Lu}[\p{L}'’-]{1,29}$/u;
export const MAX_STORY_NAMES = 10;

/**
 * English stories only: names to help speech-to-text recognize them (for
 * example "Santos", which was heard as "Sampson's"). Conservative on purpose,
 * because a phrase list biases recognition: only capitalized words that appear
 * after the start of a sentence and never in lower case elsewhere in the story,
 * at most MAX_STORY_NAMES. Ordinary story words are never sent, so the
 * recognizer is not pushed to hear the story it expects.
 */
export function storyNames(passage: string, title: string, language: DiagnosticLanguage): string[] {
  if (language !== "en" || !passage.trim()) return [];
  const { tokens } = layoutStory(passage, title, language);
  const lowercase = new Set(tokens.filter((token) => /^\p{Ll}/u.test(token.core)).map((token) => token.key));
  const names: string[] = [];
  tokens.forEach((token, index) => {
    const startsSentence = index === 0 || tokens[index - 1].sentence !== token.sentence;
    if (startsSentence || !NAME.test(token.core) || NOT_NAMES.has(token.key) || lowercase.has(token.key)) return;
    if (!names.includes(token.core) && names.length < MAX_STORY_NAMES) names.push(token.core);
  });
  return names;
}
