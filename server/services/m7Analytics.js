const { getSupabaseAdmin } = require('./supabaseAdmin');
const { summarizeComprehension } = require('./comprehensionScoring');
const { activeMaterialAssignments, activeRoomModules, deriveActivityProgress, expandModuleAssignments, withAssessmentRequirement } = require('./assignedReadingProgress');
const { classifyRisk, compareCompletedQuizzes, NO_ASSESSMENT_DATA } = require('./m7Risk');
const { splitCanonicalCompleted } = require('./comprehensionActivity');
const { isRiskWorkerEnabled } = require('./m7RiskWorker');
const { recipientRows } = require('./weeklyReportRows');
const BATCH_CONCURRENCY = 3;
function fail(message, statusCode = 500) { return Object.assign(new Error(message), { statusCode }); }
async function rows(table, columns = '*', filters = {}, db = getSupabaseAdmin()) {
  // This table has a composite key and no id column to page by.
  if (table === 'room_module_recipients') return recipientRows(db, filters.room_module_id ?? null);
  const all = [];
  const entries = Object.entries(filters);
  const arrayFilters = entries.filter(([, value]) => Array.isArray(value));
  // Each IN list is bounded (50 values) and deduplicated. Every batch combination selects a disjoint
  // set of rows (a row has one value per column) and the result is sorted by id below, so combinations
  // are read a few at a time (BATCH_CONCURRENCY) instead of one after another; pages inside one
  // combination stay sequential (keyset cursor). Any failure rejects the whole read: no partial rows.
  const batchLists = arrayFilters.map(([key, values]) => {
    const unique = [...new Set(values)];
    const slices = [];
    for (let start = 0; start < unique.length; start += 50) slices.push(unique.slice(start, start + 50));
    return [key, slices];
  });
  if (batchLists.some(([, slices]) => !slices.length)) return all;
  const combinations = batchLists.reduce((combos, [key, slices]) =>
    combos.flatMap((combo) => slices.map((slice) => ({ ...combo, [key]: slice }))), [{}]);
  async function readBatch(batches) {
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
  await mapInOrder(combinations, BATCH_CONCURRENCY, readBatch);
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
const PERSONAL_READING_COLUMNS = 'id,user_id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,completed_at,pronunciation_accuracy,reading_speed_wpm,detected_error_count';
// The attempt columns activity progress uses (unchanged from before).
const ACTIVITY_ATTEMPT_FIELDS = ['id', 'module_id', 'passage_id', 'assignment_id', 'room_id', 'material_id', 'activity_assignment_id', 'oral_reading_attempt_id', 'status', 'created_at', 'completed_at'];
// Performance: one read of the learner's attempts serves the counted quizzes, the extra (not counted) ones and
// activity progress. These are every column those use: the one-assessment-per-activity rule (user_id and the
// activity columns, status, created_at, completed_at) and scoring (passage_title, question_snapshot). The story
// text (passage_text) and other columns were read twice before and never used.
const PERSONAL_ATTEMPT_COLUMNS = [...ACTIVITY_ATTEMPT_FIELDS, 'user_id', 'passage_title', 'question_snapshot'].join(',');

/**
 * A learner's own progress. `includeActivities: false` (Independent Learners, decided from the server-side
 * profile) skips the classroom reads, whose result is not shown to them; activities is then [].
 */
async function personal(userId, { includeActivities = true } = {}) {
  const attemptsRead = rows('m6_comprehension_attempts', PERSONAL_ATTEMPT_COLUMNS, { user_id: userId });
  // quizzes() and historicalQuizzes() ask for this learner's completed attempts: they get them from the one read
  // (the same rows, in the same id order, as their own query). Every other read is unchanged.
  const load = (table, columns, filters) => table === 'm6_comprehension_attempts'
    && Object.keys(filters).length === 2 && filters.user_id === userId && filters.status === 'completed'
    ? attemptsRead.then(all => all.filter(a => a.status === 'completed'))
    : rows(table, columns, filters);
  // Classroom work needs only the learner's assignments and enrollments, so it starts now, alongside the
  // comprehension reads, instead of after them.
  const assignmentsRead = includeActivities ? rows('reading_activity_assignments', '*', { student_id: userId }) : null;
  const enrollmentsRead = includeActivities ? rows('enrollments', 'id,room_id', { student_id: userId }) : null;
  const [readings, quizResults, extraResults, attempts, assignments, materials, modules] = await Promise.all([
    rows('oral_reading_attempts', PERSONAL_READING_COLUMNS, { user_id: userId }),
    quizzes({ user_id: userId }, { rows: load }), historicalQuizzes({ user_id: userId }, { rows: load }), attemptsRead,
    assignmentsRead, assignmentsRead?.then(a => materialTitles(a)), enrollmentsRead?.then(e => learnerModuleAssignments(userId, e)),
  ]);
  const activityAttempts = attempts.map(a => Object.fromEntries(ACTIVITY_ATTEMPT_FIELDS.map(key => [key, a[key]])));
  const activities = includeActivities ? activityList(assignments, materials, modules, readings, activityAttempts) : [];
  return { summary: metrics(readings, quizResults), readings, quizzes: quizResults, historicalQuizzes: extraResults, activities };
}
/** Current progress on a learner's active assigned activities and modules, from saved work only. */
async function activityProgress(userId, assignments, enrollments, readings, attempts, load = rows) {
  // Material titles and module assignments are independent reads, so they load together.
  const [materials, modules] = await Promise.all([materialTitles(assignments, load), learnerModuleAssignments(userId, enrollments, load)]);
  return activityList(assignments, materials, modules, readings, attempts);
}
/** Titles of the learner's active assigned materials. */
async function materialTitles(assignments, load = rows) {
  const materialIds = [...new Set(activeMaterialAssignments(assignments).map(a => a.material_id))];
  const materials = [];
  for (let i=0;i<materialIds.length;i+=100) materials.push(...await load('uploaded_materials', 'id,title', { id: materialIds.slice(i,i+100) }));
  return materials;
}
function activityList(assignments, materials, { assignments: moduleAssignments, titles }, readings, attempts) {
  const materialActivities = activeMaterialAssignments(assignments).map(a => ({ ...deriveActivityProgress(a, readings, attempts), id: a.id, title: materials.find(m => m.id === a.material_id)?.title || 'Assigned reading activity' }));
  const moduleActivities = moduleAssignments.map(a => ({ ...deriveActivityProgress(a, readings, attempts), id: a.id, title: titles.get(a.module_id) || 'Assigned reading module' }));
  return [...materialActivities, ...moduleActivities];
}
/** The learner's active classroom module assignments, with their passages and titles. */
async function learnerModuleAssignments(userId, enrollments, load = rows) {
  const roomIds = enrollments.map(e => e.room_id);
  const assigned = roomIds.length ? await load('room_modules', '*', { room_id: roomIds }) : [];
  if (!assigned.length) return { assignments: [], titles: new Map() };
  const modules = await load('modules', 'id,title,status,deleted_at', { id: [...new Set(assigned.map(m => m.module_id))] });
  const roomModules = activeRoomModules(assigned, modules);
  if (!roomModules.length) return { assignments: [], titles: new Map() };
  const moduleIds = [...new Set(roomModules.map(m => m.module_id))];
  const [recipients, passages, questions] = await Promise.all([
    load('room_module_recipients', 'room_module_id,student_id', { room_module_id: roomModules.map(m => m.id) }),
    load('module_passages', 'id,module_id', { module_id: moduleIds }),
    load('comprehension_questions', 'id,passage_id', { review_status: 'reviewed', module_id: moduleIds }),
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
/**
 * Performance: a read-only loader answering queries from rows loaded once for a whole class.
 * `store` maps a table to { rows, columns, domain }: the rows were read live with every `domain` constraint
 * (key -> allowed values) and with `columns`. A query is answered from memory only when every domain
 * constraint appears in its filters with values inside the domain (so the loaded rows are a superset of
 * its answer) and its columns were loaded; anything else is read live with `fallback`, unchanged.
 * Rows keep the live order (rows() sorts by id; recipients keep their reportRows order) and are copies.
 */
function preloadedRows(store, fallback = rows) {
  const asSet = (value) => new Set(Array.isArray(value) ? value : [value]);
  return async (table, columns = '*', filters = {}) => {
    const entry = store.get(table);
    if (!entry) return fallback(table, columns, filters);
    const wanted = columns === '*' ? null : columns.split(',').map((column) => column.trim());
    const loaded = entry.columns === '*' ? null : new Set(entry.columns.split(',').map((column) => column.trim()));
    if ((wanted === null && loaded !== null) || (wanted && loaded && wanted.some((column) => !loaded.has(column)))) return fallback(table, columns, filters);
    const tests = [];
    for (const [key, allowed] of Object.entries(entry.domain)) {
      if (!(key in filters)) return fallback(table, columns, filters);
      const values = asSet(filters[key]);
      if ([...values].some((value) => !allowed.has(value))) return fallback(table, columns, filters);
      if (values.size !== allowed.size) tests.push([key, values]);
    }
    for (const [key, value] of Object.entries(filters)) if (!(key in entry.domain)) tests.push([key, asSet(value)]);
    if (tests.some(([key]) => entry.rows.length && !(key in entry.rows[0]))) return fallback(table, columns, filters);
    const matched = entry.rows.filter((row) => tests.every(([key, values]) => values.has(row[key])));
    return matched.map((row) => (wanted ? Object.fromEntries(wanted.map((column) => [column, row[column]])) : { ...row }));
  };
}

const TEACHER_READING_COLUMNS = 'id,room_id,module_id,passage_id,assignment_id,material_id,activity_assignment_id,completed_at,pronunciation_accuracy,reading_speed_wpm';
const TEACHER_ATTEMPT_COLUMNS = 'id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,oral_reading_attempt_id,status,created_at,completed_at';

/** Reads, once for the Teacher's whole class, every row the per-Student queries below can ask for. */
async function preloadTeacherClass(scope) {
  const studentIds = scope.students.map(s => s.id);
  const roomIds = scope.rooms.map(r => r.id);
  const entry = (rowsRead, columns, domain) => ({ rows: rowsRead, columns,
    domain: Object.fromEntries(Object.entries(domain).map(([key, values]) => [key, new Set(values)])) });
  const [attempts, readings, assignments, roomModules] = await Promise.all([
    rows('m6_comprehension_attempts', '*', { user_id: studentIds }),
    rows('oral_reading_attempts', `${TEACHER_READING_COLUMNS},user_id`, { user_id: studentIds }),
    rows('reading_activity_assignments', '*', { student_id: studentIds, room_id: roomIds }),
    rows('room_modules', '*', { room_id: roomIds }),
  ]);
  const completedIds = attempts.filter(a => a.status === 'completed').map(a => a.id);
  const moduleIds = [...new Set(roomModules.map(m => m.module_id))];
  const roomModuleIds = roomModules.map(m => m.id);
  const materialIds = [...new Set(assignments.map(a => a.material_id))];
  const none = Promise.resolve([]);
  const [responses, modules, recipients, passages, questions, materials] = await Promise.all([
    completedIds.length ? rows('m6_comprehension_responses', '*', { attempt_id: completedIds }) : none,
    moduleIds.length ? rows('modules', 'id,title,status,deleted_at', { id: moduleIds }) : none,
    roomModuleIds.length ? rows('room_module_recipients', 'room_module_id,student_id', { room_module_id: roomModuleIds }) : none,
    moduleIds.length ? rows('module_passages', 'id,module_id', { module_id: moduleIds }) : none,
    moduleIds.length ? rows('comprehension_questions', 'id,passage_id,module_id', { review_status: 'reviewed', module_id: moduleIds }) : none,
    materialIds.length ? rows('uploaded_materials', 'id,title', { id: materialIds }) : none,
  ]);
  return new Map([
    ['m6_comprehension_attempts', entry(attempts, '*', { user_id: studentIds })],
    ['m6_comprehension_responses', entry(responses, '*', { attempt_id: completedIds })],
    ['oral_reading_attempts', entry(readings, `${TEACHER_READING_COLUMNS},user_id`, { user_id: studentIds })],
    ['reading_activity_assignments', entry(assignments, '*', { student_id: studentIds, room_id: roomIds })],
    ['room_modules', entry(roomModules, '*', { room_id: roomIds })],
    ['modules', entry(modules, 'id,title,status,deleted_at', { id: moduleIds })],
    ['room_module_recipients', entry(recipients, 'room_module_id,student_id', { room_module_id: roomModuleIds })],
    ['module_passages', entry(passages, 'id,module_id', { module_id: moduleIds })],
    ['comprehension_questions', entry(questions, 'id,passage_id,module_id', { review_status: ['reviewed'], module_id: moduleIds })],
    ['uploaded_materials', entry(materials, 'id,title', { id: materialIds })],
  ]);
}

const TEACHER_STUDENT_CONCURRENCY = 6;
/** Maps items with at most `limit` running at once; results keep the input order; the first failure rejects
 * the whole call (no partial result) and no further items are started. */
async function mapInOrder(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  const runner = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await work(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}
async function teacher(teacherId) {
  const scope = await teacherScope(teacherId);
  const notificationsActive = isRiskWorkerEnabled();
  if (!scope.students.length) return { students: [], notifications: [], notificationsActive };
  // Performance: the class's rows are read once (a few queries instead of several per Student); each
  // Student's figures are then computed by the same code as before, from that Student's rows only.
  const [history, interventions, store] = await Promise.all([
    rows('m7_risk_events', '*', { teacher_id: teacherId }), rows('m7_interventions', '*', { teacher_id: teacherId }),
    preloadTeacherClass(scope),
  ]);
  const load = preloadedRows(store);
  // Performance: each Student's records are read-only and independent, so a few Students load at once
  // (bounded, to respect the database pool) instead of one after another. Output order is unchanged.
  const students = await mapInOrder(scope.students, TEACHER_STUDENT_CONCURRENCY, async (student) => {
    const roomIds = scope.enrollments.filter(e => e.student_id === student.id).map(e => e.room_id);
    // Own-classroom work only: a Student's personal practice (room_id null: M5 reading or M6 comprehension) is
    // not attributed to a Teacher. No Student attempt without a classroom existed before personal practice.
    const inScope = { include: a => Boolean(a.room_id) && roomIds.includes(a.room_id) };
    const [allQuizzes, extraResults, allReadings, activityRows, attemptRows] = await Promise.all([
      quizzes({ user_id: student.id }, { ...inScope, rows: load }), historicalQuizzes({ user_id: student.id }, { ...inScope, rows: load }),
      load('oral_reading_attempts', TEACHER_READING_COLUMNS, { user_id: student.id }),
      roomIds.length ? load('reading_activity_assignments', '*', { student_id: student.id, room_id: roomIds }) : [],
      load('m6_comprehension_attempts', TEACHER_ATTEMPT_COLUMNS, { user_id: student.id }),
    ]);
    const quizResults = allQuizzes.filter(q => Boolean(q.roomId) && roomIds.includes(q.roomId));
    // Readings: own-classroom work only. A Student's personal Read Aloud practice (room_id null) is not
    // attributed to a Teacher (matches inTeacherClassroom in oralReadingAttemptService.js). No Student reading
    // without a classroom existed before personal practice, so existing figures are unchanged.
    const readings = allReadings.filter(r => Boolean(r.room_id) && roomIds.includes(r.room_id));
    const unavailable = quizResults.some(q => q.dataQuality);
    const risk = !quizResults.length ? { classification: NO_ASSESSMENT_DATA }
      : unavailable ? { classification: 'Evaluation unavailable' } : classifyRisk(quizResults);
    const activities = await activityProgress(student.id, activityRows, scope.enrollments.filter(e => e.student_id === student.id), readings, attemptRows, load);
    const competency = {};
    for (const type of ['literal','inferential','critical']) {
      const groups = quizResults.filter(q => !q.dataQuality).map(q => q.byType[type]);
      const total = groups.reduce((sum,g) => sum + g.total, 0);
      competency[type] = { total, score: !unavailable && total ? Math.round(groups.reduce((sum,g) => sum + g.firstCorrect,0) / total * 100) : null };
    }
    return { ...student, ...metrics(readings,quizResults), classification: risk.classification, recoveryCount: risk.recoveryCount ?? 0,
      quizzes: quizResults, historicalQuizzes: extraResults, activities, competency, history: history.filter(e => e.student_id === student.id), interventions: interventions.filter(i => i.student_id === student.id) };
  });
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
module.exports = { preloadedRows, mapInOrder, TEACHER_STUDENT_CONCURRENCY, rows, quizzes, historicalQuizzes, teacherScope, requireStudent, requireAdminStudent, personal, system, teacher, saveIntervention, fail };
