const { classifyRisk, compareCompletedQuizzes } = require('./m7Risk');
const { deriveAssignedProgress } = require('./assignedReadingProgress');

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
    completed: deriveAssignedProgress(a, readingsByStudent.get(a.student_id) || [], attemptsByStudent.get(a.student_id) || []).status === 'Completed' }));
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
    // Match each teacher's complete visibility scope, even when filtering to one classroom.
    const ownRooms = memberships.filter(e => e.student_id === student.id).map(e => roomById.get(e.room_id)).filter(Boolean);
    const teacherIds = [...new Set(ownRooms.filter(r => !filters.roomId || r.id === filters.roomId).map(r => r.teacher_id))];
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
        classification: result.classification, latestScores: eligible.slice(-3).map(q => ({ score: q.score, completedAt: q.completedAt })),
        completedQuizzes: eligible.length });
    }
    const worst = [...contexts].sort((a,b) => PRIORITY[b.classification] - PRIORITY[a.classification])[0];
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
async function getAdminSystemAnalytics(requester, query = {}, dependencies = {}) {
  if (requester?.profile?.role !== 'admin') throw Object.assign(new Error('Admin access is required.'), { statusCode: 403 });
  const filters = parseFilters(query);
  const { rows, quizzes } = dependencies;
  const [profiles, rooms, enrollments, readings, quizResults, assignments, attempts, interventions] = await Promise.all([
    rows('profiles', 'id,role,teacher_status,full_name,nickname'), rows('rooms', 'id,room_name,teacher_id'),
    rows('enrollments', 'id,student_id,room_id'),
    rows('oral_reading_attempts', 'id,user_id,room_id,material_id,activity_assignment_id,completed_at,pronunciation_accuracy,reading_speed_wpm'),
    quizzes(), rows('reading_activity_assignments', 'id,student_id,room_id,material_id,assigned_at,status,read_aloud_only'),
    rows('m6_comprehension_attempts', 'id,user_id,room_id,material_id,activity_assignment_id,oral_reading_attempt_id,status'),
    rows('m7_interventions', 'id,teacher_id,student_id,status'),
  ]);
  // Learner performance only: Admin self-practice (M5 readings, M6 comprehension) and any other
  // non-learner account's rows never enter system totals, trends, comparisons or participation.
  const learners = new Set(profiles.filter(p => p.role === 'student' || p.role === 'general_user').map(p => p.id));
  return buildAdminAnalytics({ profiles, rooms, enrollments, readings: readings.filter(r => learners.has(r.user_id)),
    quizzes: quizResults.filter(q => learners.has(q.userId)), assignments,
    attempts: attempts.filter(a => learners.has(a.user_id)), interventions }, filters);
}
module.exports = { getAdminSystemAnalytics, buildAdminAnalytics, parseFilters };
