// Completed first-answer scores only; deterministic ties use the attempt UUID.
function compareCompletedQuizzes(a, b) {
  // PostgreSQL retains microseconds and permits timezone offsets. Date.parse alone
  // truncates sub-millisecond precision, while lexical ISO ordering mishandles offsets.
  const subMillisecond = value => Number((value.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0').slice(3, 9));
  return Date.parse(a.completedAt) - Date.parse(b.completedAt)
    || subMillisecond(a.completedAt) - subMillisecond(b.completedAt)
    || a.id.localeCompare(b.id);
}
function classifyRisk(quizzes) {
  let classification = 'On Track', low = 0, veryLow = 0, recovery = 0;
  const events = [];
  const ordered = quizzes.filter(q => q.status === 'completed' && q.completedAt && Number.isFinite(Date.parse(q.completedAt)) && Number.isFinite(q.score))
    .sort(compareCompletedQuizzes);
  ordered.forEach((quiz, index) => {
    const previous = classification;
    low = quiz.score < 75 ? low + 1 : 0;
    veryLow = quiz.score < 60 ? veryLow + 1 : 0;
    recovery = quiz.score >= 75 ? recovery + 1 : 0;
    const activeRisk = classification === 'At Risk' || classification === 'Needs Support';
    if (activeRisk) {
      if (recovery >= 2) classification = 'On Track';
      else if (veryLow >= 3) classification = 'Needs Support';
    } else {
      classification = veryLow >= 3 ? 'Needs Support' : low >= 3 ? 'At Risk' : low >= 2 ? 'Early Warning' : 'On Track';
    }
    if (classification !== previous) events.push({
      attempt_id: quiz.id, classification, previous_classification: previous,
      occurred_at: quiz.completedAt,
      evidence: ordered.slice(Math.max(0, index - 2), index + 1).map(q => ({ id: q.id, score: q.score, completedAt: q.completedAt })),
    });
  });
  return { classification, recoveryCount: recovery, events };
}
module.exports = { classifyRisk, compareCompletedQuizzes };
