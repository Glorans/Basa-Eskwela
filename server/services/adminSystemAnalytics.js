const { classifyRisk, compareCompletedQuizzes } = require('./m7Risk');
const { activeMaterialAssignments, activeRoomModules, deriveActivityProgress, expandModuleAssignments, withAssessmentRequirement } = require('./assignedReadingProgress');

const DAY = 86400000;
const PHT = 8 * 3600000;
const PRIORITY = { 'Evaluation unavailable': 4, 'On Track': 0, 'Early Warning': 1, 'At Risk': 2, 'Needs Support': 3 };
function invalid(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
function parseFilters(query = {}) {
  const roomId = query.roomId || null;
  if (roomId !== null && (typeof roomId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(roomId))) throw invalid('Choose a valid classroom.');
  function date(value) {
    if (!value) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw invalid('Use valid YYYY-MM-DD dates.');
    return value;
  }
  const startDate = date(query.startDate), endDate = date(query.endDate);
  if (startDate && endDate && startDate > endDate) throw invalid('Start date must be on or before end date.');
  return { roomId, startDate, endDate };
}
function within(timestamp, filters) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && (!filters.startDate || time >= Date.parse(filters.startDate) - PHT)
    && (!filters.endDate || time < Date.parse(filters.endDate) - PHT + DAY);
}
function average(values) {
  const valid = values.filter(v => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 100) / 100 : null;
}
function metrics(readings, quizzes) {
  return { readingAttempts: readings.length, completedQuizzes: quizzes.length,
    pronunciationAccuracy: average(readings.map(r => r.pronunciation_accuracy)),
    readingSpeedWpm: average(readings.map(r => r.reading_speed_wpm)), invalidCompletedQuizzes: quizzes.filter(q => q.dataQuality).length,
    comprehensionScore: quizzes.some(q => q.dataQuality) ? null : average(quizzes.map(q => q.score)) };
}
/**
 * One student's at-risk evaluation in each approved teacher's complete visibility
 * scope (that teacher's classrooms plus the student's independent work), exactly as
 * the Admin risk section counts it. With roomId, only that classroom's teacher.
 */
function studentRiskContexts(student, { memberships, roomById, profilesById, quizzesByStudent, roomId = null }) {
  const ownRooms = memberships.filter(e => e.student_id === student.id).map(e => roomById.get(e.room_id)).filter(Boolean);
  const teacherIds = [...new Set(ownRooms.filter(r => !roomId || r.id === roomId).map(r => r.teacher_id))];
  const contexts = [];
  for (const teacherId of teacherIds) {
    const teacher = profilesById.get(teacherId);
    if (teacher?.role !== 'teacher' || teacher.teacher_status !== 'approved') continue;
    const eligibleRooms = ownRooms.filter(r => r.teacher_id === teacherId);
    const ids = new Set(eligibleRooms.map(r => r.id));
    const eligible = (quizzesByStudent.get(student.id) || []).filter(q => !q.roomId || ids.has(q.roomId));
    if (!eligible.length) continue;
    if (!eligible.some(q => q.dataQuality)) eligible.sort(compareCompletedQuizzes);
    const result = eligible.some(q => q.dataQuality) ? { classification: 'Evaluation unavailable' } : classifyRisk(eligible);
    contexts.push({ teacherId, teacherName: teacher.full_name || 'Teacher', classrooms: eligibleRooms.map(r => r.room_name),
      classification: result.classification, recoveryCount: result.recoveryCount ?? 0, latestScores: eligible.slice(-3).map(q => ({ score: q.score, completedAt: q.completedAt })),
      completedQuizzes: eligible.length });
  }
  return contexts;
}
const worstContext = contexts => [...contexts].sort((a,b) => PRIORITY[b.classification] - PRIORITY[a.classification])[0];

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) { const id = key(item); if (!map.has(id)) map.set(id, []); map.get(id).push(item); }
  return map;
}

