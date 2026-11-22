// M7 F10: Provide Suggested Interventions (rule-based, explainable; no AI provider).
//
// Every suggestion is computed from saved, authorized results only:
//   * M6 comprehension: first-answer results per saved question category (literal / inferential / critical),
//     counted assessments only (one per learner and activity, M6's rule), validated like the M7 competency report;
//   * M5 oral reading: reading accuracy (words matching the story), the story words read differently or not heard
//     (saved word alignment), English pronunciation-check practice words, and reading speed (only when a benchmark
//     has been approved; see RULES.fluencyMinWpm);
//   * M2: the learner's official placement per language, shown as context only (never changed here).
// English and Filipino are evaluated separately. Nothing here writes, assigns work, changes a score, a level or XP.
//
// The rules (RULES below) are documented in docs/M7_SUGGESTED_INTERVENTIONS.md; change them there and here together.

const RULES = Object.freeze({
  /** Comprehension benchmark (% correct on the first answer): the same 75% minimum the M7 support guide uses. */
  comprehensionBenchmark: 75,
  /** Fewer saved questions of a category than this: no observation at all, only "more assessment data needed". */
  minQuestionsToObserve: 2,
  /** Only the most recent assessments that included the category are pooled, so later progress can show. */
  recentAssessments: 3,
  /**
   * A "repeated difficulty" needs at least this many recent assessments with the category below the benchmark
   * (so one assessment is always only a preliminary observation) ...
   */
  patternMinAssessmentsBelow: 2,
  /** ... and at least this many recent questions of the category (two passages with 2 questions each). */
  patternMinQuestions: 4,
  /** Word recognition: Phil-IRI frustration level (below 90% of words read as written), as in M2 scoring. */
  wordRecognitionMinAccuracy: 90,
  /** Only the most recent saved readings in a language are pooled. */
  recentReadings: 3,
  /** A word-recognition "repeated pattern" needs at least this many recent readings below the minimum. */
  patternMinReadingsBelow: 2,
  /**
   * Reading speed benchmark in words per minute. null = no approved benchmark: fluency is NOT evaluated and no
   * fluency suggestion is ever made. Saved speeds include pauses and are not grade-normed, so a value must be
   * approved (e.g. by the adviser, per grade) before this is switched on.
   */
  fluencyMinWpm: null,
  /** At most this many needs are suggested at once (the clearest first); the rest stay visible as observations. */
  maxSuggestions: 3,
  /** At most this many practice words are listed. */
  maxPracticeWords: 8,
});

const LANGUAGES = Object.freeze(['en', 'fil']);
const LANGUAGE_NAMES = Object.freeze({ en: 'English', fil: 'Filipino' });
const COMPETENCIES = Object.freeze({
  word_recognition: 'Word Recognition',
  fluency: 'Reading Fluency',
  literal: 'Literal Comprehension',
  inferential: 'Inferential Comprehension',
  critical: 'Critical Comprehension',
});
/** Foundational skills first: decoding before comprehension; literal before inferential before critical. */
const PRIORITY = Object.freeze(['word_recognition', 'literal', 'inferential', 'critical', 'fluency']);
const QUESTION_TYPES = Object.freeze(['literal', 'inferential', 'critical']);
const TYPE_WORDS = Object.freeze({ literal: 'literal (recall)', inferential: 'inferential', critical: 'critical-thinking' });

