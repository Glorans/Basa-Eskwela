// M7 F10 suggested interventions (rule engine) and F11 intervention records. In-memory only; nothing is saved.
const test = require('node:test');
const assert = require('node:assert/strict');

const supabaseAdmin = require('../services/supabaseAdmin');
let currentDb = null;
test.mock.method(supabaseAdmin, 'getSupabaseAdmin', () => currentDb ?? assert.fail('no database in this test'));
const { RULES, evaluate, evaluateCategory, evaluateReading, suggestionsFor, wordsReadDifferently, learnerView, platformSummary, systemAdminProjection } = require('../services/m7Suggestions');
const analytics = require('../services/m7Analytics');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let seq = 0;
/** A counted assessment: per type [correct, total]. */
function quiz(day, language, types, extra = {}) {
  seq += 1;
  const byType = {};
  for (const type of ['literal', 'inferential', 'critical']) {
    const [firstCorrect, total] = types[type] ?? [0, 0];
    byType[type] = { total, firstCorrect, answered: total, resolved: total, hintsUsed: 0, firstAttemptPercentage: 0 };
  }
  return { id: id(seq), title: `Story ${seq}`, completedAt: `2026-11-${String(day).padStart(2, '0')}T01:00:00.000Z`, language, byType, score: 50, ...extra };
}
function reading(day, language, accuracy, wpm = 80, wrong = []) {
  seq += 1;
  return { id: id(seq), completed_at: `2026-11-${String(day).padStart(2, '0')}T00:45:00.000Z`, language_snapshot: language, pronunciation_accuracy: accuracy,
    reading_speed_wpm: wpm, passage_title_snapshot: `Reading ${seq}`, room_id: 'room',
    word_metrics: [{ type: 'match', expected: 'the', actual: 'the' }, ...wrong.map((w) => ({ type: 'substitution', expected: w, actual: 'x' }))] };
}

test('strong literal, weak critical across three assessments is a repeated critical pattern', () => {
  const quizzes = [quiz(3, 'en', { literal: [2, 2], inferential: [2, 2], critical: [0, 2] }),
    quiz(10, 'en', { literal: [2, 2], inferential: [1, 2], critical: [1, 2] }), quiz(17, 'en', { literal: [2, 2], inferential: [2, 2], critical: [0, 2] })];
  const result = evaluate({ quizzes });
  assert.equal(result.suggestions.length, 1);
  const [s] = result.suggestions;
  assert.equal(s.id, 'en:critical');
  assert.equal(s.level, 'pattern');
  assert.equal(s.moreEvidenceNeeded, false);
  assert.equal(s.suggestion.key, 'evidence_based_reading');
  assert.deepEqual([s.evidence.correct, s.evidence.total, s.evidence.assessmentsBelow], [1, 6, 3]);
  assert.match(s.evidenceText, /^1\/6 critical questions .* last 3 English assessments \(17%; benchmark 75%\)\. 3 of 3 were below/);
  assert.equal(result.languages[0].comprehension.literal.status, 'on_track');
  assert.equal(result.languages[0].comprehension.inferential.status, 'on_track', '5/6 = 83% is above the benchmark');
});

test('one weak assessment is only a preliminary observation and says more evidence is needed', () => {
  const result = evaluate({ quizzes: [quiz(18, 'en', { literal: [2, 2], inferential: [0, 2], critical: [2, 2] })] });
  const [s] = result.suggestions;
  assert.equal(s.id, 'en:inferential');
  assert.equal(s.level, 'preliminary');
  assert.equal(s.moreEvidenceNeeded, true);
  assert.equal(s.evidenceText, '0/2 inferential questions answered correctly on the first try in the latest completed English assessment.');
  assert.match(s.reason, /More assessments are needed to confirm a persistent pattern\./);
});

