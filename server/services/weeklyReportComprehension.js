const { getSupabaseAdmin } = require('./supabaseAdmin');
const { loadTeacherStudentProfiles, OralReadingAuthorizationError } = require('./oralReadingAttemptService');
const { reportRows } = require('./weeklyReportRows');
const { summarizeComprehension } = require('./comprehensionScoring');
const { splitCanonicalCompleted } = require('./comprehensionActivity');
const { classifyRisk, NO_ASSESSMENT_DATA } = require('./m7Risk');
const ATTEMPT_COLUMNS = 'id,user_id,module_id,passage_id,assignment_id,material_id,activity_assignment_id,room_id,oral_reading_attempt_id,passage_title,status,completed_at,question_snapshot';

// Reports count quiz IDs, independently of the single-result oral review model.
async function loadWeeklyComprehensions(requester, bounds, dependencies = {}) {
  if (requester?.profile?.role !== 'teacher' || requester.profile.teacher_status !== 'approved') {
    throw new OralReadingAuthorizationError('Approved Teacher access is required.');
  }
  const db = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const students = await loadTeacherStudentProfiles(db, requester.user.id, true);
  const attempts = await reportRows(db, 'm6_comprehension_attempts',
    ATTEMPT_COLUMNS, { status: 'completed' }, 'user_id', [...students.keys()]);
  const eligible = new Map();
  // The one assessment per learning activity, chosen before the period filter (M6's rule).
  for (const quiz of splitCanonicalCompleted(attempts).canonical) {
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
/**
 * Each student's current classification when the report is generated, from the same full quiz
 * history as Student Support. Invalid evidence is "Evaluation unavailable", never a low score.
 */
async function loadWeeklyRiskSummary(requester, dependencies = {}) {
  if (requester?.profile?.role !== 'teacher' || requester.profile.teacher_status !== 'approved') {
    throw new OralReadingAuthorizationError('Approved Teacher access is required.');
  }
  const db = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
  const students = await loadTeacherStudentProfiles(db, requester.user.id, true);
  const attempts = await reportRows(db, 'm6_comprehension_attempts', ATTEMPT_COLUMNS, { status: 'completed' }, 'user_id', [...students.keys()]);
  const eligible = splitCanonicalCompleted(attempts).canonical
    .filter((quiz) => !quiz.room_id || students.roomsByStudent?.get(quiz.user_id)?.has(quiz.room_id));
  const responses = await reportRows(db, 'm6_comprehension_responses',
    'id,attempt_id,question_id,first_option_index,resolved,hint_used', {}, 'attempt_id', eligible.map((quiz) => quiz.id));
  return riskSummary([...students.entries()].map(([studentId, student]) => {
    const own = eligible.filter((quiz) => quiz.user_id === studentId);
    let invalid = false;
    const results = own.map((quiz) => {
      try {
        const score = summarizeComprehension(quiz.question_snapshot, responses.filter((r) => r.attempt_id === quiz.id));
        if (score.answered !== score.totalQuestions || !score.allResolved || !Number.isFinite(Date.parse(quiz.completed_at))) throw new Error('incomplete');
        return { id: quiz.id, status: 'completed', completedAt: quiz.completed_at, score: score.firstAttemptPercentage };
      } catch { invalid = true; return null; }
    });
    return { studentId, studentName: student.full_name || student.nickname || 'Student',
      classification: invalid ? 'Evaluation unavailable' : own.length ? classifyRisk(results).classification : NO_ASSESSMENT_DATA };
  }));
}
function riskSummary(students) {
  const counts = {};
  for (const student of students) counts[student.classification] = (counts[student.classification] ?? 0) + 1;
  return { counts, students: [...students].sort((a, b) => a.studentName.localeCompare(b.studentName)) };
}
module.exports = { loadWeeklyComprehensions, loadWeeklyRiskSummary, riskSummary };
