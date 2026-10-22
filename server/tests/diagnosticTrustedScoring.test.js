// The server must score exactly like the existing browser rubric. This loads
// the frontend TypeScript (Node strips types) and compares outputs directly.
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticPassageText } = require("../services/diagnosticAssessments");
const server = require("../services/diagnosticScoring");

const moduleUrl = (path) => pathToFileURL(resolve(__dirname, "../../readflow/src/modules/module2", path)).href;
const loadFrontend = async () => ({
  data: await import(moduleUrl("data/diagnosticData.ts")),
  scoring: await import(moduleUrl("services/diagnosticScoring.ts")),
  passage: await import(moduleUrl("services/diagnosticPassage.ts")),
});

// Deterministic transcript variants: substitutions, omissions, insertions,
// repetitions, punctuation, casing, apostrophes, digits and "mister".
function variants(words, language) {
  const out = [words.join(" "), words.join(" ").toUpperCase(), `${words.join(", ")}.`];
  for (let miscues = 1; miscues <= 12; miscues++) {
    out.push(words.map((word, index) => index % Math.ceil(words.length / miscues) === 0 ? `x${word}` : word).join(" "));
    out.push(words.filter((_, index) => index % (miscues + 2) !== 1).join(" "));
    out.push(words.flatMap((word, index) => index % (miscues + 3) === 0 ? [word, word] : [word]).join(" "));
  }
  out.push(`uh ${words.join(" ")} um`, words.slice(0, 10).join(" "), words.slice().reverse().join(" "));
  out.push(language === "en" ? `1 mister Mr. Ben's don’t ${words.join(" ")}` : `Bagama't mag-aaral ${words.join(" ")}`);
  return out;
}

test("server assessment copy matches the frontend identity, passage and answer keys", async () => {
  const { data } = await loadFrontend();
  for (const language of ["en", "fil"]) {
    const frontend = data.diagnosticAssessmentRegistry[language];
    const copy = DIAGNOSTIC_ASSESSMENTS[language];
    assert.equal(copy.id, frontend.id);
    assert.equal(copy.version, frontend.version);
    assert.equal(copy.language, frontend.language);
    assert.equal(copy.assessmentType, frontend.assessmentType);
    assert.equal(copy.contentStatus, frontend.contentStatus);
    assert.deepEqual([...copy.paragraphs], [...frontend.passage.paragraphs]);
    assert.equal(getDiagnosticPassageText(copy), data.getDiagnosticPassageText(frontend));
    assert.deepEqual(copy.questions.map((q) => ({ id: q.id, choiceIds: [...q.choiceIds], correctChoiceId: q.correctChoiceId })),
      frontend.questions.map((q) => ({ id: q.id, choiceIds: q.choices.map((c) => c.id), correctChoiceId: q.correctChoiceId })));
  }
});

test("thresholds, difficulty mapping and every placement combination are unchanged", async () => {
  const { scoring } = await loadFrontend();
  assert.deepEqual(server.DIAGNOSTIC_READING_LEVEL_THRESHOLDS, scoring.DIAGNOSTIC_READING_LEVEL_THRESHOLDS);
  for (const level of ["Frustration", "Instructional", "Independent"]) {
    assert.equal(server.assignDifficultyTier(level), scoring.assignDifficultyTier(level));
  }
  const edges = [0, 50, 58, 58.99, 59, 79.99, 80, 89.99, 90, 96.67, 96.99, 97, 100];
  for (const orv of edges) {
    for (const comprehension of edges) {
      assert.deepEqual(server.classifyDiagnosticPlacement(orv, comprehension),
        scoring.classifyDiagnosticPlacement(orv, comprehension), `${orv}/${comprehension}`);
    }
  }
});

for (const language of ["en", "fil"]) {
  test(`${language}: server metrics and official result match the browser rubric on the same transcript`, async () => {
    const { data, scoring, passage } = await loadFrontend();
    const frontendAssessment = data.diagnosticAssessmentRegistry[language];
    const assessment = DIAGNOSTIC_ASSESSMENTS[language];
    const passageText = getDiagnosticPassageText(assessment);
    const words = scoring.getReadingWords(passageText, language);
    assert.equal(words.length, 60);
    let compared = 0;
    for (const transcript of variants(words, language)) {
      assert.deepEqual(server.getReadingWords(transcript, language), scoring.getReadingWords(transcript, language));
      for (const duration of [undefined, 0, 37.5, 300]) {
        assert.deepEqual(server.calculateOralReadingMetrics(passageText, transcript, duration, language),
          scoring.calculateOralReadingMetrics(passageText, transcript, duration, language));
      }
      for (let correct = 0; correct <= 6; correct++) {
        const answers = Object.fromEntries(assessment.questions.map((q, index) =>
          [q.id, index < correct ? q.correctChoiceId : q.choiceIds.find((id) => id !== q.correctChoiceId)]));
        const expected = passage.createPassageDiagnosticResult(frontendAssessment, {
          transcription: { text: transcript },
          oralReadingMetrics: { recordingDurationSeconds: 42 },
          transcriptReceipts: ["unused"],
        }, answers);
        const actual = server.scoreDiagnostic({ assessment, passageText, transcript, recordingDurationSeconds: 42, answers });
        assert.equal(actual.orvScore, expected.orvScore);
        assert.equal(actual.comprehensionScore, expected.comprehensionScore);
        assert.equal(actual.readingLevel, expected.readingLevel);
        assert.equal(actual.difficultyTier, expected.difficultyTier);
        assert.equal(actual.readingSpeedWpm, expected.readingSpeedWpm);
        assert.deepEqual(actual.oralReadingMetrics, expected.oralReadingMetrics);
        assert.deepEqual(actual.comprehensionAnswers, expected.comprehensionAnswers);
        compared++;
      }
    }
    assert.ok(compared > 200);
  });
}

test("the server rubric rejects unanswered or unknown answers", () => {
  const assessment = DIAGNOSTIC_ASSESSMENTS.en;
  const passageText = getDiagnosticPassageText(assessment);
  const answers = Object.fromEntries(assessment.questions.map((q) => [q.id, "a"]));
  for (const broken of [{}, { ...answers, "en-question-1": "e" }, { ...answers, "en-question-6": undefined }]) {
    assert.throws(() => server.scoreDiagnostic({ assessment, passageText, transcript: passageText, answers: broken }));
  }
});
