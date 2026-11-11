// Performance: the Teacher reading list reads summary columns only (no transcripts, passage snapshots or
// per-word metrics). Its result must equal the full-row result, and a failing narrow read falls back once.
// In-memory fake PostgREST that honors select() columns. No network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { listTeacherOralReadingAttempts } = require("../services/oralReadingAttemptService");

const TEACHER = { user: { id: "teacher-1" }, profile: { role: "teacher", teacher_status: "approved" } };
const id = (prefix, n) => `${prefix}-${String(n).padStart(4, "0")}`;

function tables() {
  const t = { rooms: [{ id: "room-a", teacher_id: "teacher-1" }, { id: "room-z", teacher_id: "teacher-2" }], enrollments: [], profiles: [],
    oral_reading_attempts: [], modules: [{ id: "mod-1", title: "Module One", difficulty: "Easy" }], reading_activity_assignments: [],
    m6_comprehension_attempts: [], m6_comprehension_responses: [] };
  for (let s = 0; s < 4; s++) {
    const sid = id("stu", s);
    t.profiles.push({ id: sid, full_name: `Synthetic ${s}`, nickname: s === 1 ? " " : `S${s}`, role: s === 3 ? "general_user" : "student" });
    t.enrollments.push({ id: id("enr", s), student_id: sid, room_id: "room-a" });
    for (let k = 0; k < 3; k++) {
      const material = k === 2 ? "mat-1" : null;
      t.oral_reading_attempts.push({ id: id(`ora${s}`, k), user_id: sid, room_id: k === 1 ? "room-z" : "room-a", module_id: material ? null : "mod-1", passage_id: material ? null : "pas-1",
        assignment_id: null, material_id: material, activity_assignment_id: material ? id("asg", s) : null, completed_at: `2026-11-0${k + 1}T00:00:00Z`,
        module_title_snapshot: material ? "Story" : null, passage_title_snapshot: k === 0 ? "Passage" : null, scoring_version: k === 0 ? null : 2,
        pronunciation_accuracy: 80 + k, reading_speed_wpm: 90 + s, detected_error_count: k,
        transcript: "a long transcript ".repeat(50), passage_snapshot: "story text ".repeat(80), word_metrics: Array.from({ length: 150 }, () => ({ expected: "w", actual: "w", type: "match" })) });
    }
    t.reading_activity_assignments.push({ id: id("asg", s), student_id: sid, read_aloud_only: s === 2 });
    const cid = id("cmp", s);
    t.m6_comprehension_attempts.push({ id: cid, user_id: sid, oral_reading_attempt_id: id(`ora${s}`, 0), room_id: "room-a", material_id: null, activity_assignment_id: null,
      module_id: "mod-1", passage_id: "pas-1", assignment_id: null, status: "completed", created_at: "2026-11-05T00:00:00Z", completed_at: "2026-11-05T00:10:00Z",
      question_snapshot: [{ id: "q1", type: "literal", options: ["a", "b", "c", "d"], correctOptionIndex: 0 }] });
    t.m6_comprehension_responses.push({ id: id("rsp", s), attempt_id: cid, question_id: "q1", first_option_index: s % 2, first_answer_correct: s % 2 === 0, resolved: true, hint_used: false, answer_history: [] });
  }
  return t;
}

