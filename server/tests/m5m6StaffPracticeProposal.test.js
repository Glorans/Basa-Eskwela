// PROPOSED M5/M6 staff practice (supabase/proposed/m5_m6_staff_practice_*) and the optional M7 queue tidy-up
// (supabase/proposed/m7_staff_practice_queue_*) on real PostgreSQL (PGlite, in memory). The fixture is brought to
// ReadFlow-Staging's live state by installing the exact live bodies kept in the two ROLLBACK files (fingerprints
// c9a82099... and 563885607...), so each migration's own guard passes here exactly as it would on Staging.
// Calls run as service_role, as the backend does. No network, no Staging database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile, id } = require("./fixtures/m5M6SecurityDatabase");
const { createM8TrustDatabase, USERS, MODULE, PATH, ROOM, ROOM_MODULE } = require("./fixtures/m8TrustDatabase");

const SQL = (name) => sqlFile(`supabase/proposed/${name}.sql`);
const LIVE = { m6: "c9a82099899e7caa47c92ef70c800bd4", m7: "563885607c852a10581f83699c7efd74" };
const NEW = { m6: "98b2de24a6764ee26c1d3b1869c4d225", m7: "c891e0b55b6c6355a1e56e1e39649d28" };
const SCHOOL_1 = id(9001);
const SCHOOL_2 = id(9002);
const SA = id(31);
const ADMIN_2 = id(32);
const TEACHER_2 = id(33);
const NO_SCHOOL_ADMIN = id(34);
const SCHOOL_2_MODULE = id(350);
const PLATFORM_MODULE = id(351);
const TEACHER_1_MODULE = id(352);
const Q = [id(8501), id(8502), id(8503)];
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
  [attempt, user, question, action, option, action === "answer" ? id(7700 + ++counter) : null])).rows[0].result);
const reading = async (db, user, module, room = null) => (await db.query(
  "insert into public.oral_reading_attempts(user_id, module_id, room_id) values ($1,$2,$3) returning id", [user, module, room])).rows[0].id;