// Pure aggregation: only explicitly selected fields are returned to the administrator.
function buildAdminAnalytics(data, filters) {
  const { profiles, rooms, enrollments, readings, quizzes, assignments, attempts, interventions } = data;
  if (filters.roomId && !rooms.some(r => r.id === filters.roomId)) throw invalid('Classroom not found.');
  const students = profiles.filter(p => p.role === 'student');
  const studentIds = new Set(students.map(p => p.id));
  const profilesById = new Map(profiles.map(p => [p.id, p]));
  const roomById = new Map(rooms.map(r => [r.id, r]));
  const memberships = enrollments.filter(e => studentIds.has(e.student_id));
  const selectedRooms = rooms.filter(r => !filters.roomId || r.id === filters.roomId);
  const cohort = new Set(filters.roomId ? memberships.filter(e => e.room_id === filters.roomId).map(e => e.student_id) : students.map(s => s.id));
  const filteredReadings = readings.filter(r => (!filters.roomId || r.room_id === filters.roomId) && within(r.completed_at, filters));
  const filteredQuizzes = quizzes.filter(q => (!filters.roomId || q.roomId === filters.roomId) && within(q.completedAt, filters));
  const periodAssignments = assignments.filter(a => (!filters.roomId || a.room_id === filters.roomId) && within(a.assigned_at, filters));
  const readingsByStudent = groupBy(readings, r => r.user_id);
  const attemptsByStudent = groupBy(attempts, a => a.user_id);
  const quizzesByStudent = groupBy(quizzes, q => q.userId);
  const assignmentProgress = periodAssignments.map(a => ({ ...a,
    completed: deriveActivityProgress(a, readingsByStudent.get(a.student_id) || [], attemptsByStudent.get(a.student_id) || []).status === 'Completed' }));
  const participating = new Set([...filteredReadings.map(r => r.user_id), ...filteredQuizzes.map(q => q.userId)].filter(id => cohort.has(id)));
  function completion(list) {
    const completed = list.filter(a => a.completed).length;
    return { assigned: list.length, completed, incomplete: list.length - completed, completionRate: list.length ? Math.round(completed / list.length * 10000) / 100 : null };
  }
  const classroomComparisons = selectedRooms.map(room => {
    const members = new Set(memberships.filter(e => e.room_id === room.id).map(e => e.student_id));
    const roomReadings = filteredReadings.filter(r => r.room_id === room.id);
    const roomQuizzes = filteredQuizzes.filter(q => q.roomId === room.id);
    const active = new Set([...roomReadings.map(r => r.user_id), ...roomQuizzes.map(q => q.userId)].filter(id => members.has(id)));
    return { id: room.id, name: room.room_name, teacherName: profilesById.get(room.teacher_id)?.full_name || 'Teacher',
      enrolledStudents: members.size, participatingStudents: active.size,
      ...metrics(roomReadings, roomQuizzes), ...completion(assignmentProgress.filter(a => a.room_id === room.id)) };
  });
  // Weekly buckets contain observed data only. Empty buckets are not synthetic zero scores.
  const buckets = new Map();
  function bucket(timestamp) {
    const local = new Date(Date.parse(timestamp) + PHT);
    const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const key = monday.toISOString().slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, { weekStart: key, readings: [], quizzes: [] });
    return buckets.get(key);
  }
  filteredReadings.forEach(r => bucket(r.completed_at).readings.push(r));
  filteredQuizzes.forEach(q => bucket(q.completedAt).quizzes.push(q));
  const trends = [...buckets.values()].sort((a,b) => a.weekStart.localeCompare(b.weekStart))
    .map(b => ({ weekStart: b.weekStart, ...metrics(b.readings, b.quizzes) }));
  const riskCounts = { 'On Track': 0, 'Early Warning': 0, 'At Risk': 0, 'Needs Support': 0, 'No assessment data': 0, 'Evaluation unavailable': 0 };
  const supportStudents = [];
  for (const student of students.filter(s => cohort.has(s.id))) {
    const contexts = studentRiskContexts(student, { memberships, roomById, profilesById, quizzesByStudent, roomId: filters.roomId });
    const worst = worstContext(contexts);
    const classification = worst?.classification || 'No assessment data';
    riskCounts[classification]++;
    if (worst && PRIORITY[classification] > 0) {
      const contextTeachers = new Set(contexts.map(c => c.teacherId));
      const records = interventions.filter(i => i.student_id === student.id && contextTeachers.has(i.teacher_id));
      supportStudents.push({ id: student.id, name: student.full_name || student.nickname || 'Student', classification, contexts,
        interventions: { total: records.length, planned: records.filter(i => i.status === 'planned').length,
          inProgress: records.filter(i => i.status === 'in_progress').length, completed: records.filter(i => i.status === 'completed').length } });
    }
  }
  supportStudents.sort((a,b) => PRIORITY[b.classification] - PRIORITY[a.classification] || a.name.localeCompare(b.name));
  return {
    ...metrics(readings, quizzes), students: students.length, teachers: profiles.filter(p => p.role === 'teacher').length,
    classrooms: rooms.length, assignedActivities: assignments.length,
    details: { filters, generatedAt: new Date().toISOString(),
      classroomOptions: rooms.map(r => ({ id: r.id, name: r.room_name })),
      performance: metrics(filteredReadings, filteredQuizzes), trends, classroomComparisons,
      participation: { students: cohort.size, participatingStudents: participating.size, withoutRecordedActivity: cohort.size - participating.size,
        participationRate: cohort.size ? Math.round(participating.size / cohort.size * 10000) / 100 : null },
      completion: completion(assignmentProgress), riskCounts, supportStudents,
      independentPerformance: metrics(filteredReadings.filter(r => !r.room_id), filteredQuizzes.filter(q => !q.roomId)),
      unassignedClassroomReadings: filteredReadings.filter(r => r.room_id && !roomById.has(r.room_id)).length,
    },
  };
}
const requireAdmin = (requester) => {
  if (requester?.profile?.role !== 'admin') throw Object.assign(new Error('Admin access is required.'), { statusCode: 403 });
};
/** Everything the Admin views read. Selects only; intervention notes are not loaded here. */
async function loadAdminData(dependencies = {}) {
  const { rows, quizzes } = dependencies.rows ? dependencies : require('./m7Analytics');
  const [profiles, rooms, enrollments, readings, quizResults, materialAssignments, attempts, interventions, roomModules, recipients, passages, modules, questions, materials] = await Promise.all([
    rows('profiles', 'id,role,teacher_status,full_name,nickname'), rows('rooms', 'id,room_name,teacher_id'),
    rows('enrollments', 'id,student_id,room_id'),
    rows('oral_reading_attempts', 'id,user_id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,completed_at,pronunciation_accuracy,reading_speed_wpm,passage_title_snapshot,module_title_snapshot'),
    quizzes(), rows('reading_activity_assignments', '*'),
    rows('m6_comprehension_attempts', 'id,user_id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,oral_reading_attempt_id,status,created_at,completed_at'),
    rows('m7_interventions', 'id,teacher_id,student_id,status'),
    rows('room_modules', '*'), rows('room_module_recipients', 'room_module_id,student_id'), rows('module_passages', 'id,module_id'),
    rows('modules', 'id,title,status,deleted_at'), rows('comprehension_questions', 'id,passage_id', { review_status: 'reviewed' }), rows('uploaded_materials', 'id,title'),
  ]);
  const studentIds = new Set(profiles.filter(p => p.role === 'student').map(p => p.id));
  const enrolledIn = roomId => enrollments.filter(e => e.room_id === roomId && studentIds.has(e.student_id)).map(e => e.student_id);
  const titleOf = (list, id) => list.find((row) => row.id === id)?.title;
  const assignments = [
    ...activeMaterialAssignments(materialAssignments).map((a) => ({ ...a, title: titleOf(materials, a.material_id) })),
    ...expandModuleAssignments(activeRoomModules(roomModules, modules), recipients, withAssessmentRequirement(passages, questions), enrolledIn)
      .map((a) => ({ ...a, title: titleOf(modules, a.module_id) })),
  ];
  // Learner performance only: Admin self-practice (M5 readings, M6 comprehension) and any other
  // non-learner account's rows never enter system totals, trends, comparisons or participation.
  const learners = new Set(profiles.filter(p => p.role === 'student' || p.role === 'general_user').map(p => p.id));
  return { profiles, rooms, enrollments, readings: readings.filter(r => learners.has(r.user_id)),
    quizzes: quizResults.filter(q => learners.has(q.userId)), assignments,
    attempts: attempts.filter(a => learners.has(a.user_id)), interventions };
}
async function getAdminSystemAnalytics(requester, query = {}, dependencies = {}) {
  requireAdmin(requester);
  const filters = parseFilters(query);
  return buildAdminAnalytics(await loadAdminData(dependencies), filters);
}