test('two assessments with 4 questions, both below 75%, are a repeated difficulty (Filipino can reach it with two passages)', () => {
  const result = evaluate({ quizzes: [quiz(9, 'fil', { critical: [0, 2] }), quiz(16, 'fil', { critical: [1, 2] })] });
  assert.deepEqual([result.suggestions[0].id, result.suggestions[0].level, result.suggestions[0].moreEvidenceNeeded], ['fil:critical', 'pattern', false]);
  assert.match(result.suggestions[0].reason, /repeated difficulty in recent results, not a permanent label/);
});

test('two assessments with only one below 75% stay preliminary; 3 questions in two assessments stay preliminary', () => {
  assert.equal(evaluate({ quizzes: [quiz(9, 'en', { critical: [0, 2] }), quiz(16, 'en', { critical: [1, 2] })] }).suggestions[0].level, 'pattern');
  assert.equal(evaluateCategory('critical', [quiz(9, 'en', { critical: [2, 2] }), quiz(16, 'en', { critical: [0, 2] }), quiz(20, 'en', { critical: [0, 2] })]).level, 'pattern');
  assert.equal(evaluateCategory('critical', [quiz(9, 'en', { critical: [2, 2] }), quiz(16, 'en', { critical: [2, 2] }), quiz(20, 'en', { critical: [0, 2] })]).level, 'preliminary', 'only one assessment below');
  assert.equal(evaluateCategory('critical', [quiz(9, 'en', { critical: [0, 1] }), quiz(16, 'en', { critical: [0, 2] })]).level, 'preliminary', 'only 3 questions');
});

test('fewer than two questions of a category is insufficient: no suggestion, more data needed', () => {
  const category = evaluateCategory('critical', [quiz(1, 'en', { critical: [0, 1] })]);
  assert.equal(category.status, 'insufficient');
  const result = evaluate({ quizzes: [quiz(1, 'en', { literal: [1, 1], critical: [0, 1] })] });
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.moreDataNeeded, true);
  const empty = evaluate({});
  assert.deepEqual([empty.hasAnyData, empty.moreDataNeeded, empty.suggestions.length], [false, true, 0]);
});

test('exactly the benchmark (75%) is not a need; one question below is', () => {
  assert.equal(evaluateCategory('literal', [quiz(1, 'en', { literal: [3, 4] })]).status, 'on_track');
  assert.equal(evaluateCategory('literal', [quiz(1, 'en', { literal: [2, 4] })]).status, 'needs_practice');
});

test('a small dip that stayed above the benchmark is on track, not "improving"', () => {
  const quizzes = [quiz(3, 'en', { inferential: [2, 2] }), quiz(10, 'en', { inferential: [1, 2] }), quiz(17, 'en', { inferential: [2, 2] })];
  assert.equal(evaluateCategory('inferential', quizzes).status, 'on_track');
});

test('only the latest three assessments are pooled, so recovery shows as improving (not a new suggestion)', () => {
  const quizzes = [quiz(2, 'en', { critical: [0, 2] }), quiz(5, 'en', { critical: [0, 2] }), quiz(12, 'en', { critical: [2, 2] }),
    quiz(19, 'en', { critical: [2, 2] }), quiz(21, 'en', { critical: [2, 2] })];
  const interventions = [{ id: 'iv', competency: 'critical', language: 'en', intervention_date: '2026-11-07', status: 'completed' }];
  const result = evaluate({ quizzes, interventions });
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.improving.length, 1);
  const [improving] = result.improving;
  assert.equal(improving.status, 'improving');
  assert.equal(improving.suggestion, null, 'no new activity is suggested for an improving competency');
  assert.deepEqual([improving.sinceIntervention.results, improving.sinceIntervention.correct, improving.sinceIntervention.total, improving.sinceIntervention.percent], [3, 6, 6, 100]);
});