async function activity(db, { user, module, room = null, assignment = null, language = "en" }) {
  const oral = await reading(db, user, module, room);
  return (await db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,module_id,passage_id,room_id,assignment_id,
      passage_title,passage_text,language,question_snapshot,status,oral_reading_attempt_id)
    values ($1,$2,$3,$9,$4,$5,'Story','Story text',$6,$7,'in_progress',$8) returning id`,
  // A distinct passage per activity: the one-assessment-per-activity rule (unchanged) would otherwise refuse a repeat.
  [user, id(9900 + ++counter), module, room, assignment, language, JSON.stringify(SNAPSHOT), oral, id(19900 + counter)])).rows[0].id;
}
async function complete(db, attempt, user) {
  for (const [index, question] of Q.entries()) await apply(db, attempt, user, question, "answer", index);
  return apply(db, attempt, user, null, "complete");
}
const one = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const fingerprint = (db, fn) => one(db, `select md5(replace(pg_get_functiondef('${fn}'::regprocedure), chr(13), '')) m`);
const rewards = async (db, user) => one(db, `select (select count(*) from public.m8_xp_events where user_id = $1)
  + (select count(*) from public.m8_reading_days where user_id = $1) + (select count(*) from public.m8_earned_badges where user_id = $1)
  + (select count(*) from public.m8_learner_progress where user_id = $1) n`, [user]);
const queued = (db, user) => one(db, "select count(*)::int n from public.m7_risk_queue where id = $1", [user]);

test("proposed M5/M6 staff practice + M7 queue tidy-up on real PostgreSQL", { timeout: 300000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  // The Staging state these migrations target (as the M6 Teacher practice proposal test), then M1 schools.
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));
  await db.exec(`alter table public.oral_reading_attempts add column module_id uuid, add column room_id uuid, add column material_id uuid;
    create unique index m6_owner_oral_result_unique on public.m6_comprehension_attempts(user_id, oral_reading_attempt_id)
      where oral_reading_attempt_id is not null;`);
  await db.exec(SQL("m6_admin_practice_PROPOSED"));
  await db.exec(SQL("m8_reward_eligibility_PROPOSED"));
  await db.exec(SQL("m6_one_assessment_per_activity_PROPOSED"));
  await db.exec(SQL("m6_teacher_practice_PROPOSED"));
  await db.exec(`create table public.schools(id uuid primary key);
    insert into public.schools values ('${SCHOOL_1}'), ('${SCHOOL_2}');
    alter table public.profiles add column school_id uuid references public.schools(id);
    alter table public.profiles drop constraint if exists profiles_role_check;
    insert into auth.users values ('${SA}'), ('${ADMIN_2}'), ('${TEACHER_2}'), ('${NO_SCHOOL_ADMIN}');
    insert into public.profiles(id, role, teacher_status) values ('${SA}', 'system_admin', null), ('${ADMIN_2}', 'admin', null),
      ('${TEACHER_2}', 'teacher', 'approved'), ('${NO_SCHOOL_ADMIN}', 'admin', null);
    update public.profiles set school_id = '${SCHOOL_1}' where id in ('${USERS.admin}', '${USERS.teacher}', '${USERS.student}', '${USERS.student2}');
    update public.profiles set school_id = '${SCHOOL_2}' where id in ('${ADMIN_2}', '${TEACHER_2}');
    insert into public.modules(id,path_id,title,difficulty,status,created_by) values
      ('${SCHOOL_2_MODULE}','${PATH.en}','School 2 module','Easy','published','${TEACHER_2}'),
      ('${PLATFORM_MODULE}','${PATH.en}','Platform module','Easy','published','${SA}'),
      ('${TEACHER_1_MODULE}','${PATH.en}','School 1 Teacher module','Easy','published','${USERS.teacher}');`);
  // Live Staging bodies (exact), from the rollback files.
  await db.exec(SQL("m5_m6_staff_practice_ROLLBACK_PROPOSED"));
  await db.exec(SQL("m7_staff_practice_queue_ROLLBACK_PROPOSED"));

  await t.test("before: the System Admin cannot complete practice; a School Admin only on modules they created", async () => {
    assert.equal(await fingerprint(db, "public.m6_assert_completion_access(uuid)"), LIVE.m6, "the fixture matches Staging's live definition");
    assert.equal(await fingerprint(db, "public.m7_enqueue_completion()"), LIVE.m7);
    await assert.rejects(complete(db, await activity(db, { user: SA, module: MODULE.enEasy }), SA), /Learner access required/);
    await assert.rejects(complete(db, await activity(db, { user: USERS.admin, module: TEACHER_1_MODULE }), USERS.admin), /Module access revoked/);
  });

  await db.exec(SQL("m5_m6_staff_practice_PROPOSED"));

  await t.test("applied as reviewed; a second run is refused by its guard; grants unchanged", async () => {
    assert.equal(await fingerprint(db, "public.m6_assert_completion_access(uuid)"), NEW.m6);
    await assert.rejects(db.exec(SQL("m5_m6_staff_practice_PROPOSED")), /not the reviewed definition/);
    await db.exec("rollback");
    const grants = (await db.query(`select has_function_privilege('anon','public.m6_assert_completion_access(uuid)','execute') a,
      has_function_privilege('authenticated','public.m6_assert_completion_access(uuid)','execute') b,
      has_function_privilege('service_role','public.m6_assert_completion_access(uuid)','execute') c`)).rows[0];
    assert.deepEqual(grants, { a: false, b: false, c: true });
  });

  await t.test("System Admin completes practice on every school's and platform modules, with no reward", async () => {
    for (const module of [MODULE.enEasy, SCHOOL_2_MODULE, PLATFORM_MODULE]) {
      assert.deepEqual(await complete(db, await activity(db, { user: SA, module }), SA), { completed: true }, module);
    }
    assert.equal(await rewards(db, SA), 0, "no XP, reading day, badge or progress");
  });

  await t.test("School Admin: own school's modules (any author) and platform modules; never another school's", async () => {
    for (const module of [MODULE.enMedium, TEACHER_1_MODULE, PLATFORM_MODULE]) {
      assert.deepEqual(await complete(db, await activity(db, { user: USERS.admin, module }), USERS.admin), { completed: true }, module);
    }
    await assert.rejects(complete(db, await activity(db, { user: USERS.admin, module: SCHOOL_2_MODULE }), USERS.admin), /Module access revoked/);
    await assert.rejects(complete(db, await activity(db, { user: ADMIN_2, module: TEACHER_1_MODULE }), ADMIN_2), /Module access revoked/);
    assert.deepEqual(await complete(db, await activity(db, { user: ADMIN_2, module: SCHOOL_2_MODULE }), ADMIN_2), { completed: true });
    await assert.rejects(complete(db, await activity(db, { user: NO_SCHOOL_ADMIN, module: PLATFORM_MODULE }), NO_SCHOOL_ADMIN), /requires a school/);
    assert.equal(await rewards(db, USERS.admin) + await rewards(db, ADMIN_2), 0);
  });

  await t.test("Teacher: unchanged for their school and platform; another school's module is now refused in the database too", async () => {
    assert.deepEqual(await complete(db, await activity(db, { user: USERS.teacher, module: MODULE.enHard }), USERS.teacher), { completed: true });
    assert.deepEqual(await complete(db, await activity(db, { user: TEACHER_2, module: PLATFORM_MODULE }), TEACHER_2), { completed: true });
    await assert.rejects(complete(db, await activity(db, { user: TEACHER_2, module: MODULE.enMedium }), TEACHER_2), /Module access revoked/);
    await assert.rejects(complete(db, await activity(db, { user: USERS.pendingTeacher, module: MODULE.enEasy }), USERS.pendingTeacher), /Learner access required/);
  });

  await t.test("staff practice is never classroom work; drafts, deleted and unknown-language modules stay refused", async () => {
    await assert.rejects(complete(db, await activity(db, { user: SA, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard }), SA),
      /System Admin practice is limited to published reading modules/);
    for (const module of [MODULE.enDraft, MODULE.enDeleted]) {
      await assert.rejects(complete(db, await activity(db, { user: SA, module }), SA), /Module access revoked/, module);
    }
    await assert.rejects(complete(db, await activity(db, { user: SA, module: MODULE.unknownLanguage }), SA), /Unknown module language/);
    await assert.rejects(complete(db, await activity(db, { user: SA, module: MODULE.filEasy, language: "en" }), SA), /language does not match/);
  });

  await t.test("learners are unchanged: a Student's classroom assessment completes and is rewarded as before", async () => {
    const before = await rewards(db, USERS.student);
    const attempt = await activity(db, { user: USERS.student, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard });
    assert.deepEqual(await complete(db, attempt, USERS.student), { completed: true });
    assert.ok(await rewards(db, USERS.student) > before, "the Student's reward rules still apply");
  });

  await t.test("M7 before the tidy-up: Teacher and System Admin practice queue a risk job; School Admin practice does not", async () => {
    await db.exec("delete from public.m7_risk_queue");
    await complete(db, await activity(db, { user: USERS.teacher, module: MODULE.enMedium }), USERS.teacher);
    await complete(db, await activity(db, { user: SA, module: MODULE.enMedium }), SA);
    await complete(db, await activity(db, { user: USERS.admin, module: MODULE.filHard, language: "fil" }), USERS.admin);
    assert.deepEqual([await queued(db, USERS.teacher), await queued(db, SA), await queued(db, USERS.admin)], [1, 1, 0]);
  });

  await db.exec(SQL("m7_staff_practice_queue_PROPOSED"));

  await t.test("M7 after the tidy-up: no staff practice job; a learner's completion is still queued", async () => {
    assert.equal(await fingerprint(db, "public.m7_enqueue_completion()"), NEW.m7);
    await db.exec("delete from public.m7_risk_queue");
    await complete(db, await activity(db, { user: USERS.teacher, module: MODULE.filEasy, language: "fil" }), USERS.teacher);
    await complete(db, await activity(db, { user: SA, module: MODULE.filEasy, language: "fil" }), SA);
    await complete(db, await activity(db, { user: ADMIN_2, module: PLATFORM_MODULE }), ADMIN_2);
    assert.deepEqual([await queued(db, USERS.teacher), await queued(db, SA), await queued(db, ADMIN_2)], [0, 0, 0]);
    await complete(db, await activity(db, { user: USERS.student, module: MODULE.enMedium, room: ROOM, assignment: ROOM_MODULE.enMedium }), USERS.student);
    assert.equal(await queued(db, USERS.student), 1);
    await assert.rejects(db.exec(SQL("m7_staff_practice_queue_PROPOSED")), /not the reviewed definition/);
    await db.exec("rollback");
  });

  await t.test("both rollbacks restore the exact live definitions; completed practice attempts are kept", async () => {
    const kept = await one(db, "select count(*)::int n from public.m6_comprehension_attempts where status = 'completed'");
    await db.exec(SQL("m7_staff_practice_queue_ROLLBACK_PROPOSED"));
    await db.exec(SQL("m5_m6_staff_practice_ROLLBACK_PROPOSED"));
    assert.equal(await fingerprint(db, "public.m6_assert_completion_access(uuid)"), LIVE.m6);
    assert.equal(await fingerprint(db, "public.m7_enqueue_completion()"), LIVE.m7);
    assert.equal(await one(db, "select count(*)::int n from public.m6_comprehension_attempts where status = 'completed'"), kept);
  });
});
