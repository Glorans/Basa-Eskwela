// PROPOSED Admin M6 practice migration on real PostgreSQL (PGlite, in memory):
// supabase/proposed/m6_admin_practice_PROPOSED.sql over the current definitions, whose
// fingerprints equal ReadFlow-Staging's (read-only check, 2026-11-05). Calls run as
// service_role, as the backend does. No network, no staging database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile, id, asUser } = require("./fixtures/m5M6SecurityDatabase");
const { createM8TrustDatabase, verifiedDiagnostic, USERS, MODULE, PATH, ROOM, ROOM_MODULE } = require("./fixtures/m8TrustDatabase");
const { summarizeComprehension } = require("../services/comprehensionScoring");

const PROPOSED = "supabase/proposed/m6_admin_practice_PROPOSED.sql";
const ROLLBACK = "supabase/proposed/m6_admin_practice_ROLLBACK_PROPOSED.sql";
const M8_ELIGIBILITY = "supabase/proposed/m8_reward_eligibility_PROPOSED.sql";
const ADMIN2 = id(31);
const OTHER_ADMIN_MODULE = id(331);
const Q = [id(8301), id(8302), id(8303)];
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
  [attempt, user, question, action, option, action === "answer" ? id(7400 + ++counter) : null])).rows[0].result);

