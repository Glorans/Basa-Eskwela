// Real PostgreSQL 17 (PGlite, in memory) with Supabase-style roles and default
// privileges. Applies the actual B3-B6 and C2 files, then DT1. No network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const { asUser, id, sqlFile } = require("./fixtures/m5M6SecurityDatabase");

const DT1 = "supabase/migrations/20261025_m2_trusted_diagnostics.sql";
const EN = ["grade5-en-passage-v3", "3.0"];
const FIL = ["grade5-fil-passage-v3", "3.0"];

function legacyInsert(user, language, [assessmentId, version], level, tier) {
  return `insert into public.diagnostic_results(user_id,language,assessment_id,assessment_version,orv_score,comprehension_score,reading_level,difficulty_tier,transcript)
    values ('${user}','${language}','${assessmentId}','${version}',100,100,'${level}','${tier}','client transcript') returning id`;
}

function verifiedInsert(user, language, [assessmentId, version], level, tier, recording, extra = "") {
  return `insert into public.diagnostic_results(user_id,language,assessment_id,assessment_version,orv_score,comprehension_score,
      reading_level,difficulty_tier,verification_status,verification_method,verification_recording_id,verified_at${extra ? "," + extra.split("=")[0] : ""})
    values ('${user}','${language}','${assessmentId}','${version}',90,66.67,'${level}','${tier}','server_verified',
      'server_stt_receipt_v1','${recording}',now()${extra ? "," + extra.split("=")[1] : ""}) returning id`;
}