test('word recognition: below 90% accuracy, repeated when two recent readings are below; words come from saved data', () => {
  const readings = [reading(5, 'en', 78, 61, ['morning']), reading(12, 'en', 82, 64, ['morning', 'together']), reading(19, 'en', 85, 66, ['beautiful'])];
  const checks = [{ attempt_id: readings[2].id, words_to_practice: ['nature', 'mountains'] }, { attempt_id: 'someone-else', words_to_practice: ['never'] }];
  const result = evaluate({ readings, practiceChecks: checks });
  const [s] = result.suggestions;
  assert.equal(s.id, 'en:word_recognition');
  assert.equal(s.level, 'pattern');
  assert.equal(s.suggestion.key, 'guided_rereading_words');
  assert.equal(s.evidence.accuracy, 82);
  assert.deepEqual(s.evidence.wordsReadDifferently.map((w) => w.word), ['morning', 'beautiful', 'together']);
  assert.deepEqual(s.evidence.pronunciationPracticeWords, ['nature', 'mountains'], 'only checks of these readings are used');
  assert.match(s.evidenceText, /Average reading accuracy 82% \(words matching the story\) across the last 3 English readings; 3 of 3 were below 90%\./);
});

test('Filipino is evaluated separately, uses the pantig activity and is never called pronunciation', () => {
  const quizzes = [quiz(4, 'en', { literal: [2, 2], inferential: [2, 2], critical: [2, 2] }),
    quiz(8, 'fil', { literal: [2, 2], inferential: [0, 2], critical: [1, 2] }), quiz(15, 'fil', { literal: [2, 2], inferential: [1, 2], critical: [1, 2] })];
  const readings = [reading(4, 'en', 97), reading(8, 'fil', 80, 55, ['regalo']), reading(15, 'fil', 84, 57, ['bote'])];
  const result = evaluate({ quizzes, readings });
  assert.ok(result.suggestions.every((s) => s.language === 'fil'), 'English is on track');
  assert.equal(result.suggestions[0].id, 'fil:word_recognition');
  assert.equal(result.suggestions[0].suggestion.key, 'guided_rereading_pantig');
  const shown = result.suggestions.map((s) => [s.competencyName, s.evidenceText, s.reason, s.suggestion.title, s.suggestion.activity, s.suggestion.approach].join(' ')).join(' ');
  assert.doesNotMatch(shown, /pronunciation/i);
  assert.deepEqual(result.suggestions[0].evidence.pronunciationPracticeWords, [], 'no English pronunciation words for Filipino');
  assert.equal(result.languages.find((l) => l.language === 'en').comprehension.inferential.status, 'on_track');
});

test('multiple needs: foundational first, repeated before preliminary, at most three suggestions', () => {
  const quizzes = [quiz(6, 'en', { literal: [1, 2], inferential: [0, 2], critical: [0, 2] }), quiz(13, 'en', { literal: [1, 2], inferential: [0, 2], critical: [1, 2] }),
    quiz(20, 'en', { literal: [0, 2], inferential: [1, 2], critical: [0, 2] })];
  const readings = [reading(6, 'en', 84), reading(20, 'en', 86)];
  const result = evaluate({ quizzes, readings });
  assert.deepEqual(result.suggestions.map((s) => [s.id, s.priority]), [['en:word_recognition', 1], ['en:literal', 2], ['en:inferential', 3]]);
  assert.deepEqual(result.additionalNeeds.map((n) => n.competencyName), ['Critical Comprehension']);
  // A repeated pattern outranks a preliminary foundational observation.
  const mixed = evaluate({ quizzes, readings: [reading(20, 'en', 86)] });
  assert.deepEqual(mixed.suggestions.map((s) => s.id), ['en:literal', 'en:inferential', 'en:critical']);
  assert.deepEqual(mixed.additionalNeeds, [{ id: 'en:word_recognition', competencyName: 'Word Recognition', languageName: 'English', level: 'preliminary' }]);
});