/** A saved M5 reading as the backend writes it (user, module, no classroom unless given). */
async function reading(db, { user, module, room = null, material = null }) {
  return (await db.query(`insert into public.oral_reading_attempts(user_id, module_id, room_id, material_id)
    values ($1,$2,$3,$4) returning id`, [user, module, room, material])).rows[0].id;
}
/** An M6 activity as the backend inserts it after its own checks. */
async function activity(db, { user, module, oral, room = null, assignment = null, language = "en" }) {
  return (await db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,module_id,passage_id,room_id,assignment_id,
      passage_title,passage_text,language,question_snapshot,status,oral_reading_attempt_id)
    values ($1,$2,$3,$3,$4,$5,'Story','Story text',$6,$7,'in_progress',$8) returning id`,
  [user, id(9700 + ++counter), module, room, assignment, language, JSON.stringify(SNAPSHOT), oral])).rows[0].id;
}
/** Literal right, inferential wrong, critical right, then complete. */
async function answerAllAndComplete(db, attempt, user) {
  assert.deepEqual(await apply(db, attempt, user, Q[0], "answer", 0), { correct: true, resolved: true });
  assert.deepEqual(await apply(db, attempt, user, Q[1], "answer", 0), { correct: false, resolved: false });
  await apply(db, attempt, user, Q[1], "answer", 3); // the live two-try function; the backend closes it before completion
  assert.deepEqual(await apply(db, attempt, user, Q[2], "answer", 2), { correct: true, resolved: true });
  return apply(db, attempt, user, null, "complete");
}
const count = async (db, sql, args) => (await db.query(sql, args)).rows[0].n;
const rewards = async (db, user) => ({
  xp: await count(db, "select count(*)::int n from public.m8_xp_events where user_id = $1", [user]),
  days: await count(db, "select count(*)::int n from public.m8_reading_days where user_id = $1", [user]),
  badges: await count(db, "select count(*)::int n from public.m8_earned_badges where user_id = $1", [user]),
  progress: await count(db, "select count(*)::int n from public.m8_learner_progress where user_id = $1", [user]),
  riskQueue: await count(db, "select count(*)::int n from public.m7_risk_queue where id = $1", [user]),
});

test("proposed Admin M6 practice on real PostgreSQL", { timeout: 240000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));
  // The real oral_reading_attempts has these columns; the fixture's stand-in does not.
  await db.exec(`alter table public.oral_reading_attempts add column module_id uuid, add column room_id uuid, add column material_id uuid;
    create unique index m6_owner_oral_result_unique on public.m6_comprehension_attempts(user_id, oral_reading_attempt_id)
      where oral_reading_attempt_id is not null;
    insert into auth.users values ('${ADMIN2}');
    insert into public.profiles(id, role) values ('${ADMIN2}', 'admin');
    insert into public.modules(id,path_id,title,difficulty,status,created_by) values
      ('${OTHER_ADMIN_MODULE}','${PATH.en}','Other Admin','Easy','published','${ADMIN2}');`);

  await t.test("before the migration: an Admin cannot complete M6 (the current blocker)", async () => {
    const attempt = await activity(db, { user: USERS.admin, module: MODULE.enEasy, oral: await reading(db, { user: USERS.admin, module: MODULE.enEasy }) });
    await assert.rejects(answerAllAndComplete(db, attempt, USERS.admin), /Access|revoked|authorized|not allowed|permission/i);
  });

  await db.exec(sqlFile(PROPOSED));

  await t.test("an Admin completes literal, inferential and critical questions on their own published module", async () => {
    const oral = await reading(db, { user: USERS.admin, module: MODULE.enEasy });
    const before = await rewards(db, USERS.admin);
    const attempt = await activity(db, { user: USERS.admin, module: MODULE.enEasy, oral });
    assert.deepEqual(await answerAllAndComplete(db, attempt, USERS.admin), { completed: true });
    const responses = (await db.query("select * from public.m6_comprehension_responses where attempt_id = $1", [attempt])).rows;
    const score = summarizeComprehension(SNAPSHOT, responses);
    assert.deepEqual([score.firstCorrect, score.totalQuestions, score.firstAttemptPercentage], [2, 3, 67], "the existing first-answer scoring");
    assert.equal((await db.query("select status from public.m6_comprehension_attempts where id = $1", [attempt])).rows[0].status, "completed");
    // Admin practice is not learner progress: no XP, badge, reading day or M7 risk evaluation.
    assert.deepEqual(await rewards(db, USERS.admin), before);
    assert.equal(before.xp + before.badges + before.riskQueue, 0);
    // A repeated completion stays harmless.
    assert.deepEqual(await apply(db, attempt, USERS.admin, null, "complete"), { completed: true });
  });

  await t.test("an Admin cannot practise on another Admin's, a draft or a deleted module", async () => {
    for (const module of [OTHER_ADMIN_MODULE, MODULE.enDraft, MODULE.enDeleted]) {
      const attempt = await activity(db, { user: USERS.admin, module, oral: await reading(db, { user: USERS.admin, module }) });
      await assert.rejects(answerAllAndComplete(db, attempt, USERS.admin), /Module access revoked/, module);
    }
    // The other Admin can practise on their own module.
    const own = await activity(db, { user: ADMIN2, module: OTHER_ADMIN_MODULE, oral: await reading(db, { user: ADMIN2, module: OTHER_ADMIN_MODULE }) });
    assert.deepEqual(await answerAllAndComplete(db, own, ADMIN2), { completed: true });
    assert.equal((await rewards(db, ADMIN2)).xp, 0);
  });

  await t.test("Admin practice is never a classroom activity and needs the Admin's own reading of that module", async () => {
    const roomAttempt = await activity(db, { user: USERS.admin, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard,
      oral: await reading(db, { user: USERS.admin, module: MODULE.enHard }) });
    await assert.rejects(answerAllAndComplete(db, roomAttempt, USERS.admin), /limited to the Admin's own published modules/);
    const studentsReading = await reading(db, { user: USERS.student, module: MODULE.enMedium });
    const borrowed = await activity(db, { user: USERS.admin, module: MODULE.enMedium, oral: studentsReading });
    await assert.rejects(answerAllAndComplete(db, borrowed, USERS.admin), /own reading of this module/);
    const otherModuleReading = await activity(db, { user: USERS.admin, module: MODULE.enHardPending,
      oral: await reading(db, { user: USERS.admin, module: MODULE.enEasy }) });
    await assert.rejects(answerAllAndComplete(db, otherModuleReading, USERS.admin), /own reading of this module/);
    const wrongLanguage = await activity(db, { user: USERS.admin, module: MODULE.filEasy, language: "en",
      oral: await reading(db, { user: USERS.admin, module: MODULE.filEasy }) });
    await assert.rejects(answerAllAndComplete(db, wrongLanguage, USERS.admin), /language does not match/);
  });

  await t.test("an Admin cannot answer or complete a Student's activity; a Teacher still cannot take M6", async () => {
    const studentAttempt = await activity(db, { user: USERS.student, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard,
      oral: await reading(db, { user: USERS.student, module: MODULE.enHard, room: ROOM }) });
    await assert.rejects(apply(db, studentAttempt, USERS.admin, Q[0], "answer", 0), /Activity not found/);
    await assert.rejects(apply(db, studentAttempt, USERS.admin, null, "complete"), /Activity not found/);
    assert.equal(await count(db, "select count(*)::int n from public.m6_comprehension_responses where attempt_id = $1", [studentAttempt]), 0);
    const teacherAttempt = await activity(db, { user: USERS.teacher, module: MODULE.enEasy, oral: await reading(db, { user: USERS.teacher, module: MODULE.enEasy }) });
    await assert.rejects(answerAllAndComplete(db, teacherAttempt, USERS.teacher), /Access|authorized|not allowed|permission|revoked/i);
  });

  await t.test("Students and Independent Learners keep their rules and rewards", async () => {
    const student = await activity(db, { user: USERS.student, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard,
      oral: await reading(db, { user: USERS.student, module: MODULE.enHard, room: ROOM }) });
    assert.deepEqual(await answerAllAndComplete(db, student, USERS.student), { completed: true });
    const s = await rewards(db, USERS.student);
    assert.ok(s.xp >= 1, "the classroom module still earns XP");
    assert.equal(s.riskQueue, 1, "a Student completion is still queued for M7");
    await verifiedDiagnostic(db, USERS.general, "en", "Independent", id(7501));
    const learner = await activity(db, { user: USERS.general, module: MODULE.enMedium, oral: await reading(db, { user: USERS.general, module: MODULE.enMedium }) });
    assert.deepEqual(await answerAllAndComplete(db, learner, USERS.general), { completed: true });
    assert.equal((await db.query(`select xp_earned from public.m8_xp_events where user_id = $1 and source_type = 'module' and source_id = $2`,
      [USERS.general, MODULE.enMedium])).rows[0].xp_earned, 50, "the existing tier formula");
  });

  await t.test("one activity per Admin reading: a duplicate is refused by the database", async () => {
    const oral = await reading(db, { user: USERS.admin, module: MODULE.enMedium });
    await activity(db, { user: USERS.admin, module: MODULE.enMedium, oral });
    await assert.rejects(activity(db, { user: USERS.admin, module: MODULE.enMedium, oral }), /duplicate key|unique/);
  });

  await t.test("before the M8 eligibility fix, an Admin M5 reading still counts toward M8 (the gap it closes)", async () => {
    assert.ok((await rewards(db, USERS.admin)).progress >= 1, "read-aloud progress from Admin M5 readings");
  });

  // The finalized M8 eligibility proposal: no placeholder, guard = verified live fingerprint.
  await db.exec(sqlFile(M8_ELIGIBILITY));

  await t.test("Admin M5 practice: ten readings over seven days earn no count, day, streak or badge", async () => {
    const fresh = id(33);
    await db.exec(`insert into auth.users values ('${fresh}'); insert into public.profiles(id, role) values ('${fresh}', 'admin');`);
    for (let n = 0; n < 10; n++) {
      await db.query(`insert into public.oral_reading_attempts(user_id, module_id, completed_at) values ($1, $2, now() - ($3 || ' days')::interval)`,
        [fresh, MODULE.enEasy, String(n % 7)]);
    }
    assert.equal(await count(db, "select count(*)::int n from public.oral_reading_attempts where user_id = $1", [fresh]), 10, "the readings are saved");
    assert.deepEqual(await rewards(db, fresh), { xp: 0, days: 0, badges: 0, progress: 0, riskQueue: 0 });
    // A Teacher's reading is not learner progress either (rows from before the fix stay as they were).
    const teacherBefore = await rewards(db, USERS.teacher);
    await reading(db, { user: USERS.teacher, module: MODULE.enEasy });
    assert.deepEqual(await rewards(db, USERS.teacher), teacherBefore);
  });

  await t.test("learners keep M5 rewards: read-aloud count, reading days, Brave Reader and Consistent Reader", async () => {
    const before = await count(db, "select coalesce(max(read_aloud_count),0)::int n from public.m8_learner_progress where user_id = $1", [USERS.student2]);
    for (let n = 0; n < 10; n++) {
      await db.query(`insert into public.oral_reading_attempts(user_id, module_id, completed_at) values ($1, $2, now() - ($3 || ' days')::interval)`,
        [USERS.student2, MODULE.enEasy, String(n % 7)]);
    }
    assert.equal(await count(db, "select read_aloud_count::int n from public.m8_learner_progress where user_id = $1", [USERS.student2]), before + 10);
    assert.equal(await count(db, "select count(*)::int n from public.m8_reading_days where user_id = $1", [USERS.student2]), 7);
    const badges = (await db.query("select badge_id from public.m8_earned_badges where user_id = $1 order by 1", [USERS.student2])).rows.map((r) => r.badge_id);
    for (const badge of ["brave_reader", "consistent_reader", "streak_3"]) assert.ok(badges.includes(badge), badge);
  });

  await t.test("the whole Admin workflow (M5 reading, then M6) leaves no M8 progress and no M7 queue entry", async () => {
    const fresh = id(32);
    await db.exec(`insert into auth.users values ('${fresh}'); insert into public.profiles(id, role) values ('${fresh}', 'admin');
      update public.modules set created_by = '${fresh}' where id = '${MODULE.filHard}';`);
    const attempt = await activity(db, { user: fresh, module: MODULE.filHard, language: "fil", oral: await reading(db, { user: fresh, module: MODULE.filHard }) });
    assert.deepEqual(await answerAllAndComplete(db, attempt, fresh), { completed: true });
    // The assessment result is kept for the Admin to review: completed, with saved answers.
    assert.equal((await db.query("select status from public.m6_comprehension_attempts where id = $1", [attempt])).rows[0].status, "completed");
    assert.equal(await count(db, "select count(*)::int n from public.m6_comprehension_responses where attempt_id = $1", [attempt]), 3);
    assert.deepEqual(await rewards(db, fresh), { xp: 0, days: 0, badges: 0, progress: 0, riskQueue: 0 });
  });

  await t.test("Admins never appear on the leaderboards learners see; learners still do", async () => {
    const weekly = (await asUser(db, USERS.student, "select user_id::text from public.m8_weekly_leaderboard()")).rows.map((r) => r.user_id);
    assert.ok(weekly.includes(USERS.student), "the learner sees their own row");
    const independent = (await asUser(db, USERS.general, "select user_id::text from public.m8_independent_leaderboard('weekly')")).rows.map((r) => r.user_id);
    assert.ok(independent.includes(USERS.general), "the Independent Learner is ranked");
    for (const admin of [USERS.admin, ADMIN2, id(32), id(33)]) {
      assert.ok(!weekly.includes(admin) && !independent.includes(admin), admin);
    }
  });

  await t.test("the guard refuses a second apply; the rollback restores the learner-only rule", async () => {
    await db.exec("rollback").catch(() => {}); // no open transaction expected; never inherit an aborted one
    await assert.rejects(db.exec(sqlFile(PROPOSED)), /already exists|differs from the reviewed/);
    await db.exec("rollback");
    await db.exec(sqlFile(ROLLBACK));
    const attempt = await activity(db, { user: USERS.admin, module: MODULE.enHard, oral: await reading(db, { user: USERS.admin, module: MODULE.enHard }) });
    // M8 eligibility rollback: guarded, exact, and refuses to run twice.
    await db.exec(sqlFile("supabase/proposed/m8_reward_eligibility_ROLLBACK_PROPOSED.sql"));
    assert.equal((await db.query(`select md5(replace(pg_get_functiondef('public.m8_oral_completed()'::regprocedure), chr(13), '')) as fp`)).rows[0].fp,
      "76c29f67f939493194c7fb5c8a191bdb");
    await assert.rejects(db.exec(sqlFile("supabase/proposed/m8_reward_eligibility_ROLLBACK_PROPOSED.sql")), /not the applied eligibility definition/);
    await db.exec("rollback");
    await assert.rejects(answerAllAndComplete(db, attempt, USERS.admin), /Access|revoked|authorized|not allowed|permission/i);
    await assert.rejects(db.exec(sqlFile(ROLLBACK)), /missing \(not applied\?\)/);
    await db.exec("rollback");
  });
});

test("the M8 eligibility and Admin M6 migrations apply in either order", { timeout: 240000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));
  await db.exec("alter table public.oral_reading_attempts add column module_id uuid, add column room_id uuid, add column material_id uuid;");
  await db.exec(sqlFile(M8_ELIGIBILITY));
  await db.exec(sqlFile(PROPOSED));
  const attempt = await activity(db, { user: USERS.admin, module: MODULE.enEasy, oral: await reading(db, { user: USERS.admin, module: MODULE.enEasy }) });
  assert.deepEqual(await answerAllAndComplete(db, attempt, USERS.admin), { completed: true });
  assert.deepEqual(await rewards(db, USERS.admin), { xp: 0, days: 0, badges: 0, progress: 0, riskQueue: 0 });
});
