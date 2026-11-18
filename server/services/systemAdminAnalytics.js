// M7 for the System Admin (Appendix N M7 F2 system-wide dashboard, F4 user performance dashboard).
// Reuses the M7 data layer (m7Analytics.rows/quizzes/personal, adminSystemAnalytics.competencyOf) with the service
// role behind authorizeSystemAdminRequest; no new database permission is involved.
//
// Privacy rules (enforced by the explicit projections below, not by the browser):
// - F2 platform overview: counts and averages only; no names, account ids or per-learner rows.
// - F4 covers Independent Learners (profiles.role = 'general_user') only: the System Admin administers them at
//   platform level (M1 scope). School Students stay with the School Admin and Teachers, so a Student, Teacher or
//   administrator id is answered exactly like an unknown id (404).
// - Never returned: recordings, transcripts, answers or answer keys, private material titles or text, and
//   intervention notes. A result from the learner's own uploaded material is labelled only "Own reading material".

const LEARNER_ROLES = new Set(['student', 'general_user']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 24 * 60 * 60 * 1000;
const PHT = 8 * 60 * 60 * 1000;
const READING_COLUMNS = 'id,user_id,module_id,material_id,completed_at,pronunciation_accuracy,reading_speed_wpm,detected_error_count';

function defaults() {
  const analytics = require('./m7Analytics');
  return { rows: analytics.rows, quizzes: analytics.quizzes, personal: analytics.personal, now: () => Date.now() };
}

const average = values => {
  const valid = values.filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 100) / 100 : null;
};
// Same definitions as the School Admin and learner dashboards (adminSystemAnalytics.metrics / m7Analytics.metrics).
function metrics(readings, quizzes) {
  return { readingAttempts: readings.length, completedQuizzes: quizzes.length,
    pronunciationAccuracy: average(readings.map(r => r.pronunciation_accuracy)),
    readingSpeedWpm: average(readings.map(r => r.reading_speed_wpm)), invalidCompletedQuizzes: quizzes.filter(q => q.dataQuality).length,
    comprehensionScore: quizzes.some(q => q.dataQuality) ? null : average(quizzes.map(q => q.score)) };
}
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const latest = values => values.filter(validTime).sort().at(-1) ?? null;
function notFound() { return Object.assign(new Error('Independent Learner not found.'), { statusCode: 404 }); }

/** F2: system-wide performance. Aggregates only. */
async function platformOverview(dependencies = {}) {
  const { rows, quizzes, now } = { ...defaults(), ...dependencies };
  const [profiles, modules, readings, quizResults] = await Promise.all([
    rows('profiles', 'id,role,teacher_status'), rows('modules', 'id,status,deleted_at'),
    rows('oral_reading_attempts', 'id,user_id,completed_at,pronunciation_accuracy,reading_speed_wpm'), quizzes(),
  ]);
  const roleOf = new Map(profiles.map(p => [p.id, p.role]));
  const count = role => profiles.filter(p => p.role === role).length;
  // Learner activity only (Students and Independent Learners); staff self-practice is not platform usage.
  const learnerReadings = readings.filter(r => LEARNER_ROLES.has(roleOf.get(r.user_id)));
  const learnerQuizzes = quizResults.filter(q => LEARNER_ROLES.has(roleOf.get(q.userId)));
  const byRole = role => metrics(learnerReadings.filter(r => roleOf.get(r.user_id) === role), learnerQuizzes.filter(q => roleOf.get(q.userId) === role));
  const activeSince = days => {
    const since = now() - days * DAY;
    return new Set([...learnerReadings.filter(r => validTime(r.completed_at) && Date.parse(r.completed_at) >= since).map(r => r.user_id),
      ...learnerQuizzes.filter(q => validTime(q.completedAt) && Date.parse(q.completedAt) >= since).map(q => q.userId)]).size;
  };
  // Weekly counts (Monday-start weeks, Philippine time), observed weeks only: an empty week is not a zero score.
  const weeks = new Map();
  const week = timestamp => {
    const local = new Date(Date.parse(timestamp) + PHT);
    const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const key = monday.toISOString().slice(0, 10);
    if (!weeks.has(key)) weeks.set(key, { weekStart: key, readings: 0, completedQuizzes: 0, activeLearners: new Set() });
    return weeks.get(key);
  };
  learnerReadings.filter(r => validTime(r.completed_at)).forEach(r => { const w = week(r.completed_at); w.readings++; w.activeLearners.add(r.user_id); });
  learnerQuizzes.filter(q => validTime(q.completedAt)).forEach(q => { const w = week(q.completedAt); w.completedQuizzes++; w.activeLearners.add(q.userId); });
  const live = modules.filter(m => !m.deleted_at);
  return {
    generatedAt: new Date(now()).toISOString(),
    users: { total: profiles.length, systemAdmins: count('system_admin'), schoolAdmins: count('admin'),
      teachers: count('teacher'), approvedTeachers: profiles.filter(p => p.role === 'teacher' && p.teacher_status === 'approved').length,
      students: count('student'), independentLearners: count('general_user'), withoutRole: profiles.filter(p => !p.role).length },
    modules: { published: live.filter(m => m.status === 'published').length, draft: live.filter(m => m.status === 'draft').length,
      archived: live.filter(m => m.status === 'archived').length, inTrash: modules.length - live.length },
    activity: { ...metrics(learnerReadings, learnerQuizzes), activeLearners7Days: activeSince(7), activeLearners30Days: activeSince(30) },
    students: byRole('student'),
    independentLearners: byRole('general_user'),
    weeklyActivity: [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-12)
      .map(w => ({ weekStart: w.weekStart, readings: w.readings, completedQuizzes: w.completedQuizzes, activeLearners: w.activeLearners.size })),
  };
}