test('fluency is not evaluated without an approved benchmark, and works when one is configured', () => {
  const readings = [reading(1, 'en', 95, 40), reading(2, 'en', 96, 45)];
  assert.equal(RULES.fluencyMinWpm, null);
  const off = evaluate({ readings });
  assert.equal(off.languages[0].fluency.status, 'not_evaluated');
  assert.equal(off.suggestions.length, 0);
  const on = evaluate({ readings }, { ...RULES, fluencyMinWpm: 60 });
  assert.deepEqual([on.suggestions[0].id, on.suggestions[0].level, on.suggestions[0].suggestion.key], ['en:fluency', 'pattern', 'repeated_reading']);
});

test('invalid assessment evidence and results without a language are left out and reported', () => {
  const result = evaluate({ quizzes: [quiz(1, 'en', { critical: [0, 2] }, { dataQuality: 'Invalid completed assessment evidence' }), quiz(2, null, { critical: [0, 2] })] });
  assert.equal(result.suggestions.length, 0);
  assert.deepEqual(result.notes, ['1 saved assessment could not be validated and was not used.', '1 saved result without a recorded language was not used.']);
});

test('word list counts only words read differently or not heard, most frequent first, capped', () => {
  const readings = [{ word_metrics: [{ type: 'insertion', actual: 'um' }, { type: 'omission', expected: 'Bote' }, { type: 'substitution', expected: 'bote' }, { type: 'match', expected: 'ang' }, { type: 'substitution', expected: 'regalo' }] }];
  assert.deepEqual(wordsReadDifferently(readings, 1), [{ word: 'bote', times: 2 }]);
});

test('suggestionsFor applies the viewer scope before anything is computed and reads M2 as context only', async () => {
  const learner = id(500);
  const attempts = [{ id: id(1), user_id: learner, status: 'completed', room_id: 'mine', language: 'en' }, { id: id(2), user_id: learner, status: 'completed', room_id: 'other', language: 'en' }];
  const readingRows = [{ ...reading(3, 'en', 70), room_id: 'other' }, { ...reading(4, 'en', 95), room_id: 'mine' }];
  const deps = {
    analytics: {
      rows: async (table) => (table === 'm6_comprehension_attempts' ? attempts : table === 'oral_reading_attempts' ? readingRows : []),
      quizzes: async (filters, { include, rows }) => {
        const loaded = await rows('m6_comprehension_attempts', '*', filters);
        return loaded.filter(include).map((a) => ({ ...quiz(5, 'ignored', { critical: [0, 2] }), id: a.id }));
      },
    },
    getAdmin: () => ({ from: () => { const q = { select: () => q, in: () => q, eq: () => q, then: (r) => r({ data: [], error: null }) }; return q; } }),
    getPlacement: async (_user, language) => (language === 'en' ? { status: 'ready', readingLevel: 'Instructional', difficultyTier: 'Medium', source: 'initial' } : { status: 'missing' }),
  };
  const result = await suggestionsFor(learner, { include: (row) => row.room_id === 'mine', deps });
  const en = result.languages.find((l) => l.language === 'en');
  assert.equal(en.assessments, 1, "the other classroom's assessment is not used");
  assert.equal(en.readings, 1, "the other classroom's 70% reading is not used");
  assert.equal(en.wordRecognition.status, 'on_track');
  assert.deepEqual(en.placement, { readingLevel: 'Instructional', difficultyTier: 'Medium', source: 'initial' });
  assert.equal(result.languages.find((l) => l.language === 'fil').placement, null);
});

// ---- F11 saving ----
function saveDb(log, existing = null) {
  return { from(table) {
    const q = { table, action: 'select', filters: {},
      select() { return this; }, insert(row) { this.action = 'insert'; this.row = row; return this; }, update(row) { this.action = 'update'; this.row = row; return this; },
      eq(k, v) { this.filters[k] = v; return this; },
      async maybeSingle() { log.push({ table, action: this.action, row: this.row, filters: this.filters }); return { data: this.action === 'select' ? existing : { id: 'saved', ...this.row }, error: null }; },
    };
    return q;
  } };
}
const base = { notes: 'Evidence-based reading, 3 sessions', intervention_date: '2026-11-22', status: 'planned', follow_up_date: null, follow_up_notes: '' };
const authorize = async () => {};
const evaluation = () => evaluate({ quizzes: [quiz(18, 'en', { literal: [2, 2], inferential: [0, 2], critical: [2, 2] })] });

