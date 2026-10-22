const { getSupabaseAdmin } = require('./supabaseAdmin');
const { summarizeComprehension } = require('./comprehensionScoring');
const { deriveAssignedProgress } = require('./assignedReadingProgress');
const { classifyRisk, compareCompletedQuizzes } = require('./m7Risk');
function fail(message, statusCode = 500) { return Object.assign(new Error(message), { statusCode }); }
async function rows(table, columns = '*', filters = {}, db = getSupabaseAdmin()) {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    let query = db.from(table).select(columns);
    for (const [key, value] of Object.entries(filters)) query = Array.isArray(value) ? query.in(key, value) : query.eq(key, value);
    const { data, error } = await query.order('id').range(offset, offset + 499);
    if (error) throw fail(`Unable to load ${table}. Check the M7 migration and retry.`);
    all.push(...data);
    if (data.length < 500) return all;
  }
}
const mean = values => { const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v)); return valid.length ? Math.round(valid.reduce((a,b) => a+b, 0) / valid.length * 100) / 100 : null; };
async function quizzes(filters = {}, options = {}) {
  const load = options.rows || rows;
  const attempts = (await load('m6_comprehension_attempts', '*', { ...filters, status: 'completed' })).filter(options.include || (() => true));
  const results = [];
  for (let i = 0; i < attempts.length; i += 100) {
    const batch = attempts.slice(i, i + 100);
    const responses = await load('m6_comprehension_responses', '*', { attempt_id: batch.map(a => a.id) });
    for (const a of batch) {
      const identity = { id: a.id, userId: a.user_id, roomId: a.room_id, title: a.passage_title,
        status: a.status, completedAt: a.completed_at };
      try {
        const score = summarizeComprehension(a.question_snapshot, responses.filter(r => r.attempt_id === a.id));
        if (score.answered !== score.totalQuestions || !score.allResolved || !Number.isFinite(Date.parse(a.completed_at))) {
          throw new Error('Incomplete completed evidence');
        }
        results.push({ ...identity, score: score.firstAttemptPercentage,
          firstCorrect: score.firstCorrect, totalQuestions: score.totalQuestions, hintsUsed: score.hintsUsed, byType: score.byType });
      } catch {
        // Keep the record in the risk history: dropping it could invent recovery.
        results.push({ ...identity, score: null, byType: {}, dataQuality: 'Invalid completed assessment evidence' });
      }
    }
  }
  return results.sort((a, b) => {
    if (a.dataQuality && b.dataQuality) return a.id.localeCompare(b.id);
    if (a.dataQuality) return 1;
    if (b.dataQuality) return -1;
    return compareCompletedQuizzes(a, b);
  });
}
async function teacherScope(teacherId) {
  const rooms = await rows('rooms', 'id,room_name', { teacher_id: teacherId });
  if (!rooms.length) return { rooms, students: [] };
  const enrollments = await rows('enrollments', 'id,student_id,room_id', { room_id: rooms.map(r => r.id) });
  const ids = [...new Set(enrollments.map(e => e.student_id))];
  const students = [];
  for (let i=0;i<ids.length;i+=100) students.push(...await rows('profiles', 'id,full_name,nickname', { id: ids.slice(i,i+100), role: 'student' }));
  return { rooms, students, enrollments };
}
async function requireStudent(teacherId, studentId) {
  const scope = await teacherScope(teacherId);
  if (!scope.students.some(s => s.id === studentId)) throw fail('Student not found in your classrooms.', 403);
  return scope;
}
async function personal(userId) {
  const [readings, quizResults, assignments, attempts] = await Promise.all([
    rows('oral_reading_attempts', 'id,user_id,room_id,material_id,activity_assignment_id,completed_at,pronunciation_accuracy,reading_speed_wpm,detected_error_count', { user_id: userId }),
    quizzes({ user_id: userId }), rows('reading_activity_assignments', '*', { student_id: userId }),
    rows('m6_comprehension_attempts', 'id,room_id,material_id,activity_assignment_id,oral_reading_attempt_id,status', { user_id: userId }),
  ]);
  const materialIds = [...new Set(assignments.map(a => a.material_id))];
  const materials = [];
  for (let i=0;i<materialIds.length;i+=100) materials.push(...await rows('uploaded_materials', 'id,title', { id: materialIds.slice(i,i+100) }));
  const activities = assignments.map(a => ({ ...deriveAssignedProgress(a, readings, attempts), id: a.id, title: materials.find(m => m.id === a.material_id)?.title || 'Assigned reading activity' }));
  return { summary: metrics(readings, quizResults), readings, quizzes: quizResults, activities };
}
function metrics(readings, quizResults) {
  return { readingAttempts: readings.length, completedQuizzes: quizResults.length,
    pronunciationAccuracy: mean(readings.map(r => Number(r.pronunciation_accuracy))), readingSpeedWpm: mean(readings.map(r => Number(r.reading_speed_wpm))),
    invalidCompletedQuizzes: quizResults.filter(q => q.dataQuality).length,
    comprehensionScore: quizResults.some(q => q.dataQuality) ? null : mean(quizResults.map(q => q.score)) };
}
async function system() {
  const [profiles, rooms, readings, quizResults, assignments] = await Promise.all([
    rows('profiles', 'id,role'), rows('rooms', 'id'), rows('oral_reading_attempts', 'id,pronunciation_accuracy,reading_speed_wpm'), quizzes(), rows('reading_activity_assignments', 'id'),
  ]);
  return { ...metrics(readings, quizResults), students: profiles.filter(p => p.role === 'student').length,
    teachers: profiles.filter(p => p.role === 'teacher').length, classrooms: rooms.length, assignedActivities: assignments.length };
}
async function teacher(teacherId) {
  const scope = await teacherScope(teacherId);
  if (!scope.students.length) return { students: [], notifications: [] };
  const [history, interventions] = await Promise.all([
    rows('m7_risk_events', '*', { teacher_id: teacherId }), rows('m7_interventions', '*', { teacher_id: teacherId }),
  ]);
  const students = [];
  for (const student of scope.students) {
    const roomIds = scope.enrollments.filter(e => e.student_id === student.id).map(e => e.room_id);
    const [allQuizzes, allReadings] = await Promise.all([
      quizzes({ user_id: student.id }, { include: a => !a.room_id || roomIds.includes(a.room_id) }),
      rows('oral_reading_attempts', 'id,room_id,pronunciation_accuracy,reading_speed_wpm', { user_id: student.id }),
    ]);
    // Match M5 visibility: enrolled learners' independent work and own-classroom work.
    const quizResults = allQuizzes.filter(q => !q.roomId || roomIds.includes(q.roomId));
    const readings = allReadings.filter(r => !r.room_id || roomIds.includes(r.room_id));
    const unavailable = quizResults.some(q => q.dataQuality);
    const risk = unavailable ? { classification: 'Evaluation unavailable' } : classifyRisk(quizResults);
    const competency = {};
    for (const type of ['literal','inferential','critical']) {
      const groups = quizResults.filter(q => !q.dataQuality).map(q => q.byType[type]);
      const total = groups.reduce((sum,g) => sum + g.total, 0);
      competency[type] = { total, score: !unavailable && total ? Math.round(groups.reduce((sum,g) => sum + g.firstCorrect,0) / total * 100) : null };
    }
    students.push({ ...student, ...metrics(readings,quizResults), classification: risk.classification,
      quizzes: quizResults, competency, history: history.filter(e => e.student_id === student.id), interventions: interventions.filter(i => i.student_id === student.id) });
  }
  return { students, notifications: history.filter(e => !e.superseded_at && !e.read_at && students.some(s => s.id === e.student_id)).sort((a,b) => b.occurred_at.localeCompare(a.occurred_at)) };
}
async function saveIntervention(teacherId, studentId, id, body) {
  await requireStudent(teacherId, studentId);
  const { notes, intervention_date, status, follow_up_date, follow_up_notes } = body || {};
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (typeof notes !== 'string' || !notes.trim() || notes.length > 10000 || !validDate(intervention_date)
    || !['planned','in_progress','completed'].includes(status) || (follow_up_date && !validDate(follow_up_date))
    || (follow_up_notes != null && (typeof follow_up_notes !== 'string' || follow_up_notes.length > 10000))) throw fail('Provide valid notes, dates, and intervention status.',400);
  const record = { notes: notes.trim(), intervention_date, status, follow_up_date: follow_up_date || null, follow_up_notes: follow_up_notes || '', updated_at: new Date().toISOString() };
  const db = getSupabaseAdmin();
  const query = id ? db.from('m7_interventions').update(record).eq('id',id).eq('teacher_id',teacherId).eq('student_id',studentId)
    : db.from('m7_interventions').insert({ ...record, teacher_id: teacherId, student_id: studentId });
  const { data, error } = await query.select().maybeSingle();
  if (error) throw fail('Unable to save intervention.');
  if (!data) throw fail('Intervention not found.',404);
  return data;
}
module.exports = { rows, quizzes, teacherScope, requireStudent, personal, system, teacher, saveIntervention, fail };
