// Performance review: Teacher analytics loads a few Students at once. Results, order, failure handling
// and the concurrency bound are checked here with synthetic in-memory tables (no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const supabaseAdmin = require("../services/supabaseAdmin");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad = (prefix, n) => `${prefix}${String(n).padStart(6, "0")}`;

function classroom(count, teacher = "teacher-1", room = "room-a") {
  const t = { rooms: [{ id: room, room_name: "A", teacher_id: teacher }], enrollments: [], profiles: [], oral_reading_attempts: [],
    m6_comprehension_attempts: [], m6_comprehension_responses: [], reading_activity_assignments: [], uploaded_materials: [{ id: "mat-1", title: "Story" }],
    room_modules: [], modules: [], module_passages: [], comprehension_questions: [], m7_risk_events: [], m7_interventions: [], room_module_recipients: [] };
  for (let s = 0; s < count; s++) {
    const sid = pad(`${room}-stu`, s);
    t.profiles.push({ id: sid, full_name: `Synthetic ${s}`, nickname: `S${s}`, role: "student" });
    t.enrollments.push({ id: pad(`${room}-enr`, s), student_id: sid, room_id: room });
    t.reading_activity_assignments.push({ id: pad(`${room}-asg`, s), student_id: sid, room_id: room, material_id: "mat-1", status: "assigned", created_at: "2026-11-01T00:00:00Z" });
    for (let k = 0; k < 2; k++) {
      const aid = pad(`${room}-att${k}-`, s);
      t.oral_reading_attempts.push({ id: pad(`${room}-ora${k}-`, s), user_id: sid, room_id: room, completed_at: `2026-11-0${k + 1}T00:00:00Z`, pronunciation_accuracy: 70 + s % 30, reading_speed_wpm: 80 + k });
      t.m6_comprehension_attempts.push({ id: aid, user_id: sid, room_id: room, status: "completed", created_at: `2026-11-0${k + 1}T00:00:00Z`, completed_at: `2026-11-0${k + 1}T00:10:00Z`,
        module_id: `mod-${k}`, passage_id: `pas-${k}`,
        question_snapshot: ["literal", "inferential", "critical"].map((type, q) => ({ id: `q${q}`, type, options: ["a", "b", "c", "d"], correctOptionIndex: 0 })) });
      for (let q = 0; q < 3; q++) t.m6_comprehension_responses.push({ id: `${aid}-r${q}`, attempt_id: aid, question_id: `q${q}`, first_option_index: (s + q + k) % 3 === 0 ? 0 : 1, first_answer_correct: (s + q + k) % 3 === 0, resolved: true });
    }
  }
  return t;
}

function fakeDatabase(tables, { latency = 1, failWhen = null } = {}) {
  const stats = { queries: 0, inFlight: 0, maxInFlight: 0, profileReads: new Set() };
  const from = (table) => {
    const filters = []; let limit = 1000; let range = null;
    const query = {
      select() { return query; }, order() { return query; }, limit(n) { limit = n; return query; }, range(a, b) { range = [a, b]; return query; },
      eq(k, v) { filters.push([k, (r) => r[k] === v, v]); return query; }, in(k, vs) { filters.push([k, (r) => vs.includes(r[k]), vs]); return query; },
      is(k, v) { filters.push([k, (r) => (r[k] ?? null) === v, v]); return query; }, gt(k, v) { filters.push([k, (r) => r[k] > v, v]); return query; },
      then(resolve, reject) {
        stats.queries++; stats.inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        return sleep(latency).then(() => {
          if (failWhen?.(table, filters)) return { data: null, error: { message: "synthetic outage" } };
          let data = (tables[table] ?? []).filter((r) => filters.every(([, f]) => f(r)));
          if (table !== "room_module_recipients") data = data.sort((a, b) => a.id.localeCompare(b.id));
          data = range ? data.slice(range[0], range[1] + 1) : data.slice(0, limit);
          return { data, error: null };
        }).finally(() => { stats.inFlight--; }).then(resolve, reject);
      },
    };
    return query;
  };
  return { stats, db: { from } };
}

