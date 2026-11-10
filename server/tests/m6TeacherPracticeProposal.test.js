// PROPOSED M6 Teacher practice migration on real PostgreSQL (PGlite, in memory):
// supabase/proposed/m6_teacher_practice_PROPOSED.sql, run UNCHANGED over the current definitions.
// The fixture reproduces ReadFlow-Staging's live fingerprints of m6_assert_completion_access
// (4f5aeddc...) and m6_assert_learner_completion_access (795969b2...), so the migration's own
// guards pass here exactly as they would on Staging. Calls run as service_role, as the backend
// does. No network, no Staging database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile, id, asUser } = require("./fixtures/m5M6SecurityDatabase");
const { createM8TrustDatabase, verifiedDiagnostic, USERS, MODULE, PATH, ROOM, ROOM_MODULE } = require("./fixtures/m8TrustDatabase");
const { summarizeComprehension } = require("../services/comprehensionScoring");

const PROPOSED = "supabase/proposed/m6_teacher_practice_PROPOSED.sql";
const ROLLBACK = "supabase/proposed/m6_teacher_practice_ROLLBACK_PROPOSED.sql";
const BEFORE = "4f5aeddcb911fb2433d4f9f97c804b2b";
const AFTER = "b02ca1708f0d79c63b1240f2eeeaa285";
const REJECTED_TEACHER = id(41);
const TEACHER2 = id(42);
const TEACHER_OWN_MODULE = id(341);
const ARCHIVED_MODULE = id(342);
const Q = [id(8401), id(8402), id(8403)];
const SNAPSHOT = Q.map((questionId, index) => ({
  id: questionId, type: ["literal", "inferential", "critical"][index], questionText: `Question ${index + 1}?`,
  options: ["a", "b", "c", "d"], correctOptionIndex: index, scaffoldingHint: "Look for the clue in the story.",
}));

let counter = 0;
async function asService(db, work) {
  await db.exec("set role service_role");
  try { return await work(); } finally { await db.exec("reset role"); }
}
const apply = (db, attempt, user, question, action, option = null) => asService(db, async () => (await db.query(
  "select public.m6_apply_action($1,$2,$3,$4,$5,$6) as result",
  [attempt, user, question, action, option, action === "answer" ? id(7600 + ++counter) : null])).rows[0].result);
