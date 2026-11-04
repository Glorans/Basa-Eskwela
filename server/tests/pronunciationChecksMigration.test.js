// Real PostgreSQL (PGlite, in memory) for the PROPOSED pronunciation-check
// migration, its read-only preflight/verify scripts and its rollback. Never
// connects to Supabase.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSecurityDatabase, asUser, id, sqlFile } = require("./fixtures/m5M6SecurityDatabase");

const MIGRATION = "supabase/proposed/m5_pronunciation_checks_PROPOSED.sql";
const ROLLBACK = "supabase/proposed/m5_pronunciation_checks_ROLLBACK_PROPOSED.sql";
const EN = id(600);
const FIL = id(601);
const OTHER_EN = id(602);

async function asService(db, sql) {
  await db.exec("begin");
  try {
    await db.exec("set local role service_role");
    const result = await db.query(sql);
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

const completed = `status = 'completed', locale = 'en-US', score_scale = '0-100', provider = 'azure',
  summary_version = 1, part_count = 1, utterance_count = 2, accuracy = 82, fluency = 74,
  words_to_practice = '["orchard"]', assessed_seconds = 36, complete = true, unassessed_seconds = 0,
  unassessed_segments = 0, parts = '[{"utterances":[],"complete":true}]', completed_at = now()`;

test("proposed pronunciation-check migration: structure, security, guards and rollback", { timeout: 120000 }, async (t) => {
  const db = await createSecurityDatabase();
  t.after(() => db.close());
  await db.exec(`
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    grant all on all tables in schema public to service_role;
  `);
  await db.exec(sqlFile("supabase/migrations/20261019_m5_recording_playback.sql"));
  const attempt = (attemptId, user, language) => `insert into public.oral_reading_attempts
    (id, user_id, module_id, passage_snapshot, transcript, duration_seconds, reading_speed_wpm, pronunciation_accuracy,
     expected_word_count, detected_error_count, word_metrics, language_snapshot)
    values ('${attemptId}', '${user}', '${id(50)}', 'Every Saturday.', 'every saturday', 10, 60, 91.5, 2, 0, '[]', ${language ? `'${language}'` : "null"});`;
  await db.exec(attempt(EN, id(1), "en") + attempt(FIL, id(1), "fil") + attempt(OTHER_EN, id(2), "en"));
  const fingerprint = async () => (await db.query(`select md5(string_agg(id::text||':'||pronunciation_accuracy::text||':'||reading_speed_wpm::text, ',' order by id)) as f,
    count(*)::int as n from public.oral_reading_attempts`)).rows[0];
  const before = await fingerprint();

  await t.test("preflight is read-only and runs before the migration", async () => {
    await db.exec(sqlFile("supabase/tests/m5_pronunciation_checks_preflight.sql"));
    assert.equal((await db.query("select to_regclass('public.oral_reading_pronunciation_checks') as t")).rows[0].t, null);
    assert.match(sqlFile("supabase/tests/m5_pronunciation_checks_preflight.sql"), /^begin read only;[\s\S]*rollback;\s*$/);
  });

  await t.test("migration applies and verification queries run", async () => {
    await db.exec(sqlFile(MIGRATION));
    await db.exec(sqlFile("supabase/tests/m5_pronunciation_checks_verify.sql"));
    const security = (await db.query(`select c.relrowsecurity as rls,
      (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
      has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
      has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
      has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
      has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE') as service
      from pg_class c where c.oid = 'public.oral_reading_pronunciation_checks'::regclass`)).rows[0];
    assert.deepEqual(security, { rls: true, policies: 0, auth_select: false, auth_insert: false, anon_select: false, service: true });
    const guard = (await db.query(`select prosecdef, proconfig from pg_proc where oid = 'public.m5_pronunciation_check_guard()'::regprocedure`)).rows[0];
    assert.equal(guard.prosecdef, false, "SECURITY INVOKER");
    assert.deepEqual(guard.proconfig, ['search_path=""']);
    assert.deepEqual(await fingerprint(), before, "existing oral-reading scores are untouched");
  });

  await t.test("a second run stops instead of altering an existing table", async () => {
    await assert.rejects(db.exec(sqlFile(MIGRATION)), /already exists/);
    await db.exec("rollback").catch(() => {});
  });

  await t.test("learners cannot read or write saved checks directly", async () => {
    await asService(db, `insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
      values ('${EN}', '${id(1)}', 'running', '${id(700)}')`);
    await assert.rejects(asUser(db, id(1), "select * from public.oral_reading_pronunciation_checks"), /permission denied/);
    await assert.rejects(asUser(db, id(1), `insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
      values ('${OTHER_EN}', '${id(1)}', 'running', '${id(701)}')`), /permission denied/);
    await assert.rejects(asUser(db, id(1), `update public.oral_reading_pronunciation_checks set accuracy = 100`), /permission denied/);
    await assert.rejects(asUser(db, id(1), "select * from public.oral_reading_pronunciation_checks", "anon"), /permission denied/);
  });

  await t.test("one row per attempt: a simultaneous second claim fails on the primary key", async () => {
    await assert.rejects(asService(db, `insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
      values ('${EN}', '${id(1)}', 'running', '${id(702)}')`), /duplicate key/);
  });

  await t.test("results must be complete and consistent with the status", async () => {
    await assert.rejects(asService(db, `update public.oral_reading_pronunciation_checks set status = 'completed'`), /results_match_status/);
    await assert.rejects(asService(db, `update public.oral_reading_pronunciation_checks set accuracy = 50`), /results_match_status/);
    await assert.rejects(asService(db, `update public.oral_reading_pronunciation_checks set ${completed.replace("accuracy = 82", "accuracy = 101")}`), /accuracy_check/);
    await asService(db, `update public.oral_reading_pronunciation_checks set ${completed} where attempt_id = '${EN}'`);
  });

  await t.test("a completed check is immutable", async () => {
    await assert.rejects(asService(db, `update public.oral_reading_pronunciation_checks set accuracy = 99`), /cannot be changed/);
    await assert.rejects(asService(db, `update public.oral_reading_pronunciation_checks set status = 'running'`), /cannot be changed/);
    assert.equal((await db.query("select accuracy from public.oral_reading_pronunciation_checks")).rows[0].accuracy, 82);
  });

  await t.test("Filipino attempts and another learner's attempt cannot hold a check", async () => {
    await assert.rejects(asService(db, `insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
      values ('${FIL}', '${id(1)}', 'running', '${id(703)}')`), /Filipino readings have no pronunciation check/);
    await assert.rejects(asService(db, `insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
      values ('${OTHER_EN}', '${id(1)}', 'running', '${id(704)}')`), /attempt owner/);
    await assert.rejects(asService(db, `insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id, language)
      values ('${OTHER_EN}', '${id(2)}', 'running', '${id(705)}', 'fil')`), /check/);
  });

  await t.test("a failed claim carries no results and can be taken over", async () => {
    await asService(db, `insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
      values ('${OTHER_EN}', '${id(2)}', 'running', '${id(706)}')`);
    await asService(db, `update public.oral_reading_pronunciation_checks set status = 'failed', failure_code = 'STT_QUOTA' where attempt_id = '${OTHER_EN}'`);
    await assert.rejects(asService(db, `update public.oral_reading_pronunciation_checks set failure_code = 'bad text' where attempt_id = '${OTHER_EN}'`), /check/);
    const taken = await asService(db, `update public.oral_reading_pronunciation_checks set status = 'running', claim_id = '${id(707)}', failure_code = null
      where attempt_id = '${OTHER_EN}' and claim_id = '${id(706)}' returning claim_id`);
    assert.equal(taken.rows.length, 1);
  });

  await t.test("deleting an attempt removes its check, as with recordings", async () => {
    await db.exec(`delete from public.oral_reading_attempts where id = '${OTHER_EN}'`);
    assert.equal((await db.query(`select count(*)::int as n from public.oral_reading_pronunciation_checks where attempt_id = '${OTHER_EN}'`)).rows[0].n, 0);
  });

  await t.test("rollback removes only the new objects", async () => {
    await db.exec(sqlFile(ROLLBACK));
    const left = (await db.query(`select to_regclass('public.oral_reading_pronunciation_checks') as t,
      to_regprocedure('public.m5_pronunciation_check_guard()') as f,
      to_regclass('public.oral_reading_recordings') as recordings`)).rows[0];
    assert.deepEqual([left.t, left.f, left.recordings], [null, null, "oral_reading_recordings"]);
    assert.equal((await db.query("select count(*)::int as n from public.oral_reading_attempts")).rows[0].n, 2);
  });
});

test("verification checks each privilege separately and the rollback warns about permanent deletion", () => {
  const verify = sqlFile("supabase/tests/m5_pronunciation_checks_verify.sql");
  // A comma list is true when ANY listed privilege is held, so it must not be used.
  assert.doesNotMatch(verify, /has_table_privilege\([^)]*'[A-Z]+,[A-Z,]+'\)/);
  for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
    assert.match(verify, new RegExp(`has_table_privilege\\('service_role', 'public\\.oral_reading_pronunciation_checks', '${privilege}'\\)`));
  }
  assert.match(verify, /^begin read only;/);
  const rollback = sqlFile(ROLLBACK);
  assert.match(rollback, /PERMANENT DATA DELETION/);
  assert.match(rollback, /Do NOT create the backup in "public"/);
  assert.match(rollback, /create schema if not exists m5_backup;/);
  const migration = sqlFile(MIGRATION);
  assert.match(migration, /NOTIFY pgrst, 'reload schema';\s*COMMIT;/);
  assert.match(migration, /Lease time/);
});

test("the superseded per-part proposal is clearly marked and never referenced by the backend", () => {
  assert.match(sqlFile("supabase/proposed/m5_pronunciation_results_PROPOSED.sql"), /SUPERSEDED — DO NOT APPLY/);
  assert.doesNotMatch(sqlFile("server/services/pronunciationCheckService.js"), /oral_reading_pronunciation_parts/);
});
