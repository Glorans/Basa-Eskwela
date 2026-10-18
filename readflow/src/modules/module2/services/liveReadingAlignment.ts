import { getReadingWords, normalizeReadingText } from "./diagnosticScoring.ts";

type LivePassageToken =
  | {
      type: "word";
      text: string;
      normalized: string;
      wordIndex: number;
    }
  | {
      type: "separator";
      text: string;
    };

interface LiveReadingAlignment {
  matchedWordIndexes: number[];
  currentWordIndex: number | null;
}

const RENDERABLE_WORD_PATTERN =
  /[\p{L}\p{N}]+(?:['’‘ʼ´`][\p{L}\p{N}]+)*/gu;

/**
 * Splits passage paragraphs into renderable words and untouched separators.
 * Word indexes continue across paragraphs so live matches cannot jump to an
 * unrelated occurrence of the same word.
 */
export function tokenizePassageParagraphs(
  paragraphs: readonly string[],
): LivePassageToken[][] {
  let nextWordIndex = 0;

  return paragraphs.map((paragraph) => {
    const tokens: LivePassageToken[] = [];
    let previousEnd = 0;

    for (const match of paragraph.matchAll(RENDERABLE_WORD_PATTERN)) {
      const start = match.index;
      const text = match[0];

      if (start > previousEnd) {
        tokens.push({
          type: "separator",
          text: paragraph.slice(previousEnd, start),
        });
      }

      tokens.push({
        type: "word",
        text,
        normalized: normalizeReadingText(text),
        wordIndex: nextWordIndex,
      });
      nextWordIndex += 1;
      previousEnd = start + text.length;
    }

    if (previousEnd < paragraph.length) {
      tokens.push({
        type: "separator",
        text: paragraph.slice(previousEnd),
      });
    }

    return tokens;
  });
}

interface LiveReadingProgress {
  /** Persistent display trail, including provisional matches; never scoring input. */
  visualReadWordIndexes: number[];
  recognizedWordIndexes: number[];
  bridgedVisualWordIndexes: number[];
  confirmedCursor: number;
  previewCursor: number;
}

/** Visual-only, bounded matching. Scoring always receives the actual transcript. */
export class LiveReadingTracker {
  private expected: string[];
  private confirmedWords: string[] = [];
  private recognized = new Set<number>();
  private visualRead = new Set<number>();
  private bridged = new Set<number>();
  private cursor = -1;
  private preview = -1;

  constructor(expectedText: string) {
    this.expected = getReadingWords(expectedText);
  }

  reset() {
    this.confirmedWords = [];
    this.recognized.clear();
    this.visualRead.clear();
    this.bridged.clear();
    this.cursor = this.preview = -1;
  }

  private advance(words: string[], cursor: number, confirmed: boolean) {
    for (let spoken = 0; spoken < words.length; spoken += 1) {
      const start = cursor + 1;
      const end = Math.min(start + 6, this.expected.length);
      let match = -1;
      for (let index = start; index < end; index += 1) {
        if (this.expected[index] !== words[spoken]) continue;
        // A spoken repetition must not jump to another occurrence ahead.
        if (index > start && words[spoken] === this.expected[cursor]
          && words[spoken + 1] !== this.expected[index + 1]) continue;
        match = index;
        break;
      }
      if (match < 0) continue; // Insertion/substitution: wait for a nearby anchor.
      this.visualRead.add(match);
      if (confirmed) {
        for (let index = start; index < match; index += 1) this.bridged.add(index);
        this.recognized.add(match);
      }
      cursor = match;
    }
    return cursor;
  }

  update(confirmedTranscript: string, interimTranscript = ""): LiveReadingProgress {
    const words = getReadingWords(confirmedTranscript);
    // Finals are append-only. A stale/revised callback cannot undo confirmation.
    const extendsFinals = words.length >= this.confirmedWords.length
      && this.confirmedWords.every((word, index) => words[index] === word);
    if (extendsFinals) {
      this.cursor = this.advance(words.slice(this.confirmedWords.length), this.cursor, true);
      this.confirmedWords = words;
    }
    this.preview = Math.max(this.preview, this.cursor,
      this.advance(getReadingWords(interimTranscript), this.cursor, false));
    return {
      visualReadWordIndexes: [...this.visualRead].sort((a, b) => a - b),
      recognizedWordIndexes: [...this.recognized],
      bridgedVisualWordIndexes: [...this.bridged],
      confirmedCursor: this.cursor,
      previewCursor: this.preview,
    };
  }
}

export function alignLiveReadingWords(expectedText: string, transcript: string): LiveReadingAlignment {
  const progress = new LiveReadingTracker(expectedText).update(transcript);
  return {
    matchedWordIndexes: progress.recognizedWordIndexes,
    currentWordIndex: progress.confirmedCursor < 0 ? null : progress.confirmedCursor,
  };
}