// ---- Admin student performance (Student-role learners; Independent Learners are not included) ----
const QUESTION_TYPES = ['literal', 'inferential', 'critical'];
/**
 * Literal, inferential and critical results from validated first answers, as the Teacher
 * competency report counts them, plus the correct count. Invalid completed evidence makes
 * every score unavailable instead of counting it as wrong.
 */
function competencyOf(quizzes) {
  const unavailable = quizzes.some(q => q.dataQuality);
  return Object.fromEntries(QUESTION_TYPES.map(type => {
    const groups = quizzes.filter(q => !q.dataQuality).map(q => q.byType?.[type]).filter(Boolean);
    const total = groups.reduce((sum, g) => sum + g.total, 0);
    const correct = groups.reduce((sum, g) => sum + g.firstCorrect, 0);
    return [type, { total, correct: unavailable ? null : correct, score: !unavailable && total ? Math.round(correct / total * 100) : null }];
  }));
}
function adminIndexes(data) {
  const memberships = data.enrollments;
  return {
    memberships, roomById: new Map(data.rooms.map(r => [r.id, r])), profilesById: new Map(data.profiles.map(p => [p.id, p])),
    readingsByStudent: groupBy(data.readings, r => r.user_id), quizzesByStudent: groupBy(data.quizzes, q => q.userId),
    attemptsByStudent: groupBy(data.attempts, a => a.user_id), assignmentsByStudent: groupBy(data.assignments, a => a.student_id),
  };
}
function studentSummary(student, indexes) {
  const readings = indexes.readingsByStudent.get(student.id) || [];
  const quizzes = indexes.quizzesByStudent.get(student.id) || [];
  const contexts = studentRiskContexts(student, indexes);
  const assignments = (indexes.assignmentsByStudent.get(student.id) || [])
    .map(a => { const progress = deriveActivityProgress(a, readings, indexes.attemptsByStudent.get(student.id) || []); return { assignment: a, progress, status: progress.status }; });
  const completed = assignments.filter(a => a.status === 'Completed').length;
  return {
    id: student.id, name: student.full_name || student.nickname || 'Student',
    classrooms: indexes.memberships.filter(e => e.student_id === student.id).map(e => indexes.roomById.get(e.room_id)?.room_name).filter(Boolean),
    // No completed quiz in an approved teacher's scope is "No assessment data", never a low score.
    classification: worstContext(contexts)?.classification || 'No assessment data',
    ...metrics(readings, quizzes),
    completion: { assigned: assignments.length, completed, completionRate: assignments.length ? Math.round(completed / assignments.length * 10000) / 100 : null },
    contexts, readings, quizzes, assignments,
  };
}
/** Admin list: one row per Student-role learner, including learners with no results. */
function buildAdminStudents(data) {
  const indexes = adminIndexes(data);
  return data.profiles.filter(p => p.role === 'student').map(student => {
    const { contexts, readings, quizzes, assignments, ...row } = studentSummary(student, indexes);
    return row;
  }).sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * Admin detail for one Student-role learner. Interventions the Admin wrote are shown in
 * full; other authors' interventions are counted by status only (their notes are private).
 */
function buildAdminStudentDetail(data, studentId, adminId, ownInterventions = []) {
  const student = data.profiles.find(p => p.id === studentId && p.role === 'student');
  if (!student) throw Object.assign(new Error('Student not found.'), { statusCode: 404 });
  const { contexts, readings, quizzes, assignments, ...summary } = studentSummary(student, adminIndexes(data));
  const others = data.interventions.filter(i => i.student_id === studentId && i.teacher_id !== adminId);
  return {
    ...summary,
    competency: competencyOf(quizzes),
    contexts,
    quizzes: [...quizzes].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .map(q => ({ id: q.id, title: q.title, completedAt: q.completedAt, score: q.score, firstCorrect: q.firstCorrect ?? null, totalQuestions: q.totalQuestions ?? null, dataQuality: q.dataQuality ?? null })),
    readings: [...readings].sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
      .map(r => ({ id: r.id, completedAt: r.completed_at, readingAccuracy: Number(r.pronunciation_accuracy), readingSpeedWpm: Number(r.reading_speed_wpm), title: r.passage_title_snapshot || r.module_title_snapshot || 'Reading activity' })),
    activities: assignments.map(({ assignment, progress, status }) => ({ id: assignment.id, kind: assignment.kind ?? 'material', title: assignment.title || (assignment.kind === 'module' ? 'Assigned reading module' : 'Assigned reading activity'),
      roomName: data.rooms.find(r => r.id === assignment.room_id)?.room_name || 'Classroom', status, passagesCompleted: progress.passagesCompleted, passagesTotal: progress.passagesTotal })),
    interventions: {
      own: ownInterventions.filter(i => i.student_id === studentId && i.teacher_id === adminId),
      others: { total: others.length, planned: others.filter(i => i.status === 'planned').length,
        inProgress: others.filter(i => i.status === 'in_progress').length, completed: others.filter(i => i.status === 'completed').length },
    },
  };
}
module.exports = { getAdminSystemAnalytics, buildAdminAnalytics, parseFilters, loadAdminData, requireAdmin,
  buildAdminStudents, buildAdminStudentDetail, competencyOf, studentRiskContexts };
