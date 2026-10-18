const test = require("node:test");
const assert = require("node:assert/strict");
const { createSecurityDatabase, asUser, id, sqlFile } = require("./fixtures/m5M6SecurityDatabase");

const migration = sqlFile("supabase/migrations/20261012_m5_m6_uploaded_reading.sql");
const guard = migration.match(/-- BEGIN SECURITY PREFLIGHT[\s\S]*?-- END SECURITY PREFLIGHT/)[0];
const policySnapshot = `select polrelid::regclass::text as table_name, polname, polcmd, polpermissive,
  polroles, pg_get_expr(polqual,polrelid) as qual, pg_get_expr(polwithcheck,polrelid) as check_expr
  from pg_policy order by polrelid,polname`;
const privilegeSnapshot = `select oid::regclass::text as table_name,relacl::text,relrowsecurity,relforcerowsecurity
  from pg_class where relnamespace='public'::regnamespace and relkind='r' order by oid`;

test("real PostgreSQL RLS: M3 compatibility and M5/M6 migration security", { timeout: 120000 }, async t => {
  const db = await createSecurityDatabase();
  t.after(() => db.close());
  const beforePolicies = (await db.query(policySnapshot)).rows;
  const beforeGrants = (await db.query(privilegeSnapshot)).rows;

  async function roleMatrix() {
    const grant = await db.query("select has_table_privilege('authenticated','public.comprehension_question_answers','SELECT') as allowed");
    assert.equal(grant.rows[0].allowed, true);
    for (const n of [1, 2, 5, 6, 7]) {
      const visible = await asUser(db, id(n), "select question_id,correct_answer from public.comprehension_question_answers");
      assert.deepEqual(visible.rows, [], `persona ${n} must not read keys, even for owned generated material`);
      const update = await asUser(db, id(n), "update public.comprehension_question_answers set correct_answer='forged' returning question_id");
      assert.deepEqual(update.rows, []);
      const deleted = await asUser(db, id(n), "delete from public.comprehension_question_answers returning question_id");
      assert.deepEqual(deleted.rows, []);
      await assert.rejects(asUser(db, id(n), `insert into public.comprehension_question_answers(question_id,correct_answer) values ('${id(999)}','forged')`), /row-level security/);
    }
    for (const [n, expected] of [[3, id(100)], [4, id(101)]]) {
      assert.deepEqual((await asUser(db, id(n), "select question_id from public.comprehension_question_answers")).rows, [{ question_id: expected }]);
      assert.deepEqual((await asUser(db, id(n), "update public.comprehension_question_answers set correct_answer='reviewed' returning question_id")).rows, [{ question_id: expected }]);
      await assert.rejects(asUser(db, id(n), `insert into public.comprehension_question_answers(question_id,correct_answer) values ('${id(999)}','forged')`), /row-level security/);
      assert.deepEqual((await asUser(db, id(n), "delete from public.comprehension_question_answers returning question_id")).rows, []);
    }
    const total = (await db.query("select count(*)::int as n from public.comprehension_question_answers")).rows[0].n;
    assert.equal((await asUser(db, id(8), "select question_id from public.comprehension_question_answers")).rows.length, total);
    assert.equal((await asUser(db, id(8), "update public.comprehension_question_answers set correct_answer='admin' returning question_id")).rows.length, total);
    assert.equal((await asUser(db, id(8), "delete from public.comprehension_question_answers returning question_id")).rows.length, total);
    assert.equal((await asUser(db, id(8), `insert into public.comprehension_question_answers(question_id,correct_answer) values ('${id(999)}','admin') returning question_id`)).rows.length, 1);
    await assert.rejects(asUser(db, id(1), "select correct_answer from public.comprehension_question_answers", "anon"), /permission denied/);
    assert.deepEqual((await asUser(db, id(999), "select correct_answer from public.comprehension_question_answers")).rows, []);
    for (const n of [1, 2, 3, 4, 8]) {
      assert.equal((await asUser(db, id(n), "select public.m1_teacher_access_allowed() as allowed")).rows[0].allowed, true);
    }
    for (const n of [5, 6, 7]) {
      assert.equal((await asUser(db, id(n), "select public.m1_teacher_access_allowed() as allowed")).rows[0].allowed, false);
    }
    // Real SQL entry points reject untrusted writes/reads before scoring executes.
    await assert.rejects(asUser(db, id(1), "insert into public.oral_reading_attempts default values"), /permission denied/);
    await assert.rejects(asUser(db, id(1), "select question_snapshot from public.m6_comprehension_attempts"), /permission denied/);
    await assert.rejects(asUser(db, id(1), "insert into public.m6_comprehension_responses default values"), /permission denied/);
    await assert.rejects(asUser(db, id(1), "select public.m6_apply_action(null,null,null,'complete',null,null)"), /permission denied/);
    assert.equal((await db.query("select has_function_privilege('service_role','public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)','EXECUTE') as allowed")).rows[0].allowed, true);
  }

  await t.test("actual historical M1/M3 policy SQL enforces the complete role matrix", roleMatrix);
  await t.test("preflight and verification run the identical compatibility guard", () => {
    for (const name of ["preflight", "verify"]) {
      assert.equal(sqlFile(`supabase/tests/m5_m6_uploaded_reading_${name}.sql`).match(/-- BEGIN SECURITY PREFLIGHT[\s\S]*?-- END SECURITY PREFLIGHT/)[0], guard);
    }
  });
  await t.test("read-only preflight and live persona script execute on nonempty fixtures", async () => {
    await db.exec(sqlFile("supabase/tests/m5_m6_uploaded_reading_preflight.sql"));
    await db.exec(sqlFile("supabase/tests/m5_m6_answer_key_rls.sql"));
  });

  const unsafe = [
    ["RLS disabled", "alter table public.comprehension_question_answers disable row level security"],
    ["same policy name, leaked keys", 'alter policy "M3 admins and owning teachers read answer keys" on public.comprehension_question_answers using (true)'],
    ["additional permissive SELECT", "create policy leak on public.comprehension_question_answers for select to authenticated using (true)"],
    ["PUBLIC policy leak", "create policy leak on public.comprehension_question_answers for select to public using (true)"],
    ["inherited policy leak", "create role readers; grant readers to authenticated; create policy leak on public.comprehension_question_answers for select to readers using (true)"],
    ["restrictive policy breaks approved M3 reads", "create policy blocked on public.comprehension_question_answers as restrictive for select to authenticated using (false)"],
    ["M1 approval rule removed", 'drop policy "M1 Teacher approval required" on public.comprehension_question_answers'],
    ["M1 function changed under same name", "create or replace function public.m1_teacher_access_allowed() returns boolean language sql stable security definer set search_path='' as $$select true$$"],
    ["M1 function blocks legitimate users", "create or replace function public.m1_teacher_access_allowed() returns boolean language sql stable security definer set search_path='' as $$select false$$"],
    ["role function lies", "create or replace function public.m3_current_role() returns text language sql stable security definer set search_path='' as $$select 'admin'::text$$"],
    ["ownership function lies", "create or replace function public.m3_owns_material(target_material_id uuid) returns boolean language sql stable security definer set search_path='' as $$select true$$"],
    ["helper search path drift", "alter function public.m3_current_role() set search_path=public"],
    ["authenticated BYPASSRLS", "alter role authenticated bypassrls"],
    ["authenticated table owner", "alter table public.comprehension_question_answers owner to authenticated"],
    ["anonymous SELECT grant", "grant select on public.comprehension_question_answers to anon"],
    ["anonymous column SELECT grant", "grant select(correct_answer) on public.comprehension_question_answers to anon"],
    ["removing legitimate M3 SELECT", "revoke select on public.comprehension_question_answers from authenticated"],
    ["client oral scores", "grant insert on public.oral_reading_attempts to authenticated"],
    ["client oral score column", "grant update(pronunciation_accuracy) on public.oral_reading_attempts to authenticated"],
    ["client M6 snapshot column", "grant select(question_snapshot) on public.m6_comprehension_attempts to authenticated"],
    ["client comprehension responses", "grant insert on public.m6_comprehension_responses to authenticated"],
    ["client scoring function", "grant execute on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) to authenticated"],
    ["anonymous scoring function", "grant execute on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) to anon"],
  ];
  for (const [label, mutation] of unsafe) {
    await t.test(`guard rejects ${label}`, async () => {
      await db.exec("begin");
      try {
        await db.exec(mutation);
        await assert.rejects(db.exec(guard), /Stop|Unreviewed|Expected|prerequisites/);
      } finally { await db.exec("rollback"); }
    });
  }
  await t.test("policy names are not used as evidence of security", async () => {
    await db.exec('begin; alter policy "M3 admins and owning teachers read answer keys" on public.comprehension_question_answers rename to "same semantics, different name"');
    try { await db.exec(guard); } finally { await db.exec("rollback"); }
  });
  await t.test("migration preserves records, M3/M4 policies and grants", async () => {
    await db.exec(`insert into public.oral_reading_attempts(id,user_id,module_id,passage_snapshot,transcript,
      duration_seconds,reading_speed_wpm,pronunciation_accuracy,expected_word_count,detected_error_count,word_metrics)
      values ('${id(900)}','${id(1)}','${id(50)}','Historical passage','Historical transcript',5,12,100,1,0,'[]');
      insert into public.m6_comprehension_attempts(id,user_id,submission_id,module_id,passage_id,passage_title,passage_text,language,question_snapshot)
      values ('${id(901)}','${id(1)}','${id(902)}','${id(50)}','${id(51)}','Historical','Historical passage','en','[{}]');`);
    const beforeM5 = (await db.query("select to_jsonb(a) as row from public.oral_reading_attempts a")).rows;
    const beforeM6 = (await db.query("select * from public.m6_comprehension_attempts")).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query(policySnapshot)).rows, beforePolicies);
    assert.deepEqual((await db.query(privilegeSnapshot)).rows, beforeGrants);
    assert.deepEqual((await db.query("select to_jsonb(a)-'material_id'-'activity_assignment_id' as row from public.oral_reading_attempts a")).rows, beforeM5);
    // Compare each pre-existing column; PostgreSQL JSON and JS date encodings differ.
    const afterM6 = (await db.query("select * from public.m6_comprehension_attempts")).rows;
    for (const [key, value] of Object.entries(beforeM6[0])) assert.deepEqual(afterM6[0][key], value);
  });
  await t.test("M3 permissions and student denial remain identical after migration", roleMatrix);
  await t.test("post-migration read-only verification and RLS personas pass", async () => {
    await db.exec(sqlFile("supabase/tests/m5_m6_uploaded_reading_verify.sql"));
    await db.exec(sqlFile("supabase/tests/m5_m6_answer_key_rls.sql"));
  });
});
