// Characterization of the CURRENT M5 and M2 oral-reading scores for Filipino readings.
// These tests record what the code does today, including known limitations, so that any
// later scoring change (Phase 2) is deliberate and visible. They are not a statement that
// the recorded values are correct. Synthetic passages and transcripts only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildAttemptInsert } = require("../services/oralReadingAttemptService");
const m2 = require("../services/diagnosticScoring");
const baseline = require("./fixtures/m5FilipinoScoringBaseline.json");

const round = (n) => (n === undefined ? null : Math.round(n * 100) / 100);
const row = (name) => {
  const found = baseline.rows.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
};

function m5Now({ passage, transcript, durationSeconds, title }) {
  try {
    const r = buildAttemptInsert({ user: { id: "synthetic" } },
      { id: "m", title: title || "Kuwento", passageTitle: title || "", passage, language: "fil" },
      { transcript, durationSeconds });
    const count = (type) => r.word_metrics.filter((metric) => metric.type === type).length;
    return {
      insert: r,
      result: {
        accuracy: round(r.pronunciation_accuracy), wpm: round(r.reading_speed_wpm), expected: r.expected_word_count,
        errors: r.detected_error_count, match: count("match"), substitution: count("substitution"),
        omission: count("omission"), insertion: count("insertion"),
      },
    };
  } catch (error) {
    return { result: { rejected: error.code } };
  }
}

function m2Now({ passage, transcript, durationSeconds }) {
  const k = m2.calculateOralReadingMetrics(passage, transcript, durationSeconds, "fil");
  return { score: round(k.wordReadingScore), expected: k.totalExpectedWords, match: k.correctWords, wpm: round(k.readingSpeedWpm), wcpm: round(k.correctWordsPerMinute) };
}

test("every recorded M5 and M2 result is unchanged (33 synthetic Filipino readings)", () => {
  assert.equal(baseline.rows.length, 33);
  for (const item of baseline.rows) {
    assert.deepEqual(m5Now(item.input).result, item.m5, `M5: ${item.name}`);
    assert.deepEqual(m2Now(item.input), item.m2, `M2: ${item.name}`);
  }
});

test("every row is labelled baseline, a known LIMITATION, or an M2/M5 difference", () => {
  for (const item of baseline.rows) assert.match(item.label, /^(baseline|LIMITATION: |M2 and M5 differ: )/, item.name);
  assert.equal(baseline.rows.filter((item) => item.label.startsWith("LIMITATION")).length, 18);
});

// The headline numbers, written out so a reviewer can read them without the fixture.
// [case, M5 stored accuracy, M2 word reading score]
const HEADLINE = [
  ["correct reading", 100, 100],
  ["one substitution (nagtitinda -> nagbebenta)", 96, 96],
  ["one omission (ng)", 96, 96],
  ["one extra word (po)", 96, 96],
  ["repeated word (si si)", 96, 96],
  ["self-correction (nagtinda nagtitinda)", 96, 96],
  ["filler words (ah, ahm)", 92, 92],
  ["whole passage read twice", 0, 0],
  ["hyphenated words written joined (arawaraw, benben)", 100, 84],
  ["number word as digit (isang -> 1)", 100, 96],
  ["number above 10 as digit (labing-isang -> 11)", 60, 60],
  ["year as digits (2026)", 20, 20],
  ["contraction (Ito'y read as ito ay)", 66.67, 66.67],
  ["enclitic contraction ('di read as hindi)", 0, 0],
  ["accent marks (batà vs bata)", 50, 50],
  ["abbreviation Gng. read as ginang", 75, 75],
  ["partial recording (first third)", 36, 36],
  ["very short recording (one word)", 4, 4],
  ["title line not read", 100, 60],
];
test("headline values: substitutions, omissions, insertions, repetitions, self-corrections, numbers, contractions, accents", () => {
  for (const [name, m5Accuracy, m2Score] of HEADLINE) {
    assert.equal(row(name).m5.accuracy, m5Accuracy, `M5 ${name}`);
    assert.equal(row(name).m2.score, m2Score, `M2 ${name}`);
  }
});

test("LIMITATION: insertions are errors, so a reading where every story word matched can score below 100", () => {
  for (const name of ["one extra word (po)", "repeated word (si si)", "self-correction (nagtinda nagtitinda)"]) {
    const { m5 } = row(name);
    assert.equal(m5.match, m5.expected, `${name}: all story words matched`);
    assert.equal(m5.insertion, 1);
    assert.equal(m5.accuracy, 96);
  }
  const twice = row("whole passage read twice").m5;
  assert.deepEqual([twice.match, twice.insertion, twice.accuracy], [25, 25, 0]);
});

