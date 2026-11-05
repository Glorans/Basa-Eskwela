const { getSupabaseAdmin } = require('./supabaseAdmin');
const { summarizeComprehension } = require('./comprehensionScoring');
const { activeMaterialAssignments, activeRoomModules, deriveActivityProgress, expandModuleAssignments, withAssessmentRequirement } = require('./assignedReadingProgress');
const { classifyRisk, compareCompletedQuizzes, NO_ASSESSMENT_DATA } = require('./m7Risk');
const { splitCanonicalCompleted } = require('./comprehensionActivity');
const { isRiskWorkerEnabled } = require('./m7RiskWorker');
const { recipientRows } = require('./weeklyReportRows');
function fail(message, statusCode = 500) { return Object.assign(new Error(message), { statusCode }); }
async function rows(table, columns = '*', filters = {}, db = getSupabaseAdmin()) {
  // This table has a composite key and no id column to page by.
  if (table === 'room_module_recipients') return recipientRows(db, filters.room_module_id ?? null);
  const all = [];
  const entries = Object.entries(filters);
  const arrayFilters = entries.filter(([, value]) => Array.isArray(value));
  // Each IN list is bounded and deduplicated. Traverse combinations lazily
  // rather than constructing a potentially large cross-product in memory.
  async function readBatch(index, batches) {
    if (index < arrayFilters.length) {
      const [key, values] = arrayFilters[index];
      const unique = [...new Set(values)];
      for (let start = 0; start < unique.length; start += 50) {
        await readBatch(index + 1, { ...batches, [key]: unique.slice(start, start + 50) });
      }
      return;
    }
    let cursor = null;
    for (;;) {
      let query = db.from(table).select(columns).order('id', { ascending: true }).limit(100);
      for (const [key, value] of entries) {
        query = Array.isArray(value) ? query.in(key, batches[key]) : query.eq(key, value);
      }
      if (cursor !== null) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) throw fail(`Unable to load ${table}. Check the M7 migration and retry.`);
      if (!data.length) return;
      for (const row of data) {
        if (typeof row.id !== 'string' || (cursor !== null && row.id <= cursor)) {
          throw fail(`Invalid pagination while loading ${table}. Please retry.`);
        }
        cursor = row.id;
        all.push(row);
      }
    }
  }
  await readBatch(0, {});
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

