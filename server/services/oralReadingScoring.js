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
    ? normalized.split(" ").map(word => word === "mister" ? "mr" : word).join(" ")
    : normalized;
}

function getReadingWords(text, language = "en") {
  const normalizedText = normalizeReadingText(text, language);
  return normalizedText ? normalizedText.split(" ") : [];
}

function alignReadingWords(
  expectedText,
  transcript,
  language,
) {
  const expectedWords = getReadingWords(expectedText, language);
  const spokenWords = getReadingWords(transcript, language);
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


function scorePassage(passage, transcript, language) {
  const expectedWords = getReadingWords(passage, language);
  const spokenWords = getReadingWords(transcript, language);
  // Bound the quadratic alignment workload for direct API requests.
  if (expectedWords.length * spokenWords.length > 4000000 || expectedWords.length > 10000 || spokenWords.length > 10000) {
    const error = new Error("The passage or transcript is too large to score.");
    error.code = "SCORING_LIMIT";
    throw error;
  }
  const wordMetrics = alignReadingWords(passage, transcript, language).map(word => ({
    expected: word.expectedWord ?? null, actual: word.spokenWord ?? null, type: word.type,
  }));
  return { expectedWords, spokenWords, wordMetrics };
}
module.exports = { normalizeReadingText, getReadingWords, scorePassage };