function freshAnalytics(db) {
  supabaseAdmin.getSupabaseAdmin = () => db;
  const sep = require("node:path").sep;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${sep}services${sep}`) && !key.endsWith(`${sep}supabaseAdmin.js`)) delete require.cache[key];
  }
  return require("../services/m7Analytics");
}

test("mapInOrder keeps input order, never exceeds its limit and stops starting work after a failure", async () => {
  const { mapInOrder } = freshAnalytics(fakeDatabase({}).db);
  let running = 0; let peak = 0;
  const items = Array.from({ length: 25 }, (_, i) => i);
  const out = await mapInOrder(items, 6, async (n) => {
    running++; peak = Math.max(peak, running);
    await sleep((n * 7) % 5); // Finishes out of order on purpose.
    running--;
    return n * 2;
  });
  assert.deepEqual(out, items.map((n) => n * 2));
  assert.ok(peak <= 6 && peak > 1, `peak ${peak}`);
  assert.deepEqual(await mapInOrder([], 6, async () => assert.fail()), []);

  const started = [];
  await assert.rejects(mapInOrder(items, 3, async (n) => {
    started.push(n);
    await sleep(2);
    if (n === 4) throw new Error("student 4 failed");
    return n;
  }), /student 4 failed/);
  await sleep(20);
  assert.ok(started.length < items.length, `stopped early: ${started.length} of ${items.length} started`);
});

test("Teacher analytics: same Students, same order and same results at 1, 10, 30 and 120 Students", async () => {
  for (const count of [1, 10, 30, 120]) {
    const tables = classroom(count);
    const { stats, db } = fakeDatabase(tables, { latency: 0 });
    const analytics = freshAnalytics(db);
    const result = await analytics.teacher("teacher-1");
    assert.deepEqual(result.students.map((s) => s.id), tables.profiles.map((p) => p.id).sort(), `order for ${count}`);
    // Every Student's figures equal those computed for that Student alone (no cross-Student mixing).
    for (const student of [result.students[0], result.students[result.students.length - 1]]) {
      const solo = classroom(count);
      solo.enrollments = solo.enrollments.filter((e) => e.student_id === student.id);
      const alone = await freshAnalytics(fakeDatabase(solo, { latency: 0 }).db).teacher("teacher-1");
      assert.equal(alone.students.length, 1);
      assert.deepEqual(alone.students[0], student, `Student ${student.id} unchanged`);
    }
    // Bounded: 6 Students at once, each with at most 5 reads in parallel.
    assert.ok(stats.maxInFlight <= 6 * 5, `max in flight ${stats.maxInFlight}`);
  }
});

test("Teacher analytics only covers the Teacher's own enrolled Students, even when requests overlap", async () => {
  const a = classroom(12, "teacher-a", "room-a");
  const b = classroom(9, "teacher-b", "room-b");
  const tables = Object.fromEntries(Object.keys(a).map((key) => [key, [...a[key], ...b[key].filter((row) => !(key === "uploaded_materials"))]]));
  const { db } = fakeDatabase(tables, { latency: 1 });
  const analytics = freshAnalytics(db);
  const [forA, forB, forNobody] = await Promise.all([analytics.teacher("teacher-a"), analytics.teacher("teacher-b"), analytics.teacher("teacher-c")]);
  assert.ok(forA.students.length === 12 && forA.students.every((s) => s.id.startsWith("room-a")));
  assert.ok(forB.students.length === 9 && forB.students.every((s) => s.id.startsWith("room-b")));
  assert.deepEqual(forNobody.students, []);
});

test("a database failure for one Student fails the whole request (no partial analytics)", async () => {
  const tables = classroom(30);
  const target = tables.profiles[17].id;
  const { stats, db } = fakeDatabase(tables, { latency: 1, failWhen: (table, filters) => table === "oral_reading_attempts" && filters.some(([k, , v]) => k === "user_id" && v === target) });
  const analytics = freshAnalytics(db);
  await assert.rejects(analytics.teacher("teacher-1"), /Unable to load oral_reading_attempts/);
  const afterFailure = stats.queries;
  await sleep(50);
  assert.ok(stats.queries - afterFailure < 6 * 12, "in-flight Students finish, no new Students start");
});
