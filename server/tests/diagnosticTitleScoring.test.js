// M2: the displayed story title is optional to read and never scored. Synthetic transcripts only.
// Only a transcript that begins with the WHOLE title has that prefix set aside, and only when it lowers the
// miscues; every other difference from the passage is still a substitution, omission or insertion.
const test = require("node:test");
const assert = require("node:assert/strict");

const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticPassageText } = require("../services/diagnosticAssessments");
const {
  DIAGNOSTIC_READING_LEVEL_THRESHOLDS, calculateOralReadingMetrics, classifyDiagnosticPlacement, getReadingWords, scoreDiagnostic,
} = require("../services/diagnosticScoring");

const LANGUAGES = ["en", "fil"];
const setup = (language) => {
  const assessment = DIAGNOSTIC_ASSESSMENTS[language];
  const passage = getDiagnosticPassageText(assessment);
  return { assessment, passage, title: assessment.title, words: getReadingWords(passage, language) };
};
const metrics = (language, transcript) => {
  const { passage, title } = setup(language);
  return calculateOralReadingMetrics(passage, transcript, 40, language, title);
};
const counts = (m) => ({ sub: m.substitutions, om: m.omissions, ins: m.insertions, excluded: m.titleWordsExcluded, score: Number(m.wordReadingScore.toFixed(2)) });
const withSubstitutions = (words, n) => words.map((word, i) => (i > 0 && i % 9 === 0 && i / 9 <= n ? `zz${word}` : word)).join(" ");
const withOmissions = (words, n) => words.filter((_, i) => !(i > 0 && i % 7 === 0 && i / 7 <= n)).join(" ");

test("thresholds are the existing Phil-IRI-based values (unchanged by this fix)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(DIAGNOSTIC_READING_LEVEL_THRESHOLDS)), {
    wordRecognition: { independentMinimum: 97, instructionalMinimum: 90 },
    comprehension: { independentMinimum: 80, instructionalMinimum: 59 },
  });
});

