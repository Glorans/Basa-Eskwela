const { getSupabaseAdmin } = require('./supabaseAdmin');
const { loadTeacherStudentProfiles, OralReadingAuthorizationError } = require('./oralReadingAttemptService');
const { reportRows } = require('./weeklyReportRows');
const { summarizeComprehension } = require('./comprehensionScoring');
const { splitCanonicalCompleted } = require('./comprehensionActivity');

// A quiz read model for M7, independent of M5's one-result-per-reading review.
async function getTeacherQuizzes(requester, dependencies = {}) {
  if (requester?.profile?.role !== 'teacher' || requester.profile.teacher_status !== 'approved') {
    throw new OralReadingAuthorizationError('Approved Teacher access is required.');
  }
  const db = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
  const students = await (dependencies.loadTeacherStudentProfiles ?? loadTeacherStudentProfiles)(db, requester.user.id, true);
  const load = dependencies.reportRows ?? reportRows;
  const attempts = await load(db, 'm6_comprehension_attempts',
    'id,user_id,module_id,passage_id,assignment_id,material_id,activity_assignment_id,room_id,passage_title,status,completed_at,question_snapshot',
    { status: 'completed' }, 'user_id', [...students.keys()]);
  const eligible = new Map();
  // One assessment per learning activity, as in M6.
  for (const quiz of splitCanonicalCompleted(attempts).canonical) {
    if (!students.has(quiz.user_id)) continue;
    // Enrollment authorizes access; only the saved room attributes the quiz.
    // Independent/legacy unattributed quizzes remain roomId: null.
    if (quiz.room_id != null && !students.roomsByStudent?.get(quiz.user_id)?.has(quiz.room_id)) continue;
    eligible.set(quiz.id, quiz);
  }
  const responses = await load(db, 'm6_comprehension_responses',
    'id,attempt_id,question_id,first_option_index,resolved,hint_used', {}, 'attempt_id', [...eligible.keys()]);
  return [...eligible.values()].map(quiz => {
    let score;
    try {
      score = summarizeComprehension(quiz.question_snapshot, responses.filter(r => r.attempt_id === quiz.id));
      if (score.answered !== score.totalQuestions || !score.allResolved || !Number.isFinite(Date.parse(quiz.completed_at))) {
        throw new Error('Incomplete completed evidence');
      }
    } catch {
      // Fail the analytics request explicitly instead of silently omitting a
      // completed quiz or presenting a fabricated/partial aggregate.
      throw Object.assign(new Error('Completed quiz evidence is incomplete or invalid. Teacher quiz analytics are unavailable until the saved evidence is corrected.'), { statusCode: 422 });
    }
    const student = students.get(quiz.user_id);
    return {
      attemptId: quiz.id, studentId: quiz.user_id, roomId: quiz.room_id ?? null,
      studentName: student.full_name || student.nickname || 'Student',
      moduleTitle: quiz.passage_title || 'Comprehension activity', completedAt: quiz.completed_at,
      correctAnswers: score.firstCorrect, totalQuestions: score.totalQuestions,
      scorePercentage: score.firstAttemptPercentage, hintsUsed: score.hintsUsed,
    };
  });
}
module.exports = { getTeacherQuizzes };
