// Pure rules for the read-aloud story box. VISUAL ONLY: nothing here affects
// the saved recording or scoring, which always use the recorder's audio.
export { tokenizePassageParagraphs } from "../../modules/module2/services/liveReadingAlignment.ts";

/** Live recognition counts as lost after this long without new recognized words. */
export const LIVE_SILENCE_MS = 6000;
/** Pace used when live recognition is unavailable (a slow Grade 5 oral reading pace). */
export const FALLBACK_WORDS_PER_MINUTE = 80;
/** Matches LiveReadingTracker's forward window per spoken word. */
export const LIVE_MATCH_WINDOW = 6;
/** Length of the short glide when the text moves up. */
export const STORY_GLIDE_MS = 350;

/** Whole lines that fit in the viewport; a partly visible line never counts. */
export function linesPerPage(viewportHeight: number, lineHeight: number) {
  if (!(lineHeight > 0)) return 1;
  return Math.max(1, Math.floor((viewportHeight + 0.5) / lineHeight));
}

/** Number of laid-out lines in the text block. */
export function totalLines(contentHeight: number, lineHeight: number) {
  if (!(lineHeight > 0)) return 1;
  return Math.max(1, Math.round(contentHeight / lineHeight));
}

/** Top line of the last page: the last page simply stays. */
export function lastPageStart(lineCount: number, pageLines: number) {
  return Math.max(0, lineCount - pageLines);
}

/** Line of a word, from the vertical middle of its box measured from the text top. */
export function lineForOffset(middleY: number, lineHeight: number) {
  if (!(lineHeight > 0)) return 0;
  return Math.max(0, Math.floor(middleY / lineHeight));
}

/**
 * When the reading position reaches the start of the last fully visible line,
 * returns the new top line that makes that line the SECOND line of the box
 * (one read line stays above it). Returns null when the text should stay still.
 * Never moves backward and never past the last page.
 */
export function scrollTargetLine(
  position: number,
  wordLines: readonly number[],
  topLine: number,
  pageLines: number,
  lineCount: number,
) {
  if (position < 0 || !wordLines.length) return null;
  const currentLine = wordLines[Math.min(position, wordLines.length - 1)];
  const lastVisibleLine = topLine + pageLines - 1;
  if (currentLine < lastVisibleLine) return null;
  const target = Math.min(lastPageStart(lineCount, pageLines), Math.max(topLine, currentLine - 1));
  return target > topLine ? target : null;
}

/**
 * Forward-only voice position. A repeat or self-correction (a lower position)
 * keeps the last one, and a jump larger than the tracker can make for the newly
 * spoken words is ignored, so a misrecognition cannot fast-forward the text.
 */
export function acceptVoicePosition(last: number, candidate: number, newSpokenWords: number) {
  if (candidate <= last) return last;
  const allowed = LIVE_MATCH_WINDOW * Math.max(1, newSpokenWords);
  return candidate - last > allowed ? last : candidate;
}

/** Pace estimate: reading on at `wordsPerMinute` from the last known position. */
export function paceEstimate(
  lastPosition: number,
  lastPositionAt: number,
  now: number,
  wordCount: number,
  wordsPerMinute = FALLBACK_WORDS_PER_MINUTE,
) {
  if (wordCount <= 0) return -1;
  const read = Math.floor((Math.max(0, now - lastPositionAt) / 60_000) * wordsPerMinute);
  return Math.min(wordCount - 1, lastPosition + read);
}

/** Voice drives the text while it is connected and recently heard; otherwise the pace estimate does. */
export function usesVoice(now: number, lastHeardAt: number, liveFailed: boolean) {
  return !liveFailed && now - lastHeardAt < LIVE_SILENCE_MS;
}