async function reading(db, { user, module, room = null, material = null }) {
  return (await db.query(`insert into public.oral_reading_attempts(user_id, module_id, room_id, material_id)
    values ($1,$2,$3,$4) returning id`, [user, module, room, material])).rows[0].id;
}
async function activity(db, { user, module, oral, room = null, assignment = null, language = "en", passage = module }) {
  return (await db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,module_id,passage_id,room_id,assignment_id,
      passage_title,passage_text,language,question_snapshot,status,oral_reading_attempt_id)
    values ($1,$2,$3,$4,$5,$6,'Story','Story text',$7,$8,'in_progress',$9) returning id`,
  [user, id(9800 + ++counter), module, passage, room, assignment, language, JSON.stringify(SNAPSHOT), oral])).rows[0].id;
}
async function answerAllAndComplete(db, attempt, user) {
  assert.deepEqual(await apply(db, attempt, user, Q[0], "answer", 0), { correct: true, resolved: true });
  assert.deepEqual(await apply(db, attempt, user, Q[1], "answer", 0), { correct: false, resolved: false });
  await apply(db, attempt, user, Q[1], "answer", 3);
  assert.deepEqual(await apply(db, attempt, user, Q[2], "answer", 2), { correct: true, resolved: true });
  return apply(db, attempt, user, null, "complete");
}
const count = async (db, sql, args) => (await db.query(sql, args)).rows[0].n;
const rewards = async (db, user) => ({
  xp: await count(db, "select count(*)::int n from public.m8_xp_events where user_id = $1", [user]),
  days: await count(db, "select count(*)::int n from public.m8_reading_days where user_id = $1", [user]),
  badges: await count(db, "select count(*)::int n from public.m8_earned_badges where user_id = $1", [user]),
  progress: await count(db, "select count(*)::int n from public.m8_learner_progress where user_id = $1", [user]),
});
const fingerprint = async (db) => (await db.query(
  "select md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure), chr(13), '')) m")).rows[0].m;

test("proposed M6 Teacher practice on real PostgreSQL", { timeout: 300000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  // The Staging state this migration targets: trusted XP, Admin practice, M8 reward eligibility
  // and one comprehension assessment per activity are all live.
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));
  await db.exec(`alter table public.oral_reading_attempts add column module_id uuid, add column room_id uuid, add column material_id uuid;
    create unique index m6_owner_oral_result_unique on public.m6_comprehension_attempts(user_id, oral_reading_attempt_id)
      where oral_reading_attempt_id is not null;
    insert into auth.users values ('${REJECTED_TEACHER}'), ('${TEACHER2}');
    insert into public.profiles(id, role, teacher_status) values ('${REJECTED_TEACHER}', 'teacher', 'rejected'), ('${TEACHER2}', 'teacher', 'approved');
    -- Staging's modules_status_check also allows 'archived' (the fixture's older check does not).
    alter table public.modules drop constraint modules_status_check,
      add constraint modules_status_check check (status in ('draft','published','archived'));
    insert into public.modules(id,path_id,title,difficulty,status,created_by) values
      ('${TEACHER_OWN_MODULE}','${PATH.en}','Teacher draft','Easy','draft','${USERS.teacher}'),
      ('${ARCHIVED_MODULE}','${PATH.en}','Archived','Easy','archived','${USERS.admin}');`);
  await db.exec(sqlFile("supabase/proposed/m6_admin_practice_PROPOSED.sql"));
  await db.exec(sqlFile("supabase/proposed/m8_reward_eligibility_PROPOSED.sql"));
  await db.exec(sqlFile("supabase/proposed/m6_one_assessment_per_activity_PROPOSED.sql"));

  await t.test("before the migration: an approved Teacher can answer but cannot complete (the current blocker)", async () => {
    assert.equal(await fingerprint(db), BEFORE, "the fixture matches Staging's live definition");
    const attempt = await activity(db, { user: USERS.teacher, module: MODULE.filEasy, language: "fil",
      oral: await reading(db, { user: USERS.teacher, module: MODULE.filEasy }) });
    await assert.rejects(answerAllAndComplete(db, attempt, USERS.teacher), /role|Learner|Access|authorized|permission/i);
  });

  await db.exec(sqlFile(PROPOSED));

  await t.test("applied as reviewed; a second run is refused by its guard", async () => {
    assert.equal(await fingerprint(db), AFTER);
    await assert.rejects(db.exec(sqlFile(PROPOSED)), /differs from the reviewed definition/);
    await db.exec("rollback");
    assert.equal(await fingerprint(db), AFTER);
    const grants = await db.query(`select has_function_privilege('anon','public.m6_assert_completion_access(uuid)','execute') a,
      has_function_privilege('authenticated','public.m6_assert_completion_access(uuid)','execute') b,
      has_function_privilege('service_role','public.m6_assert_completion_access(uuid)','execute') c`);
    assert.deepEqual(grants.rows[0], { a: false, b: false, c: true });
  });

  await t.test("an approved Teacher completes practice on another author's published module, with the existing scoring", async () => {
    const before = await rewards(db, USERS.teacher);
    const attempt = await activity(db, { user: USERS.teacher, module: MODULE.enEasy,
      oral: await reading(db, { user: USERS.teacher, module: MODULE.enEasy }) });
    assert.deepEqual(await answerAllAndComplete(db, attempt, USERS.teacher), { completed: true });
    const responses = (await db.query("select * from public.m6_comprehension_responses where attempt_id = $1", [attempt])).rows;
    const score = summarizeComprehension(SNAPSHOT, responses);
    assert.deepEqual([score.firstCorrect, score.totalQuestions, score.firstAttemptPercentage], [2, 3, 67]);
    assert.equal((await db.query("select status from public.m6_comprehension_attempts where id = $1", [attempt])).rows[0].status, "completed");
    assert.deepEqual(await rewards(db, USERS.teacher), before, "no XP, reading day, badge or progress");
    assert.deepEqual(await apply(db, attempt, USERS.teacher, null, "complete"), { completed: true }, "a repeated complete is harmless");
  });

  await t.test("Filipino Teacher practice completes too (language from the module)", async () => {
    const attempt = await activity(db, { user: TEACHER2, module: MODULE.filHard, language: "fil",
      oral: await reading(db, { user: TEACHER2, module: MODULE.filHard }) });
    assert.deepEqual(await answerAllAndComplete(db, attempt, TEACHER2), { completed: true });
    const wrongLanguage = await activity(db, { user: TEACHER2, module: MODULE.filEasy, language: "en",
      oral: await reading(db, { user: TEACHER2, module: MODULE.filEasy }) });
    await assert.rejects(answerAllAndComplete(db, wrongLanguage, TEACHER2), /language does not match/);
    assert.deepEqual(await rewards(db, TEACHER2), { xp: 0, days: 0, badges: 0, progress: 0 });
  });

  await t.test("drafts, archived, deleted (even the Teacher's own draft) and unknown-language modules are refused", async () => {
    for (const module of [MODULE.enDraft, MODULE.enDeleted, ARCHIVED_MODULE, TEACHER_OWN_MODULE]) {
      const attempt = await activity(db, { user: USERS.teacher, module, oral: await reading(db, { user: USERS.teacher, module }) });
      await assert.rejects(answerAllAndComplete(db, attempt, USERS.teacher), /Module access revoked/, module);
    }
    const unknown = await activity(db, { user: USERS.teacher, module: MODULE.unknownLanguage,
      oral: await reading(db, { user: USERS.teacher, module: MODULE.unknownLanguage }) });
    await assert.rejects(answerAllAndComplete(db, unknown, USERS.teacher), /Unknown module language/);
  });

  await t.test("Teacher practice is never a classroom activity and needs the Teacher's own reading of that module", async () => {
    const roomAttempt = await activity(db, { user: USERS.teacher, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard,
      oral: await reading(db, { user: USERS.teacher, module: MODULE.enHard }) });
    await assert.rejects(answerAllAndComplete(db, roomAttempt, USERS.teacher), /limited to published reading modules/);
    const studentsReading = await reading(db, { user: USERS.student, module: MODULE.enMedium });
    const borrowed = await activity(db, { user: USERS.teacher, module: MODULE.enMedium, oral: studentsReading });
    await assert.rejects(answerAllAndComplete(db, borrowed, USERS.teacher), /Teacher's own reading/);
    const otherModule = await activity(db, { user: USERS.teacher, module: MODULE.enHardPending,
      oral: await reading(db, { user: USERS.teacher, module: MODULE.enEasy }) });
    await assert.rejects(answerAllAndComplete(db, otherModule, USERS.teacher), /Teacher's own reading/);
    const classroomReading = await activity(db, { user: USERS.teacher, module: MODULE.filHard, language: "fil",
      oral: await reading(db, { user: USERS.teacher, module: MODULE.filHard, room: ROOM }) });
    await assert.rejects(answerAllAndComplete(db, classroomReading, USERS.teacher), /Teacher's own reading/);
  });

  await t.test("pending and rejected Teachers are still refused by the unchanged learner rules", async () => {
    for (const user of [USERS.pendingTeacher, REJECTED_TEACHER]) {
      const attempt = await activity(db, { user, module: MODULE.enMedium, oral: await reading(db, { user, module: MODULE.enMedium }) });
      await assert.rejects(answerAllAndComplete(db, attempt, user), /role|Learner|Access|authorized|permission/i, user);
      assert.equal((await db.query("select status from public.m6_comprehension_attempts where id = $1", [attempt])).rows[0].status, "in_progress");
    }
  });

  await t.test("a Teacher cannot answer or complete a Student's activity", async () => {
    const studentAttempt = await activity(db, { user: USERS.student, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard,
      oral: await reading(db, { user: USERS.student, module: MODULE.enHard, room: ROOM }) });
    await assert.rejects(apply(db, studentAttempt, USERS.teacher, Q[0], "answer", 0), /Activity not found/);
    await assert.rejects(apply(db, studentAttempt, USERS.teacher, null, "complete"), /Activity not found/);
    assert.equal(await count(db, "select count(*)::int n from public.m6_comprehension_responses where attempt_id = $1", [studentAttempt]), 0);
  });

  await t.test("one comprehension assessment per passage still applies to Teacher practice", async () => {
    // USERS.teacher already completed MODULE.enEasy above; a new reading cannot open a second assessment.
    const before = await count(db, "select count(*)::int n from public.m6_comprehension_attempts where user_id = $1", [USERS.teacher]);
    await assert.rejects(activity(db, { user: USERS.teacher, module: MODULE.enEasy,
      oral: await reading(db, { user: USERS.teacher, module: MODULE.enEasy }) }), /already has a comprehension assessment/);
    assert.equal(await count(db, "select count(*)::int n from public.m6_comprehension_attempts where user_id = $1", [USERS.teacher]), before);
  });

  await t.test("Admin practice is unchanged: own published modules only", async () => {
    const own = await activity(db, { user: USERS.admin, module: MODULE.enMedium,
      oral: await reading(db, { user: USERS.admin, module: MODULE.enMedium }) });
    assert.deepEqual(await answerAllAndComplete(db, own, USERS.admin), { completed: true });
    await db.exec(`update public.modules set created_by = '${USERS.teacher}' where id = '${MODULE.filEasy}'`);
    const notOwn = await activity(db, { user: USERS.admin, module: MODULE.filEasy, language: "fil",
      oral: await reading(db, { user: USERS.admin, module: MODULE.filEasy }) });
    await assert.rejects(answerAllAndComplete(db, notOwn, USERS.admin), /Module access revoked/);
    await db.exec(`update public.modules set created_by = '${USERS.admin}' where id = '${MODULE.filEasy}'`);
  });

  await t.test("Students and Independent Learners keep their rules, rewards and M7 queueing", async () => {
    const student = await activity(db, { user: USERS.student2, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard,
      oral: await reading(db, { user: USERS.student2, module: MODULE.enHard, room: ROOM }) });
    assert.deepEqual(await answerAllAndComplete(db, student, USERS.student2), { completed: true });
    assert.ok((await rewards(db, USERS.student2)).xp >= 1, "the classroom module still earns XP");
    assert.equal(await count(db, "select count(*)::int n from public.m7_risk_queue where id = $1", [USERS.student2]), 1);
    const outside = await activity(db, { user: USERS.student, module: MODULE.filHard, language: "fil",
      oral: await reading(db, { user: USERS.student, module: MODULE.filHard }) });
    await assert.rejects(answerAllAndComplete(db, outside, USERS.student), /role does not match|Access|authorized|assigned|enrol/i,
      "a Student still cannot complete outside a classroom");
    await verifiedDiagnostic(db, USERS.general, "en", "Independent", id(7601));
    const learner = await activity(db, { user: USERS.general, module: MODULE.enMedium,
      oral: await reading(db, { user: USERS.general, module: MODULE.enMedium }) });
    assert.deepEqual(await answerAllAndComplete(db, learner, USERS.general), { completed: true });
    assert.equal((await db.query(`select xp_earned from public.m8_xp_events where user_id = $1 and source_type = 'module' and source_id = $2`,
      [USERS.general, MODULE.enMedium])).rows[0].xp_earned, 50, "the existing tier formula");
  });

  await t.test("M8: Teacher read-alouds and completions add no progress; Teachers are absent from leaderboards", async () => {
    const before = await rewards(db, TEACHER2);
    for (let n = 0; n < 5; n++) {
      await db.query(`insert into public.oral_reading_attempts(user_id, module_id, completed_at) values ($1, $2, now() - ($3 || ' days')::interval)`,
        [TEACHER2, MODULE.enMedium, String(n)]);
    }
    assert.deepEqual(await rewards(db, TEACHER2), before);
    const weekly = (await asUser(db, USERS.student, "select user_id::text from public.m8_weekly_leaderboard()")).rows.map((r) => r.user_id);
    assert.ok(!weekly.includes(USERS.teacher) && !weekly.includes(TEACHER2));
  });

  await t.test("M7 side effect: a Teacher completion leaves one queue row that evaluation removes with no risk event", async () => {
    // m7_enqueue_completion (unchanged) queues every non-Admin completion.
    assert.equal(await count(db, "select count(*)::int n from public.m7_risk_queue where id = $1", [USERS.teacher]), 1);
    const generation = (await db.query("select generation from public.m7_risk_queue where id = $1", [USERS.teacher])).rows[0].generation;
    const events = await count(db, "select count(*)::int n from public.m7_risk_events", []);
    const saved = await asService(db, async () => (await db.query("select public.m7_save_evaluation($1, $2) as ok",
      [USERS.teacher, generation])).rows[0].ok);
    assert.equal(saved, true, "the worker's evaluation succeeds");
    assert.equal(await count(db, "select count(*)::int n from public.m7_risk_queue where id = $1", [USERS.teacher]), 0, "and dequeues it");
    assert.equal(await count(db, "select count(*)::int n from public.m7_risk_events", []), events, "no risk event for anyone");
    assert.equal(await count(db, "select count(*)::int n from public.m7_risk_events where student_id = $1 or teacher_id = $1", [USERS.teacher]), 0);
  });

  await t.test("rollback restores the exact pre-migration definition; Teacher completion is blocked again", async () => {
    await db.exec(sqlFile(ROLLBACK));
    assert.equal(await fingerprint(db), BEFORE);
    await assert.rejects(db.exec(sqlFile(ROLLBACK)), /not installed/);
    await db.exec("rollback");
    const attempt = await activity(db, { user: TEACHER2, module: MODULE.enHard,
      oral: await reading(db, { user: TEACHER2, module: MODULE.enHard }) });
    await assert.rejects(answerAllAndComplete(db, attempt, TEACHER2), /role|Learner|Access|authorized|permission/i);
    // Saved Teacher practice is kept.
    assert.ok(await count(db, "select count(*)::int n from public.m6_comprehension_attempts where user_id = $1 and status = 'completed'", [TEACHER2]) >= 1);
    await db.exec(sqlFile(PROPOSED));
    assert.equal(await fingerprint(db), AFTER, "re-applies cleanly after a rollback");
  });
});