test("empty and incomplete recordings: M5 refuses to save an empty transcript; partial readings count omissions", () => {
  assert.deepEqual(row("empty or punctuation-only transcript").m5, { rejected: "INVALID_TRANSCRIPT" });
  assert.equal(row("empty or punctuation-only transcript").m2.score, 0);
  const partial = row("partial recording (first third)").m5;
  assert.deepEqual([partial.match, partial.omission, partial.accuracy, partial.wpm], [9, 16, 36, 108]);
  const one = row("very short recording (one word)").m5;
  assert.deepEqual([one.match, one.omission, one.accuracy, one.wpm], [1, 24, 4, 30]);
});

test("M2 and M5 differ on the same reading: joined hyphen words, digits 1-10, an unread title, empty speech", () => {
  const differ = baseline.rows.filter((item) => item.label.startsWith("M2 and M5 differ"));
  assert.deepEqual(differ.map((item) => [item.name, item.m5.accuracy ?? item.m5.rejected, item.m2.score]), [
    ["hyphenated words written joined (arawaraw, benben)", 100, 84],
    ["number word as digit (isang -> 1)", 100, 96],
    ["empty or punctuation-only transcript", "INVALID_TRANSCRIPT", 0],
    ["title line read aloud", 100, 100],
    ["title line not read", 100, 60],
  ]);
  // The M2 Phil-IRI word-recognition band changes for the same reading (thresholds untouched: 97 / 90).
  const band = (score) => m2.classifyDiagnosticPlacement(score, 100).wordRecognitionLevel;
  assert.deepEqual([band(100), band(84), band(96), band(60)], ["Independent", "Frustration", "Instructional", "Frustration"]);
});

test("WPM is recognized words over wall-clock seconds; WCPM exists only in M2 and is not stored by M5", () => {
  for (const item of baseline.rows.filter((r) => !r.m5.rejected && r.name !== "title line read aloud")) {
    const spoken = item.m5.match + item.m5.substitution + item.m5.insertion;
    assert.equal(item.m5.wpm, round((spoken / item.input.durationSeconds) * 60), item.name);
  }
  assert.equal(row("correct reading").m5.wpm, 125);
  assert.equal(row("correct reading after a long pause (30 s)").m5.wpm, 50, "LIMITATION: silence lowers WPM");
  // LIMITATION: a title read aloud is left out of accuracy but counted in M5 WPM (10 words in 4 s).
  const title = row("title line read aloud").m5;
  assert.deepEqual([title.expected, title.match, title.insertion, title.wpm], [6, 6, 0, 150]);
  // M2 and M5 WPM differ when M2 cannot split joined words (fewer recognized words).
  const joined = row("hyphenated words written joined (arawaraw, benben)");
  assert.deepEqual([joined.m5.wpm, joined.m2.wpm], [125, 115]);
  // M2 WCPM = matched words per minute; "read twice" halves it while WPM stays 125.
  assert.deepEqual([row("whole passage read twice").m2.wpm, row("whole passage read twice").m2.wcpm], [125, 62.5]);
  const { insert } = m5Now(row("correct reading").input);
  assert.equal(Object.keys(insert).some((key) => /wcpm|correct_words_per_minute/i.test(key)), false);
  assert.equal(insert.scoring_version, 2);
});

test("M8 XP verification still accepts every saved M5 row (same formula as m5_verify_reading)", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/proposed/m8_f1_xp_rewards_v1_PROPOSED.sql"), "utf8");
  assert.match(sql, /a\.scoring_version < 2/);
  assert.match(sql, /v_correct := greatest\(a\.expected_word_count - a\.detected_error_count, 0\);/);
  assert.match(sql, /abs\(a\.pronunciation_accuracy - \(100\.0 \* v_correct \/ a\.expected_word_count\)\) > 0\.001/);
  for (const item of baseline.rows.filter((r) => !r.m5.rejected)) {
    const { insert } = m5Now(item.input);
    const metrics = insert.word_metrics;
    const total = metrics.filter((m) => m.type !== "insertion").length;
    const errors = metrics.filter((m) => m.type !== "match").length;
    const correct = Math.max(insert.expected_word_count - insert.detected_error_count, 0);
    assert.equal(total, insert.expected_word_count, item.name);
    assert.equal(errors, insert.detected_error_count, item.name);
    assert.ok(Math.abs(insert.pronunciation_accuracy - (100 * correct) / insert.expected_word_count) <= 0.001, item.name);
  }
});