test('a chosen suggestion is re-evaluated on the server and stored as the server snapshot', async () => {
  const log = [];
  currentDb = saveDb(log);
  await analytics.saveIntervention('T', 'S', null, { ...base, suggestion_id: 'en:inferential', competency: 'critical', language: 'fil',
    suggestion_snapshot: { title: 'forged' }, teacher_notes: '  pair with a buddy ' }, { authorize, suggest: async () => evaluation() });
  const row = log[0].row;
  assert.deepEqual([row.competency, row.language, row.suggestion_key, row.status, row.teacher_notes], ['inferential', 'en', 'reading_between_lines', 'planned', 'pair with a buddy']);
  assert.equal(row.suggestion_snapshot.title, 'Reading Between the Lines', 'never the client-sent snapshot');
  assert.equal(row.suggestion_snapshot.evidenceText, '0/2 inferential questions answered correctly on the first try in the latest completed English assessment.');
  assert.equal(row.teacher_id, 'T');
});

test('a suggestion that is no longer current is refused (409) and nothing is written', async () => {
  const log = [];
  currentDb = saveDb(log);
  await assert.rejects(analytics.saveIntervention('T', 'S', null, { ...base, suggestion_id: 'en:critical' }, { authorize, suggest: async () => evaluation() }), { statusCode: 409 });
  await assert.rejects(analytics.saveIntervention('T', 'S', null, { ...base, suggestion_id: 'en:critical' }, { authorize }), { statusCode: 400 });
  assert.equal(log.length, 0);
});

test('new fields are validated; older clients without them keep working and never clear them', async () => {
  const log = [];
  currentDb = saveDb(log);
  for (const bad of [{ competency: 'spelling' }, { language: 'es' }, { follow_up_outcome: 'done' }, { teacher_notes: 5 }, { suggestion_id: 'en:everything' }]) {
    await assert.rejects(analytics.saveIntervention('T', 'S', null, { ...base, ...bad }, { authorize }), { statusCode: 400 });
  }
  await analytics.saveIntervention('T', 'S', id(7), base, { authorize });
  assert.deepEqual(Object.keys(log[0].row).sort(), ['follow_up_date', 'follow_up_notes', 'intervention_date', 'notes', 'status', 'updated_at']);
  assert.equal(log[0].action, 'update');
});

test('an update keeps the competency and language of a suggestion-based record and never completes it automatically', async () => {
  const log = [];
  currentDb = saveDb(log, { suggestion_key: 'evidence_based_reading', competency: 'critical', language: 'en' });
  await analytics.saveIntervention('T', 'S', id(8), { ...base, status: 'in_progress', competency: 'literal', language: 'fil', follow_up_outcome: 'too_early', suggestion_id: 'en:literal' }, { authorize });
  const update = log.find((entry) => entry.action === 'update');
  assert.deepEqual([update.row.competency, update.row.language, update.row.status, update.row.follow_up_outcome], ['critical', 'en', 'in_progress', 'too_early']);
  assert.equal('suggestion_key' in update.row, false, 'the chosen suggestion is never changed by an update');
  assert.deepEqual(update.filters, { id: id(8), teacher_id: 'T', student_id: 'S' });
});

