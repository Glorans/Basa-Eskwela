const { getSupabaseAdmin } = require('./supabaseAdmin');
const { loadTeacherStudentProfiles, OralReadingAuthorizationError } = require('./oralReadingAttemptService');
const { reportRows } = require('./weeklyReportRows');
const { summarizeComprehension } = require('./comprehensionScoring');

// Reports count quiz IDs, independently of the single-result oral review model.
async function loadWeeklyComprehensions(requester, bounds, dependencies = {}) {
  if (requester?.profile?.role !== 'teacher' || requester.profile.teacher_status !== 'approved') {
    throw new OralReadingAuthorizationError('Approved Teacher access is required.');
  }
  const db = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const students = await loadTeacherStudentProfiles(db, requester.user.id, true);
  const attempts = await reportRows(db, 'm6_comprehension_attempts',
    'id,user_id,room_id,oral_reading_attempt_id,passage_title,status,completed_at,question_snapshot',
    { status: 'completed' }, 'user_id', [...students.keys()]);
  const eligible = new Map();
  for (const quiz of attempts) {
    if (quiz.room_id && !students.roomsByStudent?.get(quiz.user_id)?.has(quiz.room_id)) continue;
    const time = Date.parse(quiz.completed_at);
    if (!Number.isFinite(time)) throw new Error('Completed assessment date is invalid. Report was not generated.');
    if (time < bounds.start || time >= bounds.endExclusive) continue;
    eligible.set(quiz.id, quiz);
  }
  const responses = await reportRows(db, 'm6_comprehension_responses',
    'id,attempt_id,question_id,first_option_index,resolved,hint_used', {}, 'attempt_id', [...eligible.keys()]);
  return [...eligible.values()].map(quiz => {
    const score = summarizeComprehension(quiz.question_snapshot, responses.filter(r => r.attempt_id === quiz.id));
    if (score.answered !== score.totalQuestions || !score.allResolved) {
      throw new Error('Completed assessment evidence is incomplete. Report was not generated.');
    }
    const student = students.get(quiz.user_id);
    return { attemptId: quiz.id, oralReadingAttemptId: quiz.oral_reading_attempt_id,
      studentId: quiz.user_id, studentName: student.full_name || student.nickname || 'Student',
      moduleTitle: quiz.passage_title || 'Comprehension activity', completedAt: quiz.completed_at,
      correctAnswers: score.firstCorrect, totalQuestions: score.totalQuestions,
      scorePercentage: score.firstAttemptPercentage };
  });
}
module.exports = { loadWeeklyComprehensions };
