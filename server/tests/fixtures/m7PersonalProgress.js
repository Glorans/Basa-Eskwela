// Deterministic synthetic learners for GET /api/analytics/personal (no randomness, no real data) and an
// in-memory PostgREST-like fake: column projection, eq / in / gt, order, limit, range. Every read is
// logged (table, columns, start/end) so tests can check how the data is read, not only what is returned.
const hex = (n, width) => n.toString(16).padStart(width, '0');
const words = (n, seed = 0) => Array.from({ length: n }, (_, i) => ['ang', 'bata', 'reading', 'river', 'school', 'kaibigan', 'malakas', 'ulan', 'story'][(i + seed) % 9]).join(' ');
const day = (i) => `2026-${String(9 + Math.floor(i / 28) % 3).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
const TYPES = ['literal', 'inferential', 'critical'];
const questions = (n, seed) => Array.from({ length: n }, (_, k) => ({ id: `q${seed}-${k}`, type: TYPES[k % 3], question: words(20, k),
  options: [words(5, 1), words(5, 2), words(5, 3), words(5, 4)], correctOptionIndex: (k + seed) % 4, explanation: words(30, k) }));

function datasets() {
  const prefixes = new Map();
  const id = (kind, n) => {
    if (!prefixes.has(kind)) prefixes.set(kind, prefixes.size + 1);
    return `${hex(prefixes.get(kind), 8)}-0000-4000-8000-${hex(n, 12)}`;
  };
  const empty = () => ({ oral_reading_attempts: [], m6_comprehension_attempts: [], m6_comprehension_responses: [], reading_activity_assignments: [], enrollments: [],
    uploaded_materials: [], room_modules: [], modules: [], room_module_recipients: [], module_passages: [], comprehension_questions: [], rooms: [], profiles: [],
    m7_risk_events: [], m7_interventions: [] });

  function learner(t, me, o) {
    const lang = (i) => (o.filipinoEvery && i % o.filipinoEvery === 0 ? 'fil' : 'en');
    for (let i = 0; i < (o.readings ?? 0); i++) {
      const ctx = o.context?.(i) ?? {};
      t.oral_reading_attempts.push({ id: id('reading', t.oral_reading_attempts.length + 1), user_id: me, module_id: ctx.module_id ?? null, passage_id: ctx.passage_id ?? null,
        assignment_id: ctx.assignment_id ?? null, room_id: ctx.room_id ?? null, material_id: ctx.material_id ?? null, activity_assignment_id: ctx.activity_assignment_id ?? null,
        completed_at: `${day(i)}T0${i % 9}:15:00Z`, pronunciation_accuracy: o.nullScores && i % 5 === 0 ? null : 55 + ((i * 7) % 45) + (i % 3) / 4,
        reading_speed_wpm: o.nullScores && i % 6 === 0 ? null : 48 + ((i * 11) % 70) + (i % 2) / 2, detected_error_count: (i * 3) % 9,
        language_snapshot: lang(i), transcript: words(200, i), word_metrics: Array.from({ length: 30 }, (_, w) => ({ w, ok: (w + i) % 7 !== 0 })) });
    }
    const quizCount = o.quizzes ?? 0;
    for (let i = 0; i < quizCount + (o.extras ?? 0) + (o.inProgress ?? 0); i++) {
      const n = t.m6_comprehension_attempts.length + 1;
      const extra = i >= quizCount && i < quizCount + (o.extras ?? 0);
      const inProgress = i >= quizCount + (o.extras ?? 0);
      const activity = extra ? i - quizCount : i;
      const ctx = o.context?.(activity) ?? {};
      const qs = questions(o.questionCount ?? 6, activity);
      const noActivity = o.noActivityEvery && activity % o.noActivityEvery === 0;
      const row = { id: id('attempt', n), user_id: me, submission_id: id('submission', n),
        module_id: noActivity ? null : ctx.material_id ? (ctx.module_id ?? null) : (ctx.module_id ?? id('module-free', activity + 1)),
        passage_id: noActivity ? null : ctx.material_id ? (ctx.passage_id ?? null) : (ctx.passage_id ?? id('passage-free', activity + 1)),
        room_id: ctx.room_id ?? null, assignment_id: ctx.assignment_id ?? null, material_id: ctx.material_id ?? null, activity_assignment_id: ctx.activity_assignment_id ?? null,
        oral_reading_attempt_id: id('reading', (activity % Math.max(o.readings ?? 1, 1)) + 1),
        passage_title: o.blankTitleEvery && activity % o.blankTitleEvery === 0 ? '' : `Passage ${activity}`, passage_text: words(450, activity), language: lang(activity),
        question_snapshot: o.invalidSnapshotAt === activity ? [{ id: 'bad', type: 'unknown' }] : qs, status: inProgress ? 'in_progress' : 'completed', scoring_version: 1,
        created_at: `${day(activity)}T10:${String(10 + (i % 40)).padStart(2, '0')}:00Z`,
        completed_at: inProgress ? null : `${day(activity)}T1${extra ? 2 : 1}:${String(10 + (i % 40)).padStart(2, '0')}:00Z` };
      t.m6_comprehension_attempts.push(row);
      if (!inProgress && o.missingResponsesAt !== activity) {
        qs.forEach((q, k) => t.m6_comprehension_responses.push({ id: id('response', t.m6_comprehension_responses.length + 1), attempt_id: row.id, question_id: q.id,
          first_option_index: (q.correctOptionIndex + ((k * (i + 1) + i) % (2 + (i % 5)) === 0 ? 1 : 0)) % 4, selected_option_index: q.correctOptionIndex,
          resolved: true, hint_used: (k + i) % 4 === 0, attempts: 1 + (k % 2) }));
      }
    }
  }

  function classroom(t, me, { rooms = 1, materials = 0, modules = 0, passages = 3, removedEvery = 0, selectedOthersEvery = 0, unpublishedEvery = 0, missingTitleEvery = 0, teacher = null }) {
    const roomIds = [];
    for (let r = 0; r < rooms; r++) {
      const roomId = id('room', r + 1);
      roomIds.push(roomId);
      if (!t.rooms.some((x) => x.id === roomId)) t.rooms.push({ id: roomId, room_name: `Room ${r + 1}`, teacher_id: teacher ?? id('teacher', 1) });
      t.enrollments.push({ id: id('enrollment', t.enrollments.length + 1), room_id: roomId, student_id: me });
    }
    for (let m = 0; m < materials; m++) {
      const matId = id('material', m + 1);
      if (!(missingTitleEvery && m % missingTitleEvery === 0) && !t.uploaded_materials.some((x) => x.id === matId)) t.uploaded_materials.push({ id: matId, title: `Material ${m + 1}` });
      t.reading_activity_assignments.push({ id: id('assignment', t.reading_activity_assignments.length + 1), student_id: me, room_id: roomIds[m % rooms], material_id: matId,
        read_aloud_only: m % 4 === 3, status: 'assigned', removed_at: removedEvery && m % removedEvery === removedEvery - 1 ? '2026-10-20T00:00:00Z' : null, created_at: `${day(m)}T00:00:00Z` });
    }
    for (let m = 0; m < modules; m++) {
      const modId = id('module', m + 1);
      if (!t.modules.some((x) => x.id === modId)) {
        t.modules.push({ id: modId, title: `Module ${m + 1}`, status: unpublishedEvery && m % unpublishedEvery === unpublishedEvery - 1 ? 'draft' : 'published', deleted_at: m === 5 ? '2026-10-01T00:00:00Z' : null });
        for (let p = 0; p < passages; p++) {
          const passageId = id('passage-m', m * 10 + p + 1);
          t.module_passages.push({ id: passageId, module_id: modId });
          if (p % 3 !== 2) t.comprehension_questions.push({ id: id('question', t.comprehension_questions.length + 1), passage_id: passageId, module_id: modId, review_status: p % 5 === 4 ? 'pending' : 'reviewed' });
        }
      }
      const rmId = id('room-module', t.room_modules.length + 1);
      const selected = selectedOthersEvery && m % selectedOthersEvery === 0;
      t.room_modules.push({ id: rmId, room_id: roomIds[m % rooms], module_id: modId, targeting_mode: selected ? 'selected_students' : 'all_students',
        removed_at: m === 7 ? '2026-10-25T00:00:00Z' : null, created_at: `${day(m)}T00:00:00Z` });
      if (selected) t.room_module_recipients.push({ room_module_id: rmId, student_id: m % 2 ? me : id('someone-else', m) });
    }
    return roomIds;
  }

  const assignedContext = (t, me) => (i) => {
    const mine = t.reading_activity_assignments.filter((a) => a.student_id === me);
    const mods = t.room_modules;
    if (mine.length && i % 3 === 0) { const a = mine[(i / 3) % mine.length]; return { material_id: a.material_id, activity_assignment_id: a.id, room_id: a.room_id }; }
    if (mods.length && i % 3 === 1) {
      const rm = mods[i % mods.length]; const ps = t.module_passages.filter((p) => p.module_id === rm.module_id);
      return { module_id: rm.module_id, passage_id: ps[i % Math.max(ps.length, 1)]?.id ?? null, room_id: rm.room_id, assignment_id: rm.id };
    }
    return {};
  };

  const list = [];
  const add = (name, role, build) => { const t = empty(); const me = id(role === 'teacher' ? 'teacher' : 'user', list.length + 1); build(t, me); list.push({ name, role, userId: me, tables: t }); };
  add('student: no readings or quizzes', 'student', () => {});
  add('student: completed quizzes, English + Filipino', 'student', (t, me) => learner(t, me, { readings: 12, quizzes: 7, inProgress: 2, filipinoEvery: 3 }));
  add('student: incomplete assignments (materials + modules, removed, selected, unpublished, deleted)', 'student', (t, me) => {
    classroom(t, me, { rooms: 1, materials: 6, modules: 8, removedEvery: 3, selectedOthersEvery: 2, unpublishedEvery: 4 });
    learner(t, me, { readings: 9, quizzes: 4, inProgress: 3, context: assignedContext(t, me), filipinoEvery: 2 });
  });
  add('student: multiple learning rooms', 'student', (t, me) => {
    classroom(t, me, { rooms: 3, materials: 9, modules: 6, passages: 4 });
    learner(t, me, { readings: 30, quizzes: 18, inProgress: 2, context: assignedContext(t, me), filipinoEvery: 4 });
  });
  add('student: several attempts for the same activity (historical, not counted)', 'student', (t, me) => {
    classroom(t, me, { rooms: 2, materials: 4, modules: 2 });
    learner(t, me, { readings: 10, quizzes: 6, extras: 5, inProgress: 3, context: assignedContext(t, me) });
  });
  add('student: missing or incomplete optional data', 'student', (t, me) => {
    classroom(t, me, { rooms: 2, materials: 5, modules: 3, missingTitleEvery: 2 });
    learner(t, me, { readings: 14, quizzes: 9, inProgress: 1, nullScores: true, invalidSnapshotAt: 2, missingResponsesAt: 4, noActivityEvery: 5, blankTitleEvery: 3, context: assignedContext(t, me) });
  });
  add('student: large history (hundreds of records, many pages)', 'student', (t, me) => {
    classroom(t, me, { rooms: 3, materials: 40, modules: 10, passages: 5, removedEvery: 7 });
    learner(t, me, { readings: 420, quizzes: 230, extras: 15, inProgress: 6, context: assignedContext(t, me), filipinoEvery: 3 });
  });
  add('independent learner: no history', 'general_user', () => {});
  add('independent learner: personal reading history (modules + own materials)', 'general_user', (t, me) => {
    learner(t, me, { readings: 25, quizzes: 14, extras: 2, inProgress: 2, filipinoEvery: 2, context: (i) => (i % 4 === 0 ? { material_id: id('own-material', i + 1) } : {}) });
  });
  add('independent learner: leftover classroom rows are ignored', 'general_user', (t, me) => {
    classroom(t, me, { rooms: 1, materials: 3, modules: 2 });
    learner(t, me, { readings: 8, quizzes: 5, inProgress: 1, context: assignedContext(t, me) });
  });
  add('independent learner: large history', 'general_user', (t, me) => learner(t, me, { readings: 380, quizzes: 210, extras: 10, inProgress: 4, filipinoEvery: 2 }));
  // Teacher Student Support shares quizzes(), historicalQuizzes() and activityProgress(): it must be unchanged.
  add('teacher analytics (regression guard)', 'teacher', (t, me) => {
    [1, 2, 3, 4].map((n) => id('student', n)).forEach((s, n) => {
      t.profiles.push({ id: s, full_name: `Student ${n + 1}`, nickname: `S${n + 1}`, role: 'student' });
      classroom(t, s, { rooms: 1 + (n % 2), materials: 3 + n, modules: 2 + n, teacher: me });
      learner(t, s, { readings: 6 + n * 4, quizzes: 3 + n * 2, extras: n % 2, inProgress: 1, context: assignedContext(t, s), filipinoEvery: 2 });
    });
  });
  return list;
}

/** `delays[table]` (ms) slows a table; `failures[table]` makes it return a database error. */
function makeDb(tables, { delays = {}, failures = {} } = {}) {
  const log = [];
  const db = {
    log,
    from(table) {
      const filters = []; const orders = []; let columns = '*'; let limit = Infinity; let range = null;
      const query = {
        select(c = '*') { columns = c; return query; },
        eq(k, v) { filters.push((r) => r[k] === v); return query; },
        in(k, vs) { filters.push((r) => vs.includes(r[k])); return query; },
        gt(k, v) { filters.push((r) => r[k] > v); return query; },
        order(k, o = {}) { orders.push([k, o.ascending !== false]); return query; },
        limit(n) { limit = n; return query; },
        range(a, b) { range = [a, b]; return query; },
        then(resolve, reject) {
          const entry = { table, columns: columns.replace(/\s+/g, ''), started: log.length };
          log.push(entry);
          return new Promise((r) => setTimeout(r, delays[table] ?? 0)).then(() => {
            entry.ended = log.length;
            if (failures[table]) return { data: null, error: { message: 'offline' } };
            let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            rows.sort((a, b) => { for (const [k, asc] of orders) { const x = String(a[k] ?? ''), y = String(b[k] ?? ''); if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1); } return 0; });
            if (range) rows = rows.slice(range[0], range[1] + 1);
            rows = rows.slice(0, limit).map((r) => {
              if (columns.trim() === '*') return structuredClone(r);
              const out = {};
              for (const c of columns.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = structuredClone(r[c]);
              return out;
            });
            return { data: rows, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return db;
}

/** Calls the real GET /personal route handler. */
async function callPersonal(router) {
  const layer = router.stack.find((l) => l.route?.path === '/personal' && l.route.methods.get);
  let status = 200; let body;
  const res = { status(s) { status = s; return res; }, json(b) { body = b; return res; } };
  await layer.route.stack[0].handle({ query: {}, params: {}, get: () => undefined }, res, () => {});
  return { status, body };
}

module.exports = { datasets, makeDb, callPersonal };