const mean = values => { const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v)); return valid.length ? Math.round(valid.reduce((a,b) => a+b, 0) / valid.length * 100) / 100 : null; };
/** Validated first-answer results for the given completed attempts. */
async function scoreAttempts(attempts, load) {
  const results = [];
  for (let i = 0; i < attempts.length; i += 100) {
    const batch = attempts.slice(i, i + 100);
    const responses = await load('m6_comprehension_responses', '*', { attempt_id: batch.map(a => a.id) });
    for (const a of batch) {
      const identity = { id: a.id, userId: a.user_id, roomId: a.room_id, title: a.passage_title,
        status: a.status, completedAt: typeof a.completed_at === 'string' && Number.isFinite(Date.parse(a.completed_at))
          ? a.completed_at : null };
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
/**
 * Results that count: one assessment per learner and learning activity, chosen by M6's rule
 * before any scope or date filter, so a later extra attempt can never take its place.
 */
async function quizzes(filters = {}, options = {}) {
  const load = options.rows || rows;
  const { canonical } = splitCanonicalCompleted(await load('m6_comprehension_attempts', '*', { ...filters, status: 'completed' }));
  return scoreAttempts(canonical.filter(options.include || (() => true)), load);
}
/** Extra completed attempts saved before the one-assessment rule: viewable as saved, never counted. */
async function historicalQuizzes(filters = {}, options = {}) {
  const load = options.rows || rows;
  const { extra } = splitCanonicalCompleted(await load('m6_comprehension_attempts', '*', { ...filters, status: 'completed' }));
  return (await scoreAttempts(extra.filter(options.include || (() => true)), load)).map(q => ({ ...q, notCounted: true }));
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
  const [readings, quizResults, extraResults, assignments, attempts, enrollments] = await Promise.all([
    rows('oral_reading_attempts', 'id,user_id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,completed_at,pronunciation_accuracy,reading_speed_wpm,detected_error_count', { user_id: userId }),
    quizzes({ user_id: userId }), historicalQuizzes({ user_id: userId }), rows('reading_activity_assignments', '*', { student_id: userId }),
    rows('m6_comprehension_attempts', 'id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,oral_reading_attempt_id,status,created_at,completed_at', { user_id: userId }),
    rows('enrollments', 'id,room_id', { student_id: userId }),
  ]);
  const activities = await activityProgress(userId, assignments, enrollments, readings, attempts);
  return { summary: metrics(readings, quizResults), readings, quizzes: quizResults, historicalQuizzes: extraResults, activities };
}
/** Current progress on a learner's active assigned activities and modules, from saved work only. */
async function activityProgress(userId, assignments, enrollments, readings, attempts) {
  const activeAssignments = activeMaterialAssignments(assignments);
  const materialIds = [...new Set(activeAssignments.map(a => a.material_id))];
  const materials = [];
  for (let i=0;i<materialIds.length;i+=100) materials.push(...await rows('uploaded_materials', 'id,title', { id: materialIds.slice(i,i+100) }));
  const materialActivities = activeAssignments.map(a => ({ ...deriveActivityProgress(a, readings, attempts), id: a.id, title: materials.find(m => m.id === a.material_id)?.title || 'Assigned reading activity' }));
  const { assignments: moduleAssignments, titles } = await learnerModuleAssignments(userId, enrollments);
  const moduleActivities = moduleAssignments.map(a => ({ ...deriveActivityProgress(a, readings, attempts), id: a.id, title: titles.get(a.module_id) || 'Assigned reading module' }));
  return [...materialActivities, ...moduleActivities];
}
/** The learner's active classroom module assignments, with their passages and titles. */
async function learnerModuleAssignments(userId, enrollments) {
  const roomIds = enrollments.map(e => e.room_id);
  const assigned = roomIds.length ? await rows('room_modules', '*', { room_id: roomIds }) : [];
  if (!assigned.length) return { assignments: [], titles: new Map() };
  const modules = await rows('modules', 'id,title,status,deleted_at', { id: [...new Set(assigned.map(m => m.module_id))] });
  const roomModules = activeRoomModules(assigned, modules);
  if (!roomModules.length) return { assignments: [], titles: new Map() };
  const moduleIds = [...new Set(roomModules.map(m => m.module_id))];
  const [recipients, passages, questions] = await Promise.all([
    rows('room_module_recipients', 'room_module_id,student_id', { room_module_id: roomModules.map(m => m.id) }),
    rows('module_passages', 'id,module_id', { module_id: moduleIds }),
    rows('comprehension_questions', 'id,passage_id', { review_status: 'reviewed', module_id: moduleIds }),
  ]);
  return { assignments: expandModuleAssignments(roomModules, recipients, withAssessmentRequirement(passages, questions), () => [userId]), titles: new Map(modules.map(m => [m.id, m.title])) };
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
  const notificationsActive = isRiskWorkerEnabled();
  if (!scope.students.length) return { students: [], notifications: [], notificationsActive };
  const [history, interventions] = await Promise.all([
    rows('m7_risk_events', '*', { teacher_id: teacherId }), rows('m7_interventions', '*', { teacher_id: teacherId }),
  ]);
  const students = [];
  for (const student of scope.students) {
    const roomIds = scope.enrollments.filter(e => e.student_id === student.id).map(e => e.room_id);
    const inScope = { include: a => !a.room_id || roomIds.includes(a.room_id) };
    const [allQuizzes, extraResults, allReadings, activityRows, attemptRows] = await Promise.all([
      quizzes({ user_id: student.id }, inScope), historicalQuizzes({ user_id: student.id }, inScope),
      rows('oral_reading_attempts', 'id,room_id,module_id,passage_id,assignment_id,material_id,activity_assignment_id,completed_at,pronunciation_accuracy,reading_speed_wpm', { user_id: student.id }),
      roomIds.length ? rows('reading_activity_assignments', '*', { student_id: student.id, room_id: roomIds }) : [],
      rows('m6_comprehension_attempts', 'id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,oral_reading_attempt_id,status,created_at,completed_at', { user_id: student.id }),
    ]);
    // Match M5 visibility: enrolled learners' independent work and own-classroom work.
    const quizResults = allQuizzes.filter(q => !q.roomId || roomIds.includes(q.roomId));
    const readings = allReadings.filter(r => !r.room_id || roomIds.includes(r.room_id));
    const unavailable = quizResults.some(q => q.dataQuality);
    const risk = !quizResults.length ? { classification: NO_ASSESSMENT_DATA }
      : unavailable ? { classification: 'Evaluation unavailable' } : classifyRisk(quizResults);
    const activities = await activityProgress(student.id, activityRows, scope.enrollments.filter(e => e.student_id === student.id), readings, attemptRows);
    const competency = {};
    for (const type of ['literal','inferential','critical']) {
      const groups = quizResults.filter(q => !q.dataQuality).map(q => q.byType[type]);
      const total = groups.reduce((sum,g) => sum + g.total, 0);
      competency[type] = { total, score: !unavailable && total ? Math.round(groups.reduce((sum,g) => sum + g.firstCorrect,0) / total * 100) : null };
    }
    students.push({ ...student, ...metrics(readings,quizResults), classification: risk.classification, recoveryCount: risk.recoveryCount ?? 0,
      quizzes: quizResults, historicalQuizzes: extraResults, activities, competency, history: history.filter(e => e.student_id === student.id), interventions: interventions.filter(i => i.student_id === student.id) });
  }
  return { students, notifications: history.filter(e => !e.superseded_at && !e.read_at && students.some(s => s.id === e.student_id)).sort((a,b) => b.occurred_at.localeCompare(a.occurred_at)), notificationsActive };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Admin scope: any Student-role learner (single-school administration). Independent Learners are excluded. */
async function requireAdminStudent(studentId, load = rows) {
  if (typeof studentId !== 'string' || !UUID.test(studentId)) throw fail('Student not found.', 404);
  const found = await load('profiles', 'id,role', { id: studentId, role: 'student' });
  if (!found.length) throw fail('Student not found.', 404);
}
/**
 * The author (a Teacher, or an Admin through the Admin routes) is always the signed-in
 * user and is stored in teacher_id. Updates match the author, so nobody edits another
 * author's record. `authorize` checks the author's student scope before any write.
 */
async function saveIntervention(teacherId, studentId, id, body, { authorize } = {}) {
  await (authorize ? authorize() : requireStudent(teacherId, studentId));
  if (id !== null && id !== undefined && (typeof id !== 'string' || !UUID.test(id))) throw fail('Intervention not found.', 404);
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
module.exports = { rows, quizzes, historicalQuizzes, teacherScope, requireStudent, requireAdminStudent, personal, system, teacher, saveIntervention, fail };