for (const language of LANGUAGES) {
  const { assessment, passage, title, words } = setup(language);
  const titleWordCount = getReadingWords(title, language).length;

  test(`${language}: the server title is the displayed title and stays outside the scored passage`, () => {
    assert.ok(title && titleWordCount >= 3);
    assert.equal(words.length, 60, "the scored passage is unchanged");
    assert.ok(!getReadingWords(passage, language).slice(0, titleWordCount).every((w, i) => w === getReadingWords(title, language)[i]));
  });

  test(`${language}: 1. perfect passage reading without the title`, () => {
    assert.deepEqual(counts(metrics(language, passage)), { sub: 0, om: 0, ins: 0, excluded: 0, score: 100 });
  });

  test(`${language}: 2. perfect passage reading with the title (with or without punctuation/casing)`, () => {
    for (const transcript of [`${title} ${passage}`, `${title}. ${passage}`, `${title.toUpperCase()}, ${passage}`]) {
      const m = metrics(language, transcript);
      assert.deepEqual(counts(m), { sub: 0, om: 0, ins: 0, excluded: titleWordCount, score: 100 }, transcript.slice(0, 40));
      assert.equal(m.alignment.length, 60, "the alignment covers exactly the passage");
      assert.equal(m.numberOfWordsRead, 60);
    }
  });

  test(`${language}: 3. title plus genuine reading errors: the errors still count`, () => {
    assert.deepEqual(counts(metrics(language, `${title}. ${withSubstitutions(words, 2)}`)),
      { sub: 2, om: 0, ins: 0, excluded: titleWordCount, score: 96.67 });
    assert.deepEqual(counts(metrics(language, `${title}. ${withOmissions(words, 3)}`)),
      { sub: 0, om: 3, ins: 0, excluded: titleWordCount, score: 95 });
    const added = metrics(language, `${title}. ${words.slice(0, 20).join(" ")} extra ${words.slice(20).join(" ")}`);
    assert.deepEqual(counts(added), { sub: 0, om: 0, ins: 1, excluded: titleWordCount, score: 98.33 });
  });

  test(`${language}: 4. extra words unrelated to the title are insertions`, () => {
    assert.deepEqual(counts(metrics(language, `um ${passage}`)), { sub: 0, om: 0, ins: 1, excluded: 0, score: 98.33 });
    assert.deepEqual(counts(metrics(language, `${passage} the end`)), { sub: 0, om: 0, ins: 2, excluded: 0, score: 96.67 });
    // Words before the title: the transcript does not begin with the title, so nothing is set aside.
    assert.deepEqual(counts(metrics(language, `okay ${title} ${passage}`)),
      { sub: 0, om: 0, ins: 1 + titleWordCount, excluded: 0, score: Number((100 * (60 - 1 - titleWordCount) / 60).toFixed(2)) });
    // A title read at the END is not a prefix and stays as insertions.
    assert.deepEqual(counts(metrics(language, `${passage} ${title}`)),
      { sub: 0, om: 0, ins: titleWordCount, excluded: 0, score: Number((100 * (60 - titleWordCount) / 60).toFixed(2)) });
  });

  test(`${language}: 6. a repeated title: only one leading title is set aside`, () => {
    assert.deepEqual(counts(metrics(language, `${title}. ${title}. ${passage}`)),
      { sub: 0, om: 0, ins: titleWordCount, excluded: titleWordCount, score: Number((100 * (60 - titleWordCount) / 60).toFixed(2)) });
  });

  test(`${language}: a partial title is not an identifiable title prefix and still counts`, () => {
    const partial = getReadingWords(title, language).slice(0, titleWordCount - 1).join(" ");
    assert.deepEqual(counts(metrics(language, `${partial} ${passage}`)),
      { sub: 0, om: 0, ins: titleWordCount - 1, excluded: 0, score: Number((100 * (60 - titleWordCount + 1) / 60).toFixed(2)) });
  });

  test(`${language}: 9. classification boundaries are the same with and without the title`, () => {
    const cases = [
      [withSubstitutions(words, 1), 98.33, "Independent"],
      [withSubstitutions(words, 2), 96.67, "Instructional"],
      [withOmissions(words, 6), 90, "Instructional"],
      [withOmissions(words, 7), 88.33, "Frustration"],
    ];
    for (const [transcript, score, level] of cases) {
      for (const spoken of [transcript, `${title}. ${transcript}`]) {
        const m = metrics(language, spoken);
        assert.equal(Number(m.wordReadingScore.toFixed(2)), score, spoken.slice(0, 30));
        assert.equal(classifyDiagnosticPlacement(m.wordReadingScore, 100).wordRecognitionLevel, level);
      }
    }
  });

  test(`${language}: 10. transcripts without the title score exactly as before`, () => {
    const transcripts = [passage, withSubstitutions(words, 3), withOmissions(words, 5), `uh ${passage} um`, words.slice(0, 10).join(" "),
      words.slice().reverse().join(" "), words.flatMap((w, i) => (i % 5 === 0 ? [w, w] : [w])).join(" ")];
    for (const transcript of transcripts) {
      const before = calculateOralReadingMetrics(passage, transcript, 40, language); // no title: the pre-fix behavior
      const { titleWordsExcluded, ...after } = calculateOralReadingMetrics(passage, transcript, 40, language, title);
      assert.equal(titleWordsExcluded, 0);
      assert.deepEqual(after, before);
      assert.equal("titleWordsExcluded" in before, false, "callers without a title (M5) keep the exact output shape");
    }
  });

  test(`${language}: the official result uses the title rule; the transcript itself is not changed`, () => {
    const answers = Object.fromEntries(assessment.questions.map((q) => [q.id, q.correctChoiceId]));
    const transcript = `${title}. ${passage}`;
    const result = scoreDiagnostic({ assessment, passageText: passage, transcript, recordingDurationSeconds: 40, answers });
    assert.equal(result.orvScore, 100);
    assert.equal(result.readingLevel, "Independent");
    assert.equal(result.oralReadingMetrics.titleWordsExcluded, titleWordCount);
    assert.equal(transcript, `${title}. ${passage}`);
    // An assessment object without a title (older callers/tests) keeps the old behavior.
    const { title: _omit, ...untitled } = assessment;
    const old = scoreDiagnostic({ assessment: untitled, passageText: passage, transcript, recordingDurationSeconds: 40, answers });
    assert.equal(old.oralReadingMetrics.insertions, titleWordCount);
    assert.equal("titleWordsExcluded" in old.oralReadingMetrics, false);
  });
}

test("5. a passage that itself begins with the title's words is never shortened", () => {
  const passage = "Mia and Ben walked to the school garden. They watered every plant before the sun grew hot.";
  const title = "Mia and Ben";
  const read = (transcript) => counts(calculateOralReadingMetrics(passage, transcript, 30, "en", title));
  const total = getReadingWords(passage, "en").length;
  // Reading only the passage: the transcript starts with the title words, but setting them aside would add omissions.
  assert.deepEqual(read(passage), { sub: 0, om: 0, ins: 0, excluded: 0, score: 100 });
  // Title, then the passage: one leading copy is set aside.
  assert.deepEqual(read(`${title}. ${passage}`), { sub: 0, om: 0, ins: 0, excluded: 3, score: 100 });
  // Passage with its first words skipped is still an omission, never hidden by the title rule.
  assert.deepEqual(read(passage.split(" ").slice(3).join(" ")),
    { sub: 0, om: 3, ins: 0, excluded: 0, score: Number((100 * (total - 3) / total).toFixed(2)) });
  // Title words appearing later in the passage are untouched.
  assert.deepEqual(read(`${title} ${passage} and Ben`), { sub: 0, om: 0, ins: 2, excluded: 3, score: Number((100 * (total - 2) / total).toFixed(2)) });
});