function fakeDb(data, { honorColumns = true, failColumns = null, failCode = "42703", cap = Infinity } = {}) {
  const selects = [];
  return {
    selects,
    from(table) {
      const filters = []; let columns = "*"; let limit = Infinity;
      const query = {
        select(value = "*") { columns = value; selects.push({ table, columns }); return query; },
        eq(k, v) { filters.push((r) => r[k] === v); return query; }, in(k, vs) { filters.push((r) => vs.includes(r[k])); return query; },
        gt(k, v) { filters.push((r) => r[k] > v); return query; }, order() { return query; }, limit(n) { limit = n; return query; },
        then(resolve, reject) {
          if (failColumns && table === "oral_reading_attempts" && columns !== "*" && columns.includes(failColumns)) {
            return Promise.resolve({ data: null, error: { code: failCode, message: "synthetic failure" } }).then(resolve, reject);
          }
          let rows = (data[table] ?? []).filter((r) => filters.every((f) => f(r))).sort((a, b) => a.id.localeCompare(b.id)).slice(0, Math.min(limit, cap));
          if (honorColumns && columns !== "*") { const keys = columns.split(","); rows = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))); }
          else rows = rows.map((r) => ({ ...r }));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("the list reads summary columns only and returns exactly the full-row result", async () => {
  const narrow = fakeDb(tables());
  const full = fakeDb(tables(), { honorColumns: false });
  const fromNarrow = await listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => narrow });
  const fromFull = await listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => full });
  assert.deepEqual(fromNarrow, fromFull);
  assert.ok(fromNarrow.length > 0, "the fixture yields visible readings");
  assert.ok(fromNarrow.every((row) => row.learnerId !== id("stu", 3)), "only Student-role learners");
  assert.ok(fromNarrow.every((row) => row.roomId !== "room-z"), "only the Teacher's own rooms");
  const attemptSelects = narrow.selects.filter((s) => s.table === "oral_reading_attempts").map((s) => s.columns);
  assert.ok(attemptSelects.length >= 1);
  for (const columns of attemptSelects) {
    assert.notEqual(columns, "*");
    assert.doesNotMatch(columns, /transcript|word_metrics|passage_snapshot/);
  }
});

test("an outage on the summary read is reported as before: no fallback and no second request", async () => {
  const failing = fakeDb(tables(), { failColumns: "scoring_version", failCode: "08006" });
  await assert.rejects(listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => failing }), /Unable to load student oral-reading results/);
  const reads = failing.selects.filter((s) => s.table === "oral_reading_attempts");
  assert.equal(reads.length, 1, "no hidden retry");
  const strictFailing = fakeDb(tables(), { failColumns: "scoring_version", failCode: "08006" });
  await assert.rejects(listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => strictFailing, weeklyReportStrict: true }), /weekly report data/);
});

test("only a missing-column schema error falls back to full rows: logged once, then full rows are used directly", async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const failing = fakeDb(tables(), { failColumns: "scoring_version" });
    const result = await listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => failing });
    const expected = await listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => fakeDb(tables(), { honorColumns: false }) });
    assert.deepEqual(result, expected);
    const kinds = failing.selects.filter((s) => s.table === "oral_reading_attempts").map((s) => s.columns.includes("scoring_version") ? "narrow" : s.columns);
    assert.equal(kinds[0], "narrow");
    assert.equal(kinds.filter((k) => k === "narrow").length, 1, "one narrow attempt");
    assert.ok(kinds.slice(1).length >= 1 && kinds.slice(1).every((k) => k === "*"), "then full rows (paged)");
    const again = fakeDb(tables(), { failColumns: "scoring_version" });
    await listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => again });
    assert.ok(again.selects.filter((s) => s.table === "oral_reading_attempts").every((s) => s.columns === "*"), "no repeated failing request");
    assert.equal(warnings.length, 1, "logged once");
    assert.deepEqual(warnings[0][1], { code: "42703" }, "code only, no data");
  } finally {
    console.warn = warn;
  }
});

test("a list read that fails both ways still reports the same error", async () => {
  const data = tables();
  const db = fakeDb(data);
  const broken = { from: (table) => (table === "oral_reading_attempts"
    ? { select() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; }, gt() { return this; },
      then: (resolve) => Promise.resolve({ data: null, error: { message: "down" } }).then(resolve) }
    : db.from(table)) };
  await assert.rejects(listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => broken }), /Unable to load student oral-reading results/);
});

test("a server row cap below the 1,000-row page still returns the complete list", async () => {
  const capped = await listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => fakeDb(tables(), { cap: 2 }) });
  const uncapped = await listTeacherOralReadingAttempts(TEACHER, { getSupabaseAdmin: () => fakeDb(tables()) });
  assert.deepEqual(capped, uncapped);
});
