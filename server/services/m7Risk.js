// Completed first-answer scores only; deterministic ties use the attempt UUID.
function compareCompletedQuizzes(a, b) {
  // PostgreSQL retains microseconds and permits timezone offsets. Date.parse alone
  // truncates sub-millisecond precision, while lexical ISO ordering mishandles offsets.
  const subMillisecond = value => Number((value.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0').slice(3, 9));
  return Date.parse(a.completedAt) - Date.parse(b.completedAt)
    || subMillisecond(a.completedAt) - subMillisecond(b.completedAt)
    || a.id.localeCompare(b.id);
}

/*
 * Basa Eskwela's project-defined intervention classifications (not a DepEd classification),
 * using 75% as the minimum comprehension benchmark. The latest score decides, except that an
 * unresolved At Risk or Needs Support state stays until two scores in a row reach the benchmark.
 *   Needs Support: a score below 60, or two scores in a row below 75.
 *   At Risk:       a score below 75. Needs Support is never lowered to At Risk.
 *   Early Warning: latest score 75-79, with no unresolved risk.
 *   On Track:      latest score 80 or above, with no unresolved risk.
 * One recovery score keeps the current state; the second clears it, and that score then gives
 * On Track or Early Warning. A low score restarts recovery.
 * supabase/proposed/m7_risk_rules_canonical_PROPOSED.sql applies the same rules in the database.
 */
const BENCHMARK = 75;
const ON_TRACK_MINIMUM = 80;
const NEEDS_SUPPORT_BELOW = 60;
const RECOVERY_SCORES_REQUIRED = 2;
const NO_ASSESSMENT_DATA = 'No assessment data';
const UNRESOLVED = new Set(['At Risk', 'Needs Support']);

const byLatestScore = score => score >= ON_TRACK_MINIMUM ? 'On Track' : 'Early Warning';

function nextClassification(current, score, lowRun, recoveryRun) {
  if (score < NEEDS_SUPPORT_BELOW || lowRun >= 2) return 'Needs Support';
  if (score < BENCHMARK) return current === 'Needs Support' ? current : 'At Risk';
  return UNRESOLVED.has(current) && recoveryRun < RECOVERY_SCORES_REQUIRED ? current : byLatestScore(score);
}

/**
 * Only completed attempts with a valid score are evaluated: missing or invalid evidence is never
 * a low score. Without any, the result is "No assessment data", never On Track. Transitions start
 * from On Track because the saved events' previous classification has no "no data" state.
 */
function classifyRisk(quizzes) {
  const ordered = quizzes.filter(q => q.status === 'completed' && q.completedAt && Number.isFinite(Date.parse(q.completedAt)) && Number.isFinite(q.score))
    .sort(compareCompletedQuizzes);
  if (!ordered.length) return { classification: NO_ASSESSMENT_DATA, recoveryCount: 0, events: [] };
  let classification = 'On Track', lowRun = 0, recoveryRun = 0;
  const events = [];
  ordered.forEach((quiz, index) => {
    const previous = classification;
    lowRun = quiz.score < BENCHMARK ? lowRun + 1 : 0;
    recoveryRun = quiz.score >= BENCHMARK ? recoveryRun + 1 : 0;
    classification = nextClassification(previous, quiz.score, lowRun, recoveryRun);
    if (classification !== previous) events.push({
      attempt_id: quiz.id, classification, previous_classification: previous,
      occurred_at: quiz.completedAt,
      evidence: ordered.slice(Math.max(0, index - 2), index + 1).map(q => ({ id: q.id, score: q.score, completedAt: q.completedAt })),
    });
  });
  // How far an unresolved state is through recovery; 0 when there is none to report.
  return { classification, recoveryCount: UNRESOLVED.has(classification) ? recoveryRun : 0, events };
}
module.exports = { classifyRisk, compareCompletedQuizzes, NO_ASSESSMENT_DATA, RECOVERY_SCORES_REQUIRED };
