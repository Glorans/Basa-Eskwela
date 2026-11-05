// PROPOSED one-comprehension-assessment-per-learning-activity guard on real PostgreSQL (PGlite, in memory):
// supabase/proposed/m6_one_assessment_per_activity_PROPOSED.sql and its rollback. Concurrency (two connections)
// is verified separately on a disposable PostgreSQL 17 restore; PGlite has a single connection.
// No network, no staging database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile, id } = require("./fixtures/m5M6SecurityDatabase");
const { createM8TrustDatabase, USERS, MODULE, ROOM, ROOM_MODULE } = require("./fixtures/m8TrustDatabase");

const PROPOSED = "supabase/proposed/m6_one_assessment_per_activity_PROPOSED.sql";
const ROLLBACK = "supabase/proposed/m6_one_assessment_per_activity_ROLLBACK_PROPOSED.sql";
const APPLIED = "76e677bf797d8db768e11bc200abb539";
let counter = 0;

async function attempt(db, { user, module = MODULE.enEasy, passage = module, room = null, assignment = null,
  material = null, activity = null, oral = null, status = "in_progress" }) {
  return (await db.query(`insert into public.m6_comprehension_attempts(user_id, submission_id, module_id, passage_id, room_id,
      assignment_id, material_id, activity_assignment_id, oral_reading_attempt_id, passage_title, passage_text, language,
      question_snapshot, status, completed_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Story','Story text','en','[{"id":"q"}]'::jsonb,$10,
      case when $10 = 'completed' then now() end) returning id`,
  [user, id(9900 + ++counter), material ? null : module, material ? null : passage, room, assignment, material, activity, oral, status])).rows[0].id;
}
const refused = async (db, work) => {
  await db.exec("savepoint s");
  try { await work(); await db.exec("rollback to savepoint s"); return null; }
  catch (error) { await db.exec("rollback to savepoint s"); return error.code; }
};
const count = async (db) => (await db.query("select count(*)::int n from public.m6_comprehension_attempts")).rows[0].n;

test("proposed one assessment per learning activity on real PostgreSQL", { timeout: 240000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));

  // Before: two attempts for one activity are possible (one per reading); keep them as legacy rows.
  const legacyCompleted = await attempt(db, { user: USERS.general, status: "completed" });
  const legacyOpen = await attempt(db, { user: USERS.general });
  const before = await db.query("select id, status, completed_at from public.m6_comprehension_attempts order by id");

  await db.exec(sqlFile(PROPOSED));

  await t.test("applied as reviewed; no row changed", async () => {
    const fp = (await db.query(`select md5(replace(pg_get_functiondef('public.m6_one_assessment_per_activity()'::regprocedure), chr(13), '')) fp`)).rows[0].fp;
    assert.equal(fp, APPLIED);
    assert.deepEqual((await db.query("select id, status, completed_at from public.m6_comprehension_attempts order by id")).rows, before.rows);
    await assert.rejects(db.exec(sqlFile(PROPOSED)), /already applied/);
    await db.exec("rollback");
  });

  await t.test("legacy activity: no new attempt and no second completed result; saved rows untouched", async () => {
    await db.exec("begin");
    assert.equal(await refused(db, () => attempt(db, { user: USERS.general })), "23505");
    assert.equal(await refused(db, () => db.query("update public.m6_comprehension_attempts set status='completed', completed_at=now() where id=$1",
      [legacyOpen])), "23505");
    await db.exec("rollback");
    assert.equal((await db.query("select status from public.m6_comprehension_attempts where id=$1", [legacyCompleted])).rows[0].status, "completed");
  });

  await t.test("a new activity: the first attempt is allowed, a second (repeated reading) is refused", async () => {
    await db.exec("begin");
    try {
      const first = await attempt(db, { user: USERS.student, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard });
      assert.equal(await refused(db, () => attempt(db, { user: USERS.student, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard })), "23505");
      // The trigger lets the activity's own attempt be completed (status change only, checked directly).
      assert.equal(await refused(db, () => db.query("update public.m6_comprehension_attempts set status='completed', completed_at=now() where id=$1", [first])) === "23505", false);
    } finally { await db.exec("rollback"); }
  });

  await t.test("different passages, assignments, learners and materials are never blocked", async () => {
    await db.exec("begin");
    try {
      const n = await count(db);
      await attempt(db, { user: USERS.student2, module: MODULE.enHard });                                                  // own practice
      await attempt(db, { user: USERS.student2, module: MODULE.enMedium });                                                // another passage
      await attempt(db, { user: USERS.student2, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard });     // a classroom assignment
      await attempt(db, { user: USERS.student2, module: MODULE.enMedium, room: ROOM, assignment: ROOM_MODULE.enMedium }); // another assignment
      await attempt(db, { user: USERS.student, module: MODULE.enHard });                                                   // another learner
      assert.equal(await count(db), n + 5);
    } finally { await db.exec("rollback"); }
  });

  await t.test("the rollback is guarded and exact", async () => {
    await db.exec("rollback").catch(() => {});
    await db.exec(sqlFile(ROLLBACK));
    assert.equal((await db.query("select to_regprocedure('public.m6_one_assessment_per_activity()') is null as gone")).rows[0].gone, true);
    await assert.rejects(db.exec(sqlFile(ROLLBACK)), /nothing to roll back/);
    await db.exec("rollback");
    assert.deepEqual((await db.query("select id, status, completed_at from public.m6_comprehension_attempts order by id")).rows, before.rows);
  });
});
