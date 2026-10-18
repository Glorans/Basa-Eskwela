import assert from "node:assert/strict";
import test from "node:test";
import { storyParagraphs } from "../src/pages/reading-activity/storyDisplay.ts";
import {
  FALLBACK_WORDS_PER_MINUTE,
  LIVE_MATCH_WINDOW,
  LIVE_SILENCE_MS,
  acceptVoicePosition,
  lastPageStart,
  lineForOffset,
  linesPerPage,
  paceEstimate,
  scrollTargetLine,
  tokenizePassageParagraphs,
  totalLines,
  usesVoice,
} from "../src/pages/reading-activity/voiceFollow.ts";

test("words map to the line their box sits on, and pages are whole lines", () => {
  assert.equal(lineForOffset(22.8, 45.6), 0);
  assert.equal(lineForOffset(45.6 * 3 + 20, 45.6), 3);
  assert.equal(lineForOffset(-3, 45.6), 0);
  assert.equal(linesPerPage(182.4, 45.6), 4);
  assert.equal(linesPerPage(200, 45.6), 4); // a partly visible fifth line never counts
  assert.equal(totalLines(456, 45.6), 10);
  assert.equal(lastPageStart(10, 4), 6);
  assert.equal(lastPageStart(3, 4), 0); // the story fits
});

// Lines 0-9 with three words each: word w sits on line floor(w / 3).
const wordLines = Array.from({ length: 30 }, (_, word) => Math.floor(word / 3));

test("text stays still inside the visible lines and moves when the last visible line starts", () => {
  // Box shows lines 0-3. Words 0-8 are on lines 0-2: no movement.
  for (let position = -1; position <= 8; position++) assert.equal(scrollTargetLine(position, wordLines, 0, 4, 10), null);
  // Word 9 starts line 3, the last visible line: it becomes the second line (top = 2).
  assert.equal(scrollTargetLine(9, wordLines, 0, 4, 10), 2);
  // Showing lines 2-5, the next move waits for line 5.
  assert.equal(scrollTargetLine(14, wordLines, 2, 4, 10), null);
  assert.equal(scrollTargetLine(15, wordLines, 2, 4, 10), 4);
});

test("text never moves backward or past the last page", () => {
  assert.equal(scrollTargetLine(3, wordLines, 4, 4, 10), null);
  assert.equal(scrollTargetLine(29, wordLines, 4, 4, 10), 6); // clamps to the last page (lines 6-9)
  assert.equal(scrollTargetLine(29, wordLines, 6, 4, 10), null); // the last page stays
});

test("voice position is forward only and ignores jumps beyond the tracker window", () => {
  assert.equal(LIVE_MATCH_WINDOW, 6);
  assert.equal(acceptVoicePosition(10, 12, 1), 12);
  assert.equal(acceptVoicePosition(10, 8, 2), 10); // repeat or self-correction: no backward move
  assert.equal(acceptVoicePosition(10, 30, 1), 10); // misrecognized far jump is ignored
  assert.equal(acceptVoicePosition(10, 30, 4), 30); // many new words can move further
  assert.equal(acceptVoicePosition(-1, 3, 1), 3);
});

test("silence or a lost connection switches to the pace estimate and recovery returns to the voice", () => {
  assert.equal(LIVE_SILENCE_MS, 6000);
  assert.equal(FALLBACK_WORDS_PER_MINUTE, 80);
  assert.equal(usesVoice(5_999, 0, false), true);
  assert.equal(usesVoice(6_000, 0, false), false); // no words for 6 s
  assert.equal(usesVoice(1_000, 0, true), false); // connection lost
  assert.equal(usesVoice(20_000, 18_000, false), true); // words heard again
  // 80 wpm from the last known word: 45 s later the child is about 60 words on.
  assert.equal(paceEstimate(9, 0, 45_000, 200), 69);
  assert.equal(paceEstimate(-1, 0, 6_000, 200), 7); // nothing recognized: pace from the start
  assert.equal(paceEstimate(190, 0, 60_000, 200), 199); // never past the last word
  assert.equal(paceEstimate(5, 1_000, 500, 200), 5);
});

test("rendered word indexes cover every displayed word in order", () => {
  const paragraphs = storyParagraphs("A Helping Hand\nEvery Saturday, Lia's lola sweeps.\n\nMag-aaral siya.", "A Helping Hand");
  const words = tokenizePassageParagraphs(paragraphs).flat().flatMap((token) => token.type === "word" ? [token] : []);
  assert.deepEqual(words.map((word) => word.text), ["Every", "Saturday", "Lia's", "lola", "sweeps", "Mag", "aaral", "siya"]);
  assert.deepEqual(words.map((word) => word.wordIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
});
