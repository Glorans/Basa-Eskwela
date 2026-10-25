// English only: how speech recognition writes a spoken title it heard, mapped
// to the written abbreviation. Azure writes "Mrs." as "Missus" (or "Missis").
// "Misses" and "Miss" are real words with other meanings, so they are not mapped.
const SPOKEN_TITLES = Object.freeze({ mister: "mr", missus: "mrs", missis: "mrs" });

function normalizeReadingText(text, language = "en") {
  let normalized = text
    .normalize("NFKC")
    .replace(/[‘’‛ʼ`´]/g, "'")
    .toLowerCase();
  if (language === "en") {
    normalized = normalized.replace(
      /(^|[\s"'“”([{])1(?=$|[\s"'“”)\]}!?;]|[.,:](?!\p{N}))/gu,
      "$1one",
    );
  }
  normalized = normalized
    .replace(/'/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return language === "en"
    ? normalized.split(" ").map(word => SPOKEN_TITLES[word] ?? word).join(" ")
    : normalized;
}

function getReadingWords(text, language = "en") {
  const normalizedText = normalizeReadingText(text, language);
  return normalizedText ? normalizedText.split(" ") : [];
}

/**
 * Speech recognition sometimes writes two spoken words as one token, for
 * example "Mrs. Santos" as "Mississantos". A spoken token is split back into
 * two words only when it is exactly two consecutive passage words joined (the
 * first may be a spoken title form such as "missis"), and is not itself a word
 * of the passage. Nothing is fuzzy-matched: "Sandcost" stays "sandcost".
 */
function splitJoinedWords(expectedWords, spokenWords) {
  const passageWords = new Set(expectedWords);
  const spokenForms = Object.entries(SPOKEN_TITLES).reduce((forms, [spoken, written]) => {
    (forms[written] ??= [written]).push(spoken);
    return forms;
  }, {});
  const joined = new Map();
  for (let index = 0; index + 1 < expectedWords.length; index += 1) {
    const [first, second] = [expectedWords[index], expectedWords[index + 1]];
    for (const form of spokenForms[first] ?? [first]) {
      if (!passageWords.has(form + second)) joined.set(form + second, [first, second]);
    }
  }
  return spokenWords.flatMap((word) => (!passageWords.has(word) && joined.get(word)) || [word]);
}

function alignWords(expectedWords, spokenWords) {
  const costs = Array.from({ length: expectedWords.length + 1 }, () =>
    Array(spokenWords.length + 1).fill(0),
  );

  for (
    let expectedIndex = 0;
    expectedIndex <= expectedWords.length;
    expectedIndex += 1
  ) {
    costs[expectedIndex][0] = expectedIndex;
  }

  for (
    let spokenIndex = 0;
    spokenIndex <= spokenWords.length;
    spokenIndex += 1
  ) {
    costs[0][spokenIndex] = spokenIndex;
  }

  for (
    let expectedIndex = 1;
    expectedIndex <= expectedWords.length;
    expectedIndex += 1
  ) {
    for (
      let spokenIndex = 1;
      spokenIndex <= spokenWords.length;
      spokenIndex += 1
    ) {
      const substitutionCost =
        expectedWords[expectedIndex - 1] === spokenWords[spokenIndex - 1] ? 0 : 1;

      costs[expectedIndex][spokenIndex] = Math.min(
        costs[expectedIndex - 1][spokenIndex - 1] + substitutionCost,
        costs[expectedIndex - 1][spokenIndex] + 1,
        costs[expectedIndex][spokenIndex - 1] + 1,
      );
    }
  }

  const alignment = [];
  let expectedIndex = expectedWords.length;
  let spokenIndex = spokenWords.length;

  while (expectedIndex > 0 || spokenIndex > 0) {
    const expectedWord = expectedWords[expectedIndex - 1];
    const spokenWord = spokenWords[spokenIndex - 1];

    if (
      expectedIndex > 0 &&
      spokenIndex > 0 &&
      expectedWord === spokenWord &&
      costs[expectedIndex][spokenIndex] === costs[expectedIndex - 1][spokenIndex - 1]
    ) {
      alignment.push({ type: "match", expectedWord, spokenWord });
      expectedIndex -= 1;
      spokenIndex -= 1;
      continue;
    }

    if (
      expectedIndex > 0 &&
      spokenIndex > 0 &&
      costs[expectedIndex][spokenIndex] ===
        costs[expectedIndex - 1][spokenIndex - 1] + 1
    ) {
      alignment.push({ type: "substitution", expectedWord, spokenWord });
      expectedIndex -= 1;
      spokenIndex -= 1;
      continue;
    }

    if (
      expectedIndex > 0 &&
      costs[expectedIndex][spokenIndex] === costs[expectedIndex - 1][spokenIndex] + 1
    ) {
      alignment.push({ type: "omission", expectedWord });
      expectedIndex -= 1;
      continue;
    }

    alignment.push({ type: "insertion", spokenWord });
    spokenIndex -= 1;
  }

  return alignment.reverse();
}


const comparableTitle = (text) =>
  text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const STARTS_SENTENCE = /^["'“‘(]?[\p{Lu}\p{N}]/u;

/**
 * The read-aloud screen (storyParagraphs in readflow/src/pages/reading-activity/
 * storyDisplay.ts) hides a first line that repeats the story title, or a title
 * extracted on the same line as the first sentence, because the title is shown
 * above the story. This applies the same two rules and returns the hidden title
 * text and the body learners are shown. A passage is never reduced to nothing.
 */
function splitEmbeddedTitle(passage, title, language = "en") {
  const shownTitle = typeof title === "string" ? title.trim() : "";
  const lines = passage.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (!shownTitle || first < 0) return { title: null, body: passage };
  const heading = lines[first].trim();
  let hidden;
  if (comparableTitle(heading) === comparableTitle(shownTitle)) {
    hidden = heading;
    lines.splice(first, 1);
  } else if (heading.toLocaleLowerCase().startsWith(`${shownTitle.toLocaleLowerCase()} `)
    && STARTS_SENTENCE.test(heading.slice(shownTitle.length).trim())) {
    hidden = heading.slice(0, shownTitle.length);
    lines[first] = heading.slice(shownTitle.length).trim();
  } else {
    return { title: null, body: passage };
  }
  const body = lines.join("\n");
  return getReadingWords(body, language).length ? { title: hidden, body } : { title: null, body: passage };
}

const toWordMetrics = (alignment) => alignment.map(word => ({
  expected: word.expectedWord ?? null, actual: word.spokenWord ?? null, type: word.type,
}));
const countErrors = (wordMetrics) => wordMetrics.filter((metric) => metric.type !== "match").length;

/**
 * Scores the transcript against the passage body the learner was shown. When
 * the screen hid an embedded title, the title is optional: not reading it is
 * never an omission, and reading it is never an insertion. The title is not
 * graded, so its alignment entries are dropped.
 */
function scorePassage(passage, transcript, language, title = "") {
  const { title: hiddenTitle, body } = splitEmbeddedTitle(passage, title, language);
  const titleWordCount = hiddenTitle ? getReadingWords(hiddenTitle, language).length : 0;
  const titleWords = hiddenTitle ? getReadingWords(hiddenTitle, language) : [];
  const expectedWords = getReadingWords(body, language);
  const spokenWords = splitJoinedWords([...titleWords, ...expectedWords], getReadingWords(transcript, language));
  const alignedWordCount = expectedWords.length + titleWordCount;
  // Bound the quadratic alignment workload for direct API requests.
  if (alignedWordCount * spokenWords.length > 4000000 || alignedWordCount > 10000 || spokenWords.length > 10000) {
    const error = new Error("The passage or transcript is too large to score.");
    error.code = "SCORING_LIMIT";
    throw error;
  }
  let wordMetrics = toWordMetrics(alignWords(expectedWords, spokenWords));
  if (titleWordCount) {
    // Align with the title in front, then drop every entry up to and including
    // the title's last word. The rest covers exactly the body's words.
    const withTitle = alignWords([...titleWords, ...expectedWords], spokenWords);
    let titleWordsSeen = 0;
    const bodyStart = withTitle.findIndex((word) => {
      if (titleWordsSeen === titleWordCount) return true;
      if (word.expectedWord !== undefined) titleWordsSeen += 1;
      return false;
    });
    const titleRead = toWordMetrics(bodyStart < 0 ? [] : withTitle.slice(bodyStart));
    // Fewer body errors means the learner read the title aloud; otherwise the
    // body-only alignment stands, so the title can only remove errors.
    if (countErrors(titleRead) < countErrors(wordMetrics)) wordMetrics = titleRead;
  }
  return { expectedWords, spokenWords, wordMetrics };
}
module.exports = { normalizeReadingText, getReadingWords, scorePassage, splitEmbeddedTitle };