/** The suggested interventions. Each names a recognised classroom approach and one concrete activity. */
const CATALOG = Object.freeze({
  literal: {
    key: 'story_details', title: 'Story Details Practice',
    approach: 'Question-Answer Relationships ("Right There" questions) with a simple story map',
    activity: 'Read a short passage together. Ask the learner to find and point to the sentences that tell who the characters are, where the story happens, and what happened first, next and last, then fill in a story map (characters, setting, events).',
  },
  inferential: {
    key: 'reading_between_lines', title: 'Reading Between the Lines',
    approach: 'Prediction and context clues ("Think and Search" / "Author and Me" questions)',
    activity: 'Pause at two or three points in a short story to predict what will happen next, then read on to check. Underline the clue words that show how a character feels or what an unfamiliar word means, and say what the story suggests without stating it.',
  },
  critical: {
    key: 'evidence_based_reading', title: 'Evidence-Based Reading Practice',
    approach: 'Evaluating ideas with text evidence (fact vs. opinion, judging decisions)',
    activity: "Read a short passage, evaluate a character's decision and identify supporting evidence from the story. Ask: Was it a good choice? Which sentence supports your answer? Sort statements into what the story says and what someone thinks.",
  },
  word_recognition: {
    en: {
      key: 'guided_rereading_words', title: 'Guided Oral Rereading with Word Practice',
      approach: 'Teacher-modelled reading, guided rereading and word study',
      activity: 'Model reading the passage aloud, then have the learner reread it with your support. Practise the listed words: say each word slowly, break it into sounds or syllables, then read it again in its sentence.',
    },
    fil: {
      key: 'guided_rereading_pantig', title: 'Guided Oral Rereading with Pantig Practice',
      approach: 'Teacher-modelled reading, guided rereading and syllable (pantig) work',
      activity: 'Basahin muna nang malakas ang teksto bilang modelo, saka ipabasang muli sa mag-aaral nang may gabay. Practise the listed words by syllable (pantig), for example ba-hay, then read each word again in its sentence.',
    },
  },
  fluency: {
    key: 'repeated_reading', title: 'Supported Repeated Reading',
    approach: 'Repeated reading with modelling (echo or paired reading)',
    activity: 'Read the same short passage three times over a few days: first echo-read it with the teacher, then paired reading, then independently. Note how the reading becomes smoother each time.',
  },
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const pct = (correct, total) => (total > 0 ? Math.round((correct / total) * 100) : null);
const byDate = (a, b) => String(a.completedAt).localeCompare(String(b.completedAt)) || String(a.id).localeCompare(String(b.id));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function catalogEntry(competency, language) {
  const entry = CATALOG[competency];
  return entry && entry.en && entry.fil ? entry[language] : entry;
}

/**
 * One comprehension category in one language.
 * quizzes: counted, validated assessments in this language { id, title, completedAt, byType }.
 */
function evaluateCategory(type, quizzes, rules = RULES) {
  const withType = quizzes.filter(q => q.byType?.[type]?.total > 0).sort(byDate);
  const recent = withType.slice(-rules.recentAssessments).map(q => {
    const { firstCorrect: correct, total } = q.byType[type];
    return { id: q.id, title: q.title || 'Comprehension activity', completedAt: q.completedAt, correct, total, percent: pct(correct, total) };
  });
  const correct = recent.reduce((sum, a) => sum + a.correct, 0);
  const total = recent.reduce((sum, a) => sum + a.total, 0);
  const percent = pct(correct, total);
  const below = recent.filter(a => a.percent < rules.comprehensionBenchmark).length;
  const latest = recent[recent.length - 1] ?? null;
  const previous = recent[recent.length - 2] ?? null;
  // Improving = the same rule, applied just before the latest assessment, found a need; the latest window does not.
  const before = withType.slice(-rules.recentAssessments - 1, -1);
  const beforeCorrect = before.reduce((sum, q) => sum + q.byType[type].firstCorrect, 0);
  const beforeTotal = before.reduce((sum, q) => sum + q.byType[type].total, 0);
  const earlierBelow = withType.length > 1 && beforeTotal >= rules.minQuestionsToObserve && pct(beforeCorrect, beforeTotal) < rules.comprehensionBenchmark;
  const evidence = { assessments: recent, correct, total, percent, assessmentsBelow: below, totalAssessments: withType.length };
  const trend = latest && previous ? (latest.percent > previous.percent ? 'improving' : latest.percent < previous.percent ? 'declining' : 'steady') : null;
  if (total < rules.minQuestionsToObserve) return { status: 'insufficient', evidence, trend };
  if (percent < rules.comprehensionBenchmark) {
    const pattern = below >= rules.patternMinAssessmentsBelow && total >= rules.patternMinQuestions;
    return { status: 'needs_practice', level: pattern ? 'pattern' : 'preliminary', evidence, trend };
  }
  return { status: earlierBelow && latest.percent >= rules.comprehensionBenchmark ? 'improving' : 'on_track', evidence, trend };
}

/** Story words read differently or not heard in the given readings (saved word alignment), most frequent first. */
function wordsReadDifferently(readings, limit) {
  const counts = new Map();
  for (const reading of readings) {
    for (const metric of Array.isArray(reading.word_metrics) ? reading.word_metrics : []) {
      if (!metric || !['substitution', 'omission'].includes(metric.type) || typeof metric.expected !== 'string') continue;
      const word = metric.expected.trim().toLocaleLowerCase();
      if (!word || word.length > 40) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([word, times]) => ({ word, times }));
}

/** Word recognition and fluency in one language. readings: this language's saved readings (any order). */
function evaluateReading(readings, practiceChecks, rules = RULES) {
  const valid = readings.filter(r => finite(Number(r.pronunciation_accuracy)) && typeof r.completed_at === 'string')
    .map(r => ({ ...r, completedAt: r.completed_at })).sort(byDate);
  const recent = valid.slice(-rules.recentReadings);
  const rows = recent.map(r => ({
    id: r.id, title: r.passage_title_snapshot || r.module_title_snapshot || 'Reading activity', completedAt: r.completed_at,
    accuracy: Math.round(Number(r.pronunciation_accuracy) * 100) / 100,
    wpm: finite(Number(r.reading_speed_wpm)) ? Math.round(Number(r.reading_speed_wpm)) : null,
  }));
  const meanOf = values => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  const accuracy = meanOf(rows.map(r => r.accuracy));
  const below = rows.filter(r => r.accuracy < rules.wordRecognitionMinAccuracy).length;
  const latest = rows[rows.length - 1] ?? null;
  const before = valid.slice(-rules.recentReadings - 1, -1).map(r => Number(r.pronunciation_accuracy));
  const earlierBelow = valid.length > 1 && before.length > 0 && before.reduce((a, b) => a + b, 0) / before.length < rules.wordRecognitionMinAccuracy;
  const recentIds = new Set(rows.map(r => r.id));
  const checkWords = [...new Set(practiceChecks.filter(c => recentIds.has(c.attempt_id))
    .flatMap(c => (Array.isArray(c.words_to_practice) ? c.words_to_practice : []))
    .filter(w => typeof w === 'string' && w.trim()).map(w => w.trim()))].slice(0, rules.maxPracticeWords);
  const evidence = { readings: rows, accuracy, readingsBelow: below, totalReadings: valid.length,
    wordsReadDifferently: wordsReadDifferently(recent, rules.maxPracticeWords), pronunciationPracticeWords: checkWords };
  let wordRecognition;
  if (!rows.length) wordRecognition = { status: 'insufficient', evidence };
  else if (accuracy < rules.wordRecognitionMinAccuracy) {
    wordRecognition = { status: 'needs_practice', level: below >= rules.patternMinReadingsBelow ? 'pattern' : 'preliminary', evidence };
  } else {
    wordRecognition = { status: earlierBelow && latest.accuracy >= rules.wordRecognitionMinAccuracy ? 'improving' : 'on_track', evidence };
  }
  const speeds = rows.filter(r => r.wpm !== null);
  const wpm = meanOf(speeds.map(r => r.wpm));
  const fluencyEvidence = { readings: speeds, wpm, benchmark: rules.fluencyMinWpm };
  let fluency;
  if (!finite(rules.fluencyMinWpm)) fluency = { status: 'not_evaluated', evidence: fluencyEvidence };
  else if (!speeds.length) fluency = { status: 'insufficient', evidence: fluencyEvidence };
  else if (wpm < rules.fluencyMinWpm) {
    const slow = speeds.filter(r => r.wpm < rules.fluencyMinWpm).length;
    fluency = { status: 'needs_practice', level: slow >= rules.patternMinReadingsBelow ? 'pattern' : 'preliminary', evidence: fluencyEvidence };
  } else fluency = { status: 'on_track', evidence: fluencyEvidence };
  return { wordRecognition, fluency };
}

function describeComprehension(type, result, language, rules) {
  const { evidence } = result;
  const words = TYPE_WORDS[type];
  const latest = evidence.assessments[evidence.assessments.length - 1];
  const one = evidence.assessments.length === 1;
  const evidenceText = one
    ? `${latest.correct}/${latest.total} ${type} questions answered correctly on the first try in the latest completed ${LANGUAGE_NAMES[language]} assessment.`
    : `${evidence.correct}/${evidence.total} ${type} questions answered correctly on the first try across the last ${evidence.assessments.length} ${LANGUAGE_NAMES[language]} assessments (${evidence.percent}%; benchmark ${rules.comprehensionBenchmark}%). ${evidence.assessmentsBelow} of ${evidence.assessments.length} were below the benchmark.`;
  const reason = result.level === 'pattern'
    ? `Results on ${words} questions were below the ${rules.comprehensionBenchmark}% benchmark in ${evidence.assessmentsBelow} of the last ${evidence.assessments.length} assessments: a repeated difficulty in recent results, not a permanent label.`
    : `The ${one ? 'latest assessment indicates' : 'recent assessments indicate'} difficulty with ${words} questions. More assessments are needed to confirm a persistent pattern.`;
  return { evidenceText, reason };
}

function describeWordRecognition(result, language, rules) {
  const { evidence } = result;
  const n = evidence.readings.length;
  const latest = evidence.readings[n - 1];
  const evidenceText = n === 1
    ? `Reading accuracy ${Math.round(latest.accuracy)}% (words matching the story) in the latest saved ${LANGUAGE_NAMES[language]} reading; minimum ${rules.wordRecognitionMinAccuracy}%.`
    : `Average reading accuracy ${evidence.accuracy}% (words matching the story) across the last ${n} ${LANGUAGE_NAMES[language]} readings; ${evidence.readingsBelow} of ${n} were below ${rules.wordRecognitionMinAccuracy}%.`;
  const reason = result.level === 'pattern'
    ? `Several recent readings had many words read differently or not heard: a repeated word-recognition difficulty in recent results.`
    : `The ${n === 1 ? 'latest reading shows' : 'recent readings show'} difficulty reading the story words as written. More readings are needed to confirm a persistent pattern.`;
  return { evidenceText, reason };
}

function describeFluency(result, language, rules) {
  const { evidence } = result;
  return {
    evidenceText: `Average reading speed ${evidence.wpm} words per minute across the last ${plural(evidence.readings.length, LANGUAGE_NAMES[language] + ' reading')}; approved benchmark ${rules.fluencyMinWpm}.`,
    reason: result.level === 'pattern' ? 'Several recent readings were below the approved reading-speed benchmark.' : 'The latest reading was below the approved reading-speed benchmark. More readings are needed to confirm a pattern.',
  };
}

const assessmentPeriod = items => (items.length ? { from: items[0].completedAt, to: items[items.length - 1].completedAt } : null);

/** Results saved after the latest recorded intervention for this competency and language, if any. */
function sinceIntervention(competency, language, interventions, items, rules) {
  const recorded = interventions.filter(i => i.competency === competency && (i.language ?? null) === language && typeof i.intervention_date === 'string')
    .sort((a, b) => b.intervention_date.localeCompare(a.intervention_date))[0];
  if (!recorded) return null;
  const after = items.filter(item => String(item.completedAt).slice(0, 10) > recorded.intervention_date);
  const base = { interventionId: recorded.id, date: recorded.intervention_date, status: recorded.status, results: after.length };
  if (competency === 'word_recognition' || competency === 'fluency') {
    const values = after.map(r => (competency === 'fluency' ? r.wpm : r.accuracy)).filter(finite);
    return { ...base, average: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null, unit: competency === 'fluency' ? 'wpm' : '%' };
  }
  const correct = after.reduce((s, a) => s + a.correct, 0), total = after.reduce((s, a) => s + a.total, 0);
  return { ...base, correct, total, percent: pct(correct, total), benchmark: rules.comprehensionBenchmark, unit: '%' };
}

/**
 * The whole evaluation for one learner. Pure: everything it needs is passed in.
 *   quizzes:        counted M6 assessments { id, title, completedAt, language, byType, dataQuality? }
 *   readings:       M5 readings { id, completed_at, language_snapshot, pronunciation_accuracy, reading_speed_wpm, word_metrics, ... }
 *   practiceChecks: completed English pronunciation checks { attempt_id, words_to_practice }
 *   placements:     { en?: {readingLevel, difficultyTier, source}, fil?: ... } (context only)
 *   interventions:  the viewer's own saved interventions for this learner
 */
function evaluate({ quizzes = [], readings = [], practiceChecks = [], placements = {}, interventions = [] }, rules = RULES) {
  const invalid = quizzes.filter(q => q.dataQuality).length;
  const unknownLanguage = readings.filter(r => !LANGUAGES.includes(r.language_snapshot)).length
    + quizzes.filter(q => !q.dataQuality && !LANGUAGES.includes(q.language)).length;
  const languages = [];
  const observations = [];
  for (const language of LANGUAGES) {
    const langQuizzes = quizzes.filter(q => !q.dataQuality && q.language === language);
    const langReadings = readings.filter(r => r.language_snapshot === language);
    const comprehension = Object.fromEntries(QUESTION_TYPES.map(type => [type, evaluateCategory(type, langQuizzes, rules)]));
    const reading = evaluateReading(langReadings, practiceChecks, rules);
    const hasData = langQuizzes.length > 0 || langReadings.length > 0;
    languages.push({ language, name: LANGUAGE_NAMES[language], hasData, assessments: langQuizzes.length, readings: langReadings.length,
      placement: placements[language] ?? null, comprehension, wordRecognition: reading.wordRecognition, fluency: reading.fluency });
    if (!hasData) continue;
    const entries = [...QUESTION_TYPES.map(type => [type, comprehension[type]]), ['word_recognition', reading.wordRecognition], ['fluency', reading.fluency]];
    for (const [competency, result] of entries) {
      if (result.status !== 'needs_practice' && result.status !== 'improving') continue;
      const isComprehension = QUESTION_TYPES.includes(competency);
      const items = isComprehension ? result.evidence.assessments : result.evidence.readings;
      const text = isComprehension ? describeComprehension(competency, result, language, rules)
        : competency === 'word_recognition' ? describeWordRecognition(result, language, rules) : describeFluency(result, language, rules);
      const entry = catalogEntry(competency, language);
      observations.push({
        id: `${language}:${competency}`, competency, competencyName: COMPETENCIES[competency], language, languageName: LANGUAGE_NAMES[language],
        status: result.status, level: result.level ?? null, trend: result.trend ?? null,
        moreEvidenceNeeded: result.status === 'needs_practice' && result.level !== 'pattern',
        evidence: result.evidence, evidenceText: result.status === 'improving'
          ? improvingText(competency, result, language, rules) : text.evidenceText,
        reason: result.status === 'improving'
          ? 'Earlier results were below the benchmark; the most recent results meet it. Keep monitoring before closing any intervention.'
          : text.reason,
        period: assessmentPeriod(items),
        suggestion: result.status === 'needs_practice' ? { ...entry } : null,
        sinceIntervention: sinceIntervention(competency, language, interventions, items, rules),
      });
    }
  }
  const rank = o => [o.level === 'pattern' ? 0 : 1, PRIORITY.indexOf(o.competency), o.language === 'en' ? 0 : 1];
  const compare = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const needs = observations.filter(o => o.status === 'needs_practice').sort(compare);
  const suggestions = needs.slice(0, rules.maxSuggestions).map((o, index) => ({ ...o, priority: index + 1 }));
  const hasAnyData = languages.some(l => l.hasData);
  return {
    rules,
    languages,
    suggestions,
    additionalNeeds: needs.slice(rules.maxSuggestions).map(o => ({ id: o.id, competencyName: o.competencyName, languageName: o.languageName, level: o.level })),
    improving: observations.filter(o => o.status === 'improving'),
    moreDataNeeded: !hasAnyData || (!needs.length && languages.some(l => l.hasData && QUESTION_TYPES.some(t => l.comprehension[t].status === 'insufficient'))),
    hasAnyData,
    notes: [
      ...(invalid ? [`${plural(invalid, 'saved assessment')} could not be validated and ${invalid === 1 ? 'was' : 'were'} not used.`] : []),
      ...(unknownLanguage ? [`${plural(unknownLanguage, 'saved result')} without a recorded language ${unknownLanguage === 1 ? 'was' : 'were'} not used.`] : []),
    ],
  };
}

function improvingText(competency, result, language, rules) {
  if (competency === 'word_recognition') {
    const latest = result.evidence.readings[result.evidence.readings.length - 1];
    return `Average reading accuracy ${result.evidence.accuracy}% across the last ${plural(result.evidence.readings.length, LANGUAGE_NAMES[language] + ' reading')} (latest ${Math.round(latest.accuracy)}%; minimum ${rules.wordRecognitionMinAccuracy}%), after earlier readings below the minimum.`;
  }
  const latest = result.evidence.assessments[result.evidence.assessments.length - 1];
  const { evidence } = result;
  return `${evidence.correct}/${evidence.total} ${competency} questions correct on the first try across the last ${plural(evidence.assessments.length, LANGUAGE_NAMES[language] + ' assessment')} (${evidence.percent}%; benchmark ${rules.comprehensionBenchmark}%), after earlier results below the benchmark.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Loading (server side, after the route has authorized the viewer for this learner).

const READING_COLUMNS = 'id,user_id,room_id,language_snapshot,completed_at,pronunciation_accuracy,reading_speed_wpm,word_metrics,passage_title_snapshot,module_title_snapshot';

/**
 * Loads one learner's evidence and evaluates it.
 *   include(row): which saved rows count for this viewer (e.g. the Teacher's own classrooms). Applied to both
 *                 comprehension attempts and readings, before anything is computed.
 *   interventions: the viewer's own saved interventions for this learner (for "results since the intervention").
 */
async function suggestionsFor(learnerId, { include, interventions = [], deps = {} } = {}) {
  const analytics = deps.analytics || require('./m7Analytics');
  const getAdmin = deps.getAdmin || (() => require('./supabaseAdmin').getSupabaseAdmin());
  const getPlacement = deps.getPlacement || require('./currentReadingLevelService').getPlacement;
  const languages = new Map();
  // The counted assessments come from the shared M7 path (one per activity, validated first answers); the
  // attempt rows it reads also give each assessment's language, which that path does not return.
  const load = async (table, columns, filters) => {
    const rows = await analytics.rows(table, columns, filters);
    if (table === 'm6_comprehension_attempts') for (const row of rows) languages.set(row.id, row.language);
    return rows;
  };
  const [counted, readings] = await Promise.all([
    analytics.quizzes({ user_id: learnerId }, { include, rows: load }),
    analytics.rows('oral_reading_attempts', READING_COLUMNS, { user_id: learnerId }),
  ]);
  const quizzes = counted.map(q => ({ ...q, language: languages.get(q.id) ?? null }));
  const ownReadings = readings.filter(include);
  const englishIds = ownReadings.filter(r => r.language_snapshot === 'en').map(r => r.id);
  const practiceChecks = [];
  for (let i = 0; i < englishIds.length; i += 100) {
    const { data, error } = await getAdmin().from('oral_reading_pronunciation_checks').select('attempt_id,words_to_practice,status')
      .in('attempt_id', englishIds.slice(i, i + 100)).eq('user_id', learnerId).eq('status', 'completed');
    // The pronunciation-check table is optional evidence: without it, the word list falls back to the alignment.
    if (!error && Array.isArray(data)) practiceChecks.push(...data);
  }
  const placements = {};
  await Promise.all(LANGUAGES.map(async language => {
    try {
      const placement = await getPlacement(learnerId, language);
      if (placement?.status === 'ready') placements[language] = { readingLevel: placement.readingLevel, difficultyTier: placement.difficultyTier, source: placement.source };
    } catch { /* Context only: an unavailable placement never blocks suggestions. */ }
  }));
  return { generatedAt: new Date().toISOString(), ...evaluate({ quizzes, readings: ownReadings, practiceChecks, placements, interventions }) };
}

// ---------------------------------------------------------------------------------------------------------------
// Learner view (Students and Independent Learners): their own results only, in simple words. No labels such as
// "at risk" or "repeated difficulty", no Teacher activities and no intervention records.

const KID_TYPES = Object.freeze({ literal: 'story detail', inferential: 'clue', critical: 'thinking' });
const LEARNER_TIPS = Object.freeze({
  literal: { title: 'Find the story details', steps: ['Who is in the story? Where and when does it happen?', 'What happened first, next and last?', 'Look back at the story to find the sentence with the answer.'] },
  inferential: { title: 'Look for clues', steps: ['Before you read on, guess what will happen next. Then read to check.', 'Find the words that show how a character feels.', 'Ask yourself: What is the story telling me without saying it?'] },
  critical: { title: 'Explain your answer', steps: ['Ask yourself: Was it a good choice? Why or why not?', 'Find a sentence in the story that helps you explain.', 'Tell what the story says, then tell what you think about it.'] },
  word_recognition: {
    en: { title: 'Practise tricky words', steps: ['Read the story again slowly.', 'Say each tricky word in small parts, then say the whole word.', 'Read the sentence with the word again.'] },
    fil: { title: 'Sanayin ang mahihirap na salita', steps: ['Basahin muli ang kuwento nang dahan-dahan.', 'Hatiin ang salita sa pantig (halimbawa: ba-hay), saka basahin nang buo.', 'Basahin muli ang buong pangungusap.'] },
  },
});

function learnerItem(o) {
  const entry = o.competency === 'word_recognition' ? LEARNER_TIPS.word_recognition[o.language] : LEARNER_TIPS[o.competency];
  const e = o.evidence;
  const where = o.languageName;
  let basedOn;
  if (o.competency === 'word_recognition') {
    basedOn = e.readings.length === 1 ? `In your latest ${where} reading, ${Math.round(e.readings[0].accuracy)}% of the words matched the story.`
      : `In your last ${e.readings.length} ${where} readings, about ${e.accuracy}% of the words matched the story.`;
  } else {
    basedOn = e.assessments.length === 1
      ? `In your latest ${where} story, you got ${e.correct} of ${e.total} ${KID_TYPES[o.competency]} questions right on the first try.`
      : `In your last ${e.assessments.length} ${where} stories, you got ${e.correct} of ${e.total} ${KID_TYPES[o.competency]} questions right on the first try.`;
  }
  return {
    id: o.id, competency: o.competency, language: o.language, languageName: o.languageName, title: entry.title, steps: entry.steps, basedOn,
    note: o.status === 'improving' ? 'Great progress! Keep reading to stay strong.'
      : o.level === 'pattern' ? 'This came up in more than one story, so it is a good skill to practise.'
      : 'This is from only one story so far. Keep reading so we can see how you do.',
    words: o.competency === 'word_recognition' ? (e.wordsReadDifferently || []).map(w => w.word).slice(0, 6) : [],
  };
}

/** The learner's own suggestions in simple words. Fluency is never included (no approved benchmark). */
function learnerView(evaluation) {
  return {
    generatedAt: evaluation.generatedAt, hasAnyData: evaluation.hasAnyData, moreDataNeeded: evaluation.moreDataNeeded,
    tips: evaluation.suggestions.filter(o => o.competency !== 'fluency').map(learnerItem),
    improving: evaluation.improving.filter(o => o.competency !== 'fluency').map(learnerItem),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// System Admin: platform-wide counts only (no names, ids, titles or words).

async function platformSummary({ deps = {} } = {}) {
  const analytics = deps.analytics || require('./m7Analytics');
  const learners = await analytics.rows('profiles', 'id,role', { role: ['student', 'general_user'] });
  const roleOf = new Map(learners.map(p => [p.id, p.role]));
  const languages = new Map();
  const load = async (table, columns, filters) => {
    const rows = await analytics.rows(table, columns, filters);
    if (table === 'm6_comprehension_attempts') for (const row of rows) languages.set(row.id, row.language);
    return rows;
  };
  const [counted, readings] = await Promise.all([
    analytics.quizzes({}, { include: a => roleOf.has(a.user_id), rows: load }),
    analytics.rows('oral_reading_attempts', READING_COLUMNS, {}),
  ]);
  const byLearner = new Map(learners.map(p => [p.id, { quizzes: [], readings: [] }]));
  for (const q of counted) byLearner.get(q.userId)?.quizzes.push({ ...q, language: languages.get(q.id) ?? null });
  for (const r of readings) byLearner.get(r.user_id)?.readings.push(r);
  const group = () => ({ learners: 0, withSuggestion: 0, withRepeated: 0, preliminaryOnly: 0, improving: 0, moreDataNeeded: 0, noData: 0, onTrack: 0 });
  const totals = { student: group(), general_user: group() };
  const needs = new Map();
  for (const [id, data] of byLearner) {
    const role = roleOf.get(id);
    const result = evaluate(data);
    const t = totals[role];
    t.learners += 1;
    if (!result.hasAnyData) t.noData += 1;
    else if (result.suggestions.length) t.withSuggestion += 1;
    else if (result.moreDataNeeded) t.moreDataNeeded += 1;
    else t.onTrack += 1;
    if (result.improving.length) t.improving += 1;
    const levels = [...result.suggestions, ...result.additionalNeeds].map(n => n.level);
    if (levels.includes('pattern')) t.withRepeated += 1;
    else if (levels.length) t.preliminaryOnly += 1;
    for (const need of [...result.suggestions, ...result.additionalNeeds]) {
      const [language, competency] = need.id.split(':');
      if (!needs.has(need.id)) needs.set(need.id, { competency, competencyName: COMPETENCIES[competency], language, languageName: LANGUAGE_NAMES[language],
        student: { pattern: 0, preliminary: 0 }, general_user: { pattern: 0, preliminary: 0 } });
      needs.get(need.id)[role][need.level === 'pattern' ? 'pattern' : 'preliminary'] += 1;
    }
  }
  const order = o => PRIORITY.indexOf(o.competency) * 2 + (o.language === 'en' ? 0 : 1);
  return { generatedAt: new Date().toISOString(), rules: RULES, students: totals.student, independentLearners: totals.general_user,
    needs: [...needs.values()].sort((a, b) => order(a) - order(b)) };
}

/**
 * System Admin, one Independent Learner: the full read-only evaluation minus anything from the learner's private
 * text. Titles of the learner's own uploaded material become "Own reading material"; word lists are removed.
 */
function systemAdminProjection(evaluation, { attempts, readings, moduleTitles }) {
  const titleOf = new Map([...attempts, ...readings].map(row => [row.id, row.module_id ? (moduleTitles.get(row.module_id) || 'Reading module') : 'Own reading material']));
  const cleanEvidence = e => ({ ...e, wordsReadDifferently: [], pronunciationPracticeWords: [],
    ...(e.assessments ? { assessments: e.assessments.map(a => ({ ...a, title: titleOf.get(a.id) || 'Reading module' })) } : {}),
    ...(e.readings ? { readings: e.readings.map(r => ({ ...r, title: titleOf.get(r.id) || 'Reading module' })) } : {}) });
  const clean = o => ({ ...o, sinceIntervention: null, evidence: cleanEvidence(o.evidence) });
  const cleanCategory = c => ({ ...c, evidence: cleanEvidence(c.evidence) });
  return { ...evaluation, suggestions: evaluation.suggestions.map(clean), improving: evaluation.improving.map(clean),
    languages: evaluation.languages.map(l => ({ ...l, comprehension: Object.fromEntries(Object.entries(l.comprehension).map(([k, c]) => [k, cleanCategory(c)])),
      wordRecognition: cleanCategory(l.wordRecognition), fluency: cleanCategory(l.fluency) })) };
}

module.exports = { learnerView, platformSummary, systemAdminProjection, LEARNER_TIPS, RULES, CATALOG, COMPETENCIES, LANGUAGE_NAMES, PRIORITY, evaluate, evaluateCategory, evaluateReading, wordsReadDifferently, suggestionsFor };