test('learner view: simple words from own results, no labels, no Teacher activity, no fluency', () => {
  const evaluation = { generatedAt: 'now', ...evaluate({ quizzes: [quiz(3, 'en', { critical: [0, 2], literal: [2, 2] }), quiz(10, 'fil', { inferential: [0, 2] })],
    readings: [reading(4, 'fil', 80, 55, ['bote']), reading(11, 'fil', 82, 55, ['regalo'])] }) };
  const view = learnerView(evaluation);
  const text = JSON.stringify(view);
  assert.doesNotMatch(text, /at risk|At Risk|Needs Support|repeated difficulty|pattern|intervention|benchmark|Evidence-Based|fluency/i);
  assert.deepEqual(view.tips.map((t) => t.id), ['fil:word_recognition', 'fil:inferential', 'en:critical']);
  assert.equal(learnerView({ generatedAt: 'now', ...evaluate({ readings: [reading(1, 'en', 95, 20), reading(2, 'en', 95, 20)] }, { ...RULES, fluencyMinWpm: 90 }) }).tips.length, 0, 'fluency never reaches learners');
  const fil = view.tips[0];
  assert.equal(fil.title, 'Sanayin ang mahihirap na salita');
  assert.deepEqual(fil.words, ['bote', 'regalo']);
  assert.match(view.tips[2].basedOn, /^In your latest English story, you got 0 of 2 thinking questions right on the first try\.$/);
  assert.match(view.tips[2].note, /only one story so far/);
  assert.equal(learnerView({ generatedAt: 'now', ...evaluate({}) }).tips.length, 0);
});

test('platform summary: counts per role, competency and language; no names or ids', async () => {
  const S1 = id(901), S2 = id(902), IL = id(903), TEACHER = id(904);
  const attempts = [S1, S2, IL, TEACHER].map((user, i) => ({ id: id(950 + i), user_id: user, language: i === 2 ? 'fil' : 'en', status: 'completed' }));
  const deps = { analytics: {
    rows: async (table, _c, filters) => table === 'profiles' ? [{ id: S1, role: 'student' }, { id: S2, role: 'student' }, { id: IL, role: 'general_user' }].filter((p) => filters.role.includes(p.role))
      : table === 'm6_comprehension_attempts' ? attempts : table === 'oral_reading_attempts' ? [{ ...reading(5, 'en', 70), user_id: S2 }] : [],
    quizzes: async (_f, { include, rows }) => (await rows('m6_comprehension_attempts', '*', {})).filter(include)
      .map((a) => ({ ...quiz(5, 'x', { critical: a.user_id === S1 ? [2, 2] : [0, 2] }), id: a.id, userId: a.user_id })),
  } };
  const summary = await platformSummary({ deps });
  assert.deepEqual([summary.students.learners, summary.students.withSuggestion, summary.students.onTrack, summary.independentLearners.withSuggestion], [2, 1, 0, 1]);
  assert.equal(summary.students.moreDataNeeded, 1, 'a Student with only critical questions needs more data for the other types');
  assert.deepEqual([summary.students.withRepeated, summary.students.preliminaryOnly, summary.independentLearners.withRepeated, summary.independentLearners.preliminaryOnly], [0, 1, 0, 1]);
  assert.deepEqual(summary.needs.map((n) => [n.competency, n.language, n.student.preliminary, n.general_user.preliminary]),
    [['word_recognition', 'en', 1, 0], ['critical', 'en', 1, 0], ['critical', 'fil', 0, 1]]);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp([S1, S2, IL, TEACHER].join('|')), 'no learner ids');
});

test('System Admin projection hides own-material titles and every word list', () => {
  const own = quiz(5, 'en', { critical: [0, 2] }), mod = quiz(9, 'en', { critical: [0, 2] });
  const r = reading(6, 'en', 70, 80, ['secret']);
  const evaluation = evaluate({ quizzes: [own, mod], readings: [r], practiceChecks: [{ attempt_id: r.id, words_to_practice: ['private'] }] });
  const out = systemAdminProjection(evaluation, { attempts: [{ id: own.id, module_id: null }, { id: mod.id, module_id: 'm1' }], readings: [{ id: r.id, module_id: null }], moduleTitles: new Map([['m1', 'Early Start']]) });
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /secret|private|Story \d|Reading \d/);
  assert.deepEqual(out.suggestions.find((s) => s.competency === 'critical').evidence.assessments.map((a) => a.title), ['Own reading material', 'Early Start']);
});
