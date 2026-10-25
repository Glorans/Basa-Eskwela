// Supporting evidence for comprehension questions, as complete sentences copied
// from the reading passage. Text is never invented or reworded: a quote is only
// widened to the sentence(s) around it in the same passage, with line breaks
// shown as spaces. English and Filipino use the same sentence rules.

const MAX_EVIDENCE_LENGTH = 1000;
const TERMINATORS = new Set([".", "!", "?", "…"]);
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "»"]);
// A period after these words does not end a sentence ("Mrs. Santos", "Gng. Cruz").
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "jr", "sr", "st", "atty", "engr", "prof", "hon", "sto", "sta",
  "gng", "bb", // Filipino: Ginang, Binibini ("G." is caught as a single initial)
]);

const collapse = (text) => text.replace(/\s+/gu, " ").trim();

/**
 * Splits the passage into blocks that a sentence never crosses: paragraphs
 * (blank lines) and short heading lines with no punctuation, such as a title
 * above the first sentence (the rule the read-aloud screen uses for titles).
 */
function passageBlocks(passage) {
  const blocks = [];
  for (const paragraph of passage.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/)) {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    let current = [];
    lines.forEach((line, index) => {
      const next = lines[index + 1];
      const heading = next && line.split(/\s+/).length <= 8 && !/[.!?…:;,]/u.test(line)
        && /^["'“‘(]?[\p{Lu}\p{N}]/u.test(next);
      if (heading) {
        if (current.length) blocks.push(collapse(current.join(" ")));
        blocks.push(collapse(line));
        current = [];
      } else {
        current.push(line);
      }
    });
    if (current.length) blocks.push(collapse(current.join(" ")));
  }
  return blocks.filter(Boolean);
}

/** True when the period at `index` belongs to an abbreviation, an initial or a number. */
function isAbbreviation(text, index) {
  if (text[index] !== ".") return false;
  if (/\p{N}/u.test(text[index - 1] ?? "") && /\p{N}/u.test(text[index + 1] ?? "")) return true;
  const word = /[\p{L}]+$/u.exec(text.slice(0, index))?.[0] ?? "";
  if (!word) return false;
  return (word.length === 1 && /\p{Lu}/u.test(word)) || ABBREVIATIONS.has(word.toLocaleLowerCase());
}

/**
 * Index just after the sentence ending at or after `from` (terminators and
 * closing quotes included), or the block's end. A terminator only ends the
 * sentence when the next word does not continue it in lower case.
 */
function sentenceEnd(text, from) {
  for (let index = from; index < text.length; index += 1) {
    if (!TERMINATORS.has(text[index]) || isAbbreviation(text, index)) continue;
    let end = index + 1;
    while (end < text.length && (TERMINATORS.has(text[end]) || CLOSERS.has(text[end]))) end += 1;
    if (end >= text.length) return text.length;
    if (text[end] !== " ") continue;
    const nextWord = text.slice(end + 1);
    if (/^["'“‘(]?\p{Ll}/u.test(nextWord)) continue;
    return end;
  }
  return text.length;
}

/** Index where the sentence containing `at` starts. */
function sentenceStart(text, at) {
  let start = 0;
  for (let index = 0; index < at;) {
    const end = sentenceEnd(text, index);
    if (end >= at || end >= text.length) break;
    start = end + 1; // skip the space after the sentence
    index = start;
  }
  return start;
}

/** A quote that starts like a sentence and ends with sentence punctuation. */
function looksLikeCompleteSentences(text) {
  const quote = collapse(text);
  return /^["'“‘(]?[\p{Lu}\p{N}]/u.test(quote) && /[.!?…]["'”’)\]»]*$/u.test(quote);
}

/**
 * Returns the evidence widened to the complete sentence(s) that contain it,
 * copied from the passage. `reliable` is false when the quote is not found in
 * a single block exactly once (whitespace aside) or the sentence would be too
 * long; the original evidence is then returned unchanged.
 */
function completeEvidence(passage, evidence) {
  const quote = typeof evidence === "string" ? collapse(evidence) : "";
  if (!quote || typeof passage !== "string") return { text: evidence, reliable: false, changed: false };
  const found = [];
  for (const block of passageBlocks(passage)) {
    for (let index = block.indexOf(quote); index !== -1; index = block.indexOf(quote, index + 1)) {
      found.push({ block, index });
    }
  }
  if (found.length !== 1) return { text: evidence, reliable: false, changed: false };
  const { block, index } = found[0];
  const start = sentenceStart(block, index);
  const lastCharacter = index + quote.length - 1;
  const end = sentenceEnd(block, Math.max(start, lastCharacter));
  const text = block.slice(start, Math.max(end, index + quote.length)).trim();
  if (text.length > MAX_EVIDENCE_LENGTH) return { text: evidence, reliable: false, changed: false };
  return { text, reliable: true, changed: text !== quote };
}

/**
 * For display: complete sentences from the passage when the match is reliable;
 * otherwise exactly the stored evidence. Never adds text that is not in the passage.
 */
function displayEvidence(passage, evidence) {
  if (typeof evidence !== "string" || !evidence.trim()) return evidence ?? null;
  const completed = completeEvidence(passage, evidence);
  return completed.reliable ? completed.text : evidence;
}

/**
 * For new or edited question sets: the evidence as complete sentences, or an
 * `incomplete` result when it is a fragment that cannot be completed reliably.
 */
function checkEvidence(passage, evidence) {
  const completed = completeEvidence(passage, evidence);
  if (completed.reliable) return { evidence: completed.text, changed: completed.changed, incomplete: false };
  return { evidence, changed: false, incomplete: !looksLikeCompleteSentences(evidence) };
}

module.exports = { checkEvidence, completeEvidence, displayEvidence, looksLikeCompleteSentences, passageBlocks };
