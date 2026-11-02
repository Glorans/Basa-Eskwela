// Detects whether reading-material text is predominantly English or Filipino.
// Local and deterministic: it counts very common function words of each language,
// so it needs no model download or paid API. Uncertain text is never defaulted to
// English; the teacher must choose the language before saving.

// Words that are frequent in one language and rare in the other. Ambiguous words
// such as "at" (English "at", Filipino "and"), "may", "a" and "pa" are left out.
const FILIPINO_MARKERS = new Set([
  "ang", "ng", "mga", "sa", "na", "ay", "si", "ni", "kay", "sina", "nina",
  "ko", "mo", "niya", "siya", "ito", "iyon", "iyan", "nito", "niyon", "hindi",
  "para", "kung", "din", "rin", "lang", "lamang", "po", "opo", "nang", "naman",
  "kanyang", "kaniyang", "kami", "tayo", "sila", "nila", "natin", "ating", "atin",
  "namin", "amin", "ako", "ikaw", "kayo", "mayroon", "wala", "dahil", "pero",
  "ngunit", "subalit", "kaya", "upang", "bawat", "isang", "kanila", "kanilang",
  "iyong", "aking", "akin", "doon", "dito", "roon", "rito", "tulad", "gaya",
  "kapag", "habang", "noong", "saan", "ano", "sino", "bakit", "paano", "kailan",
  "lahat", "marami", "maraming", "sapagkat", "tungkol", "ayon", "siyang", "inyong", "kaniya", "kanya", "mula", "hanggang", "bago", "pagkatapos",
]);

const ENGLISH_MARKERS = new Set([
  "the", "and", "of", "to", "is", "in", "it", "was", "he", "she", "they",
  "that", "with", "for", "on", "are", "as", "his", "her", "their", "this",
  "these", "those", "have", "has", "had", "be", "been", "were", "will", "would",
  "can", "could", "not", "but", "from", "by", "an", "or", "we", "you", "my",
  "your", "our", "them", "him", "there", "what", "when", "where", "who", "why",
  "how", "which", "do", "does", "did", "so", "if", "then", "than", "into",
  "about", "after", "before", "because", "very", "all", "some", "said", "went",
  "its", "also", "each", "every", "other", "many", "much", "should",
]);

// At least this many marker words are needed before any result is called certain.
const MIN_MARKERS = 4;
// The leading language must hold at least this share of all marker words.
const CERTAIN_SHARE = 0.75;

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFC")
    .split(/[^a-zñ]+/u)
    .filter(Boolean);
}

/**
 * Returns { language, certain, reason, suggestedLanguage, scores }.
 * language is "en" or "fil" only when certain; otherwise null so nothing silently
 * defaults to English. suggestedLanguage is a hint for the teacher, never saved.
 */
function detectMaterialLanguage(text) {
  let english = 0;
  let filipino = 0;

  for (const token of tokenize(text)) {
    if (FILIPINO_MARKERS.has(token)) filipino += 1;
    else if (ENGLISH_MARKERS.has(token)) english += 1;
  }

  const total = english + filipino;
  const scores = { en: english, fil: filipino };
  // A single stray word (often OCR noise) is too weak even for a hint.
  const leading = Math.max(english, filipino) < 2
    ? null
    : filipino > english ? "fil" : english > filipino ? "en" : null;

  if (total < MIN_MARKERS) {
    return { language: null, certain: false, reason: total ? "too_short" : "no_signal", suggestedLanguage: leading, scores };
  }

  const share = Math.max(english, filipino) / total;
  if (leading && share >= CERTAIN_SHARE) {
    return { language: leading, certain: true, reason: "clear", suggestedLanguage: leading, scores };
  }

  return { language: null, certain: false, reason: "mixed", suggestedLanguage: leading, scores };
}

module.exports = {
  CERTAIN_SHARE,
  MIN_MARKERS,
  detectMaterialLanguage,
};