/** F4: one row per Independent Learner, with the shared M7 metrics. */
async function independentLearners(dependencies = {}) {
  const { rows, quizzes } = { ...defaults(), ...dependencies };
  const learners = (await rows('profiles', 'id,role,full_name,nickname')).filter(p => p.role === 'general_user');
  const ids = new Set(learners.map(l => l.id));
  if (!ids.size) return [];
  const [readings, quizResults] = await Promise.all([
    rows('oral_reading_attempts', 'id,user_id,completed_at,pronunciation_accuracy,reading_speed_wpm', { user_id: [...ids] }),
    quizzes({}, { include: attempt => ids.has(attempt.user_id) }),
  ]);
  return learners.map(learner => {
    const own = readings.filter(r => r.user_id === learner.id), ownQuizzes = quizResults.filter(q => q.userId === learner.id);
    return { id: learner.id, name: learner.full_name || learner.nickname || 'Independent Learner', ...metrics(own, ownQuizzes),
      lastActivityAt: latest([...own.map(r => r.completed_at), ...ownQuizzes.map(q => q.completedAt)]) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** F4: one Independent Learner's results, projected to performance fields only. */
async function independentLearnerDetail(learnerId, dependencies = {}) {
  const { rows, personal } = { ...defaults(), ...dependencies };
  if (typeof learnerId !== 'string' || !UUID.test(learnerId)) throw notFound();
  const [profile] = await rows('profiles', 'id,role,full_name,nickname', { id: learnerId });
  if (!profile || profile.role !== 'general_user') throw notFound();
  // The learner's own progress computation (no classroom activities for Independent Learners).
  const data = await personal(learnerId, { includeActivities: false });
  const attempts = await rows('m6_comprehension_attempts', 'id,module_id,material_id', { user_id: learnerId });
  const moduleIds = [...new Set([...data.readings.map(r => r.module_id), ...attempts.map(a => a.module_id)].filter(Boolean))];
  const titles = new Map((moduleIds.length ? await rows('modules', 'id,title', { id: moduleIds }) : []).map(m => [m.id, m.title]));
  const attemptById = new Map(attempts.map(a => [a.id, a]));
  const source = ({ module_id: moduleId }) => moduleId
    ? { kind: 'module', title: titles.get(moduleId) || 'Reading module' }
    : { kind: 'own_material', title: 'Own reading material' };
  const quiz = q => ({ id: q.id, completedAt: q.completedAt, score: q.score, firstCorrect: q.firstCorrect, totalQuestions: q.totalQuestions,
    ...(q.dataQuality ? { dataQuality: q.dataQuality } : {}), source: source(attemptById.get(q.id) || {}) });
  const { competencyOf } = require('./adminSystemAnalytics');
  return {
    id: profile.id, name: profile.full_name || profile.nickname || 'Independent Learner',
    summary: data.summary,
    competency: competencyOf(data.quizzes),
    lastActivityAt: latest([...data.readings.map(r => r.completed_at), ...data.quizzes.map(q => q.completedAt)]),
    quizzes: data.quizzes.map(quiz),
    notCountedQuizzes: (data.historicalQuizzes || []).length,
    readings: data.readings.map(r => ({ id: r.id, completedAt: r.completed_at, readingAccuracy: r.pronunciation_accuracy ?? null,
      readingSpeedWpm: r.reading_speed_wpm ?? null, wordsDifferent: r.detected_error_count ?? null, source: source(r) }))
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))),
  };
}

module.exports = { platformOverview, independentLearners, independentLearnerDetail, READING_COLUMNS };