// The backend's service-role write, committed (asUser always rolls back).
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

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    -- Supabase grants new public tables and functions to every API role by default.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    -- Minimal M5/M4 stand-ins needed by C2's triggers and the M4 snapshot.
    create table public.oral_reading_attempts(id uuid primary key default gen_random_uuid(), user_id uuid, completed_at timestamptz default now());
    create table public.rooms(id uuid primary key); create table public.enrollments(id uuid primary key);
    alter table public.rooms enable row level security; alter table public.enrollments enable row level security;
    create policy m4_rooms_read on public.rooms for select to authenticated using (true);
    insert into auth.users values ('${id(1)}'), ('${id(2)}'), ('${id(3)}'), ('${id(4)}');
    create table public.profiles(id uuid primary key, role text, teacher_status text);
    insert into public.profiles values ('${id(1)}','student',null), ('${id(2)}','general_user',null),
      ('${id(3)}','student',null), ('${id(4)}','teacher','pending');
  `);
  await db.exec(sqlFile("supabase/staging/03_b3_hardened.sql"));
  await db.exec(sqlFile("supabase/diagnostic_results_language.sql"));
  await db.exec(sqlFile("supabase/diagnostic_results_bilingual.sql"));
  await db.exec(sqlFile("supabase/diagnostic_results_sentence_versions.sql"));
  // B16's actual approval function and restrictive policy loop (diagnostic_results is in it).
  const m1 = sqlFile("supabase/m1_teacher_verification.sql");
  const fnStart = m1.indexOf("create function public.m1_teacher_access_allowed()");
  await db.exec(m1.slice(fnStart, m1.indexOf("$$;", fnStart) + 3));
  const loopStart = m1.indexOf("do $$", m1.indexOf("-- Restrictive policies"));
  await db.exec(m1.slice(loopStart, m1.indexOf("end $$;", loopStart) + 7));
  await db.exec(sqlFile("supabase/staging/c2_m8_gamification_hardened.sql"));
  return db;
}

const snapshot = {
  m4Policies: `select tablename, policyname, cmd, roles::text, qual from pg_policies
    where tablename in ('rooms','enrollments') order by 1,2`,
  m4Grants: `select oid::regclass::text, relacl::text from pg_class where relname in ('rooms','enrollments') order by 1`,
};

test("DT1 on real PostgreSQL: client writes revoked, history kept, evidence immutable, C9-ready", { timeout: 120000 }, async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  // Before DT1 the browser could write any reading level for itself (the C9 finding).
  const forged = await asUser(db, id(1), legacyInsert(id(1), "en", EN, "Independent", "Hard"));
  assert.equal(forged.rows.length, 1);
  await asUser(db, id(1), legacyInsert(id(1), "fil", FIL, "Frustration", "Easy"));
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${id(1)}"}', false);
    ${legacyInsert(id(1), "en", EN, "Independent", "Hard")};
    ${legacyInsert(id(1), "fil", FIL, "Frustration", "Easy")};
    select set_config('request.jwt.claims', '{"sub":"${id(2)}"}', false);
    ${legacyInsert(id(2), "en", EN, "Instructional", "Medium")};
    reset role; select set_config('request.jwt.claims', '', false);`);
  const legacyBefore = (await db.query("select * from public.diagnostic_results order by user_id, language")).rows;
  const m8Before = (await db.query("select user_id, unlocked_difficulty from public.m8_learner_progress order by 1")).rows;
  const m4Before = { policies: (await db.query(snapshot.m4Policies)).rows, grants: (await db.query(snapshot.m4Grants)).rows };

  await db.exec(sqlFile(DT1));

  await t.test("6. historical rows are preserved unchanged and marked unverified", async () => {
    const after = (await db.query("select * from public.diagnostic_results order by user_id, language")).rows;
    assert.equal(after.length, legacyBefore.length);
    after.forEach((row, index) => {
      const { verification_status, verification_method, verification_recording_id, verified_at, ...original } = row;
      assert.deepEqual(original, legacyBefore[index]);
      assert.deepEqual([verification_status, verification_method, verification_recording_id, verified_at], ["unverified", null, null, null]);
    });
    assert.deepEqual((await db.query("select user_id, unlocked_difficulty from public.m8_learner_progress order by 1")).rows, m8Before);
  });

  await t.test("4. learners can no longer INSERT, UPDATE, DELETE or TRUNCATE diagnostic rows", async () => {
    await assert.rejects(asUser(db, id(1), legacyInsert(id(1), "en", ["other", "1"], "Independent", "Hard")), /permission denied/);
    await assert.rejects(asUser(db, id(3), verifiedInsert(id(3), "en", EN, "Independent", "Hard", id(500))), /permission denied/);
    await assert.rejects(asUser(db, id(1), "update public.diagnostic_results set reading_level='Independent' returning id"), /permission denied/);
    await assert.rejects(asUser(db, id(1), "update public.diagnostic_results set verification_status='server_verified'"), /permission denied/);
    await assert.rejects(asUser(db, id(1), "delete from public.diagnostic_results returning id"), /permission denied/);
    await assert.rejects(asUser(db, id(1), "truncate public.diagnostic_results"), /permission denied/);
    for (const role of ["anon", "authenticated"]) {
      const privileges = (await db.query(`select
        has_table_privilege('${role}','public.diagnostic_results','INSERT') as ins,
        has_table_privilege('${role}','public.diagnostic_results','UPDATE') as upd,
        has_table_privilege('${role}','public.diagnostic_results','DELETE') as del,
        has_table_privilege('${role}','public.diagnostic_results','TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') as manage,
        has_any_column_privilege('${role}','public.diagnostic_results','INSERT') as col_ins,
        has_any_column_privilege('${role}','public.diagnostic_results','UPDATE') as col_upd,
        has_table_privilege('${role}','public.diagnostic_results','SELECT') as sel`)).rows[0];
      assert.deepEqual(privileges, { ins: false, upd: false, del: false, manage: false, col_ins: false, col_upd: false, sel: role === "authenticated" });
    }
    // V-DT1c: the permissive own-row SELECT plus B16's unchanged restrictive policy.
    const policies = (await db.query(`select policyname, permissive, cmd from pg_policies
      where tablename='diagnostic_results' order by permissive, policyname`)).rows;
    assert.deepEqual(policies, [
      { policyname: "Users can read their diagnostic results", permissive: "PERMISSIVE", cmd: "SELECT" },
      { policyname: "M1 Teacher approval required", permissive: "RESTRICTIVE", cmd: "ALL" },
    ]);
    // An unapproved teacher still reads nothing (B16 restrictive policy still applies).
    assert.deepEqual((await asUser(db, id(4), "select id from public.diagnostic_results")).rows, []);
  });

  await t.test("learners read only their own rows; anonymous access is denied", async () => {
    const own = (await asUser(db, id(1), "select user_id::text from public.diagnostic_results")).rows;
    assert.equal(own.length, 2);
    assert.ok(own.every((row) => row.user_id === id(1)));
    assert.deepEqual((await asUser(db, id(3), "select id from public.diagnostic_results")).rows, []);
    await assert.rejects(asUser(db, id(1), "select id from public.diagnostic_results", "anon"), /permission denied/);
  });

  await t.test("the backend stores a separate verified row next to the unverified one", async () => {
    const verified = await asService(db, verifiedInsert(id(1), "en", EN, "Frustration", "Easy", id(501)));
    assert.equal(verified.rows.length, 1);
    const rows = (await db.query(`select verification_status, reading_level from public.diagnostic_results
      where user_id='${id(1)}' and language='en' order by verification_status`)).rows;
    assert.deepEqual(rows, [{ verification_status: "server_verified", reading_level: "Frustration" },
      { verification_status: "unverified", reading_level: "Independent" }]);
    // The learner sees the verified row through the existing SELECT policy.
    assert.equal((await asUser(db, id(1), "select id from public.diagnostic_results where verification_status='server_verified'")).rows.length, 1);
  });

  await t.test("5. one verified row per learner, language and version; one result per recording", async () => {
    await assert.rejects(asService(db, verifiedInsert(id(1), "en", EN, "Independent", "Hard", id(502))), /duplicate key/);
    await assert.rejects(asService(db, verifiedInsert(id(1), "fil", FIL, "Independent", "Hard", id(501))), /duplicate key/);
    assert.equal((await asService(db, verifiedInsert(id(1), "fil", FIL, "Instructional", "Medium", id(503)))).rows.length, 1);
  });

  await t.test("a verified row needs complete evidence; an unverified row cannot carry any", async () => {
    await assert.rejects(asService(db, `insert into public.diagnostic_results(user_id,language,assessment_id,assessment_version,orv_score,
      comprehension_score,reading_level,difficulty_tier,verification_status) values ('${id(3)}','en','${EN[0]}','3.0',90,90,'Instructional','Medium','server_verified')`),
      /verification_evidence_check/);
    await assert.rejects(asService(db, `insert into public.diagnostic_results(user_id,language,orv_score,comprehension_score,reading_level,difficulty_tier,
      verification_status,verification_method,verification_recording_id,verified_at)
      values ('${id(3)}','en',90,90,'Instructional','Medium','server_verified','m','${id(504)}',now())`), /verification_evidence_check/);
    await assert.rejects(asService(db, `insert into public.diagnostic_results(user_id,language,orv_score,comprehension_score,reading_level,difficulty_tier,verification_method)
      values ('${id(3)}','en',90,90,'Instructional','Medium','server_stt_receipt_v1')`), /must be server-verified/);
    // After DT1 no new unverified evidence can be written, even by the service role.
    await assert.rejects(asService(db, legacyInsert(id(3), "en", EN, "Independent", "Hard")), /must be server-verified/);
    await assert.rejects(asService(db, `insert into public.diagnostic_results(user_id,language,orv_score,comprehension_score,reading_level,difficulty_tier,verification_status)
      values ('${id(3)}','en',90,90,'Instructional','Medium','trusted')`), /must be server-verified/);
  });

  await t.test("evidence is immutable: no in-place upgrade of history and no rewrite of verified results", async () => {
    await assert.rejects(db.query(`update public.diagnostic_results set verification_status='server_verified', verification_method='manual',
      verification_recording_id='${id(505)}', verified_at=now() where user_id='${id(2)}'`), /read-only/);
    // Unverified rows are fully read-only, so M8's UPDATE OF reading_level trigger cannot
    // re-fire from historical evidence, even with an unchanged value.
    await assert.rejects(db.query(`update public.diagnostic_results set reading_level=reading_level
      where verification_status='unverified'`), /read-only/);
    await assert.rejects(db.query(`update public.diagnostic_results set reading_level='Independent', difficulty_tier='Hard'
      where verification_status='server_verified'`), /cannot be modified/);
    await assert.rejects(db.query(`update public.diagnostic_results set verification_recording_id='${id(506)}'
      where verification_status='server_verified'`), /cannot be changed/);
    assert.equal((await db.query(`select count(*)::int as n from public.diagnostic_results where verification_status='unverified'`)).rows[0].n, 3);
  });

  await t.test("7/12. C9 eligibility helper reads only verified, same-language evidence", async () => {
    const level = async (user, language) => (await asService(db,
      `select public.m2_trusted_reading_level('${user}','${language}') as level`)).rows[0].level;
    assert.equal(await level(id(1), "en"), "Frustration");
    assert.equal(await level(id(1), "fil"), "Instructional");
    assert.equal(await level(id(2), "en"), null); // unverified only
    assert.equal(await level(id(3), "en"), null); // no diagnostic
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(asUser(db, id(1), `select public.m2_trusted_reading_level('${id(1)}','en')`, role), /permission denied/);
    }
    const execute = (await db.query(`select p.oid::regprocedure::text as fn,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
        p.prosecdef as definer, array_to_string(p.proconfig, ',') as config
      from pg_proc p where p.proname like 'm2\\_%' order by 1`)).rows;
    assert.deepEqual(execute, [
      { fn: "m2_protect_diagnostic_verification()", anon: false, auth: false, definer: false, config: "search_path=\"\"" },
      { fn: "m2_trusted_reading_level(uuid,text)", anon: false, auth: false, definer: false, config: "search_path=\"\"" },
    ]);
  });

  await t.test("12. the existing M8 diagnostic trigger still runs for verified inserts (C9 will replace it)", async () => {
    const progress = (await db.query(`select unlocked_difficulty from public.m8_learner_progress where user_id='${id(1)}'`)).rows[0];
    // Last verified insert was Filipino Instructional: today's shared, last-write-wins behaviour, unchanged by DT1.
    assert.equal(progress.unlocked_difficulty, "Medium");
  });

  await t.test("11. M4 policies and grants are untouched", async () => {
    assert.deepEqual((await db.query(snapshot.m4Policies)).rows, m4Before.policies);
    assert.deepEqual((await db.query(snapshot.m4Grants)).rows, m4Before.grants);
    assert.doesNotMatch(sqlFile(DT1), /\b(?:rooms|enrollments|room_modules|reading_activity_assignments|m8_learner_progress|m6_)\b/);
  });

  await t.test("audit A3/A4/A5/A7 report nothing for diagnostic objects", async () => {
    const audit = sqlFile("supabase/staging/audit_stage_b.sql");
    const section = (name) => audit.slice(audit.indexOf(`-- ${name}.`), audit.indexOf(";", audit.indexOf(`-- ${name}.`)) + 1);
    for (const name of ["A1", "A2", "A3", "A4"]) {
      const rows = (await db.query(section(name))).rows;
      assert.deepEqual(rows.filter((row) => /diagnostic/.test(JSON.stringify(row))), [], name);
    }
    assert.deepEqual((await db.query(section("A5"))).rows.filter((row) => /m2_|diagnostic/.test(JSON.stringify(row))), []);
    assert.deepEqual((await db.query(section("A7"))).rows.filter((row) => /m2_|diagnostic/.test(JSON.stringify(row))), []);
  });

  await t.test("DT1 refuses to run twice", async () => {
    await assert.rejects(db.exec(sqlFile(DT1)), /already applied/);
    await db.exec("rollback"); // DT1's own BEGIN is left aborted by the guard.
    assert.equal((await db.query("select count(*)::int as n from public.diagnostic_results")).rows[0].n, 5);
  });

  await t.test("read-only verification file runs on the migrated database", async () => {
    await db.exec(sqlFile("supabase/staging/verify_dt1_diagnostic_trust.sql"));
  });
});
