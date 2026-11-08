// PROPOSED m4_archived_room_readonly_v1 on real PostgreSQL 17 (PGlite, in memory), on top of the installed
// m4_room_archive, M8 F1-F4 and reward claiming. No network, no staging.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile } = require("./fixtures/m5M6SecurityDatabase");
const { ROOM, USERS } = require("./fixtures/m8TrustDatabase");
const { completeM6, createM8F1BaseDatabase, newModule, newRoom, newUser, nextId, readAloud, totalXp } = require("./fixtures/m8F1Database");

const F = (name) => `supabase/proposed/${name}.sql`;
const PRIOR = ["m8_f1_xp_rewards_v1_PROPOSED", "m8_f2_badges_streaks_v1_PROPOSED", "m8_f3_achievements_v1_PROPOSED", "m8_f4_rankings_v1_PROPOSED",
  "m8_f2_f3_reward_claims_v1_PROPOSED"].map(F);
const READONLY = F("m4_archived_room_readonly_v1_PROPOSED");
const ROLLBACK = F("m4_archived_room_readonly_v1_ROLLBACK_PROPOSED");
const VERIFY = F("m4_archived_room_readonly_v1_VERIFY_READONLY");

const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function asUser(db, user, sql, args = [], role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}; set local request.jwt.claims = '${user ? JSON.stringify({ sub: user }) : "{}"}'`);
    const rows = (await db.query(sql, args)).rows;
    await db.exec("commit");
    return rows;
  } catch (error) { await db.exec("rollback"); throw error; }
}
const archive = (db, room, value = true) => asUser(db, USERS.teacher, "select public.m4_set_room_archived($1,$2) changed", [room, value]);
const days = (db, user) => scalar(db, "select count(*)::int from public.m8_reading_days where user_id = $1", [user]);
const fingerprints = async (db) => Object.fromEntries((await db.query(`select p.oid::regprocedure::text f, md5(pg_get_functiondef(p.oid)) m
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and p.proname not in ('m4_room_archived_locked','m4_guard_archived_learner_results','m4_guard_archived_room_management')`)).rows.map((r) => [r.f, r.m]));
const protectedRows = async (db) => {
  const out = {};
  for (const table of ["m8_xp_events", "m8_earned_badges", "m8_reading_days", "m8_learner_progress", "m8_badge_claims", "m5_verified_readings",
    "oral_reading_attempts", "m6_comprehension_attempts", "m6_comprehension_responses", "enrollments", "room_modules"]) {
    out[table] = (await db.query(`select * from public.${table} t order by t::text`)).rows;
  }
  return out;
};

/** An M6 assessment as the backend starts it (in progress), with its first answer saved. */
async function startM6(db, { user, module, passage }) {
  const questions = Array.from({ length: 3 }, () => ({ id: nextId(), type: "literal", questionText: "Q?", options: ["a", "b", "c", "d"], correctOptionIndex: 0, scaffoldingHint: "Read." }));
  const { rows } = await db.query(`insert into public.m6_comprehension_attempts(user_id, submission_id, module_id, passage_id, room_id, assignment_id,
      passage_title, passage_text, language, question_snapshot, status)
    values ($1,$2,$3,$4,$5,$6,'Passage',$7,$8,$9,'in_progress') returning id`,
  [user, nextId(), module.id, passage.id, module.room ?? null, module.assignment ?? null, passage.text, passage.language, JSON.stringify(questions)]);
  const answer = (question) => db.query(`insert into public.m6_comprehension_responses(attempt_id, question_id, first_option_index, first_answer_correct, resolved)
    values ($1,$2,0,true,true)`, [rows[0].id, question.id]);
  await answer(questions[0]);
  const complete = async () => {
    await db.exec("set role service_role");
    try { return await db.query("select public.m6_apply_action($1,$2,null,'complete',null,null)", [rows[0].id, user]); } finally { await db.exec("reset role"); }
  };
  return { id: rows[0].id, answerNext: () => answer(questions[1]), answerLast: () => answer(questions[2]), complete };
}

test("M4 archived classrooms are read-only", { timeout: 900000 }, async (t) => {
  const db = await createM8F1BaseDatabase();
  t.after(() => db.close());
  // Functions m4_room_archive uses that this fixture does not replay (as on Staging).
  await db.exec(`
    create or replace function public.m4_current_role() returns text language sql stable security definer set search_path = ''
      as $$ select role from public.profiles where id = auth.uid() $$;
    do $$ begin
      if to_regprocedure('public.m1_teacher_access_allowed()') is null then
        create function public.m1_teacher_access_allowed() returns boolean language sql stable security definer set search_path = ''
          as $f$ select coalesce((select p.role <> 'teacher' or p.teacher_status = 'approved' from public.profiles p where p.id = auth.uid()), false) $f$;
      end if;
      if to_regprocedure('public.is_admin()') is null then
        create function public.is_admin() returns boolean language sql stable security definer set search_path = ''
          as $f$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $f$;
      end if;
    end $$;
    alter table public.rooms add column if not exists description text, add column if not exists subject text;
    -- Stand-ins for the Staging M5 recording and pronunciation-check tables (same key columns).
    create table if not exists public.oral_reading_recordings(id uuid primary key default gen_random_uuid(),
      attempt_id uuid not null references public.oral_reading_attempts(id) on delete cascade, user_id uuid not null, segments text[] not null default '{}');
    create table if not exists public.oral_reading_pronunciation_checks(id uuid primary key default gen_random_uuid(),
      attempt_id uuid not null references public.oral_reading_attempts(id) on delete cascade, user_id uuid not null, status text not null default 'running');`);

  await t.test("stops without m4_room_archive", async () => {
    await assert.rejects(db.exec(sqlFile(READONLY)), /apply m4_room_archive first/);
    await db.exec("rollback");
  });
  await db.exec(sqlFile("supabase/proposed/m4_room_archive_PROPOSED.sql"));
  for (const file of PRIOR) await db.exec(sqlFile(file));

  // History before the change: a completed activity, plus an assessment left open in a tab.
  const pupil = await newUser(db, "student");
  const module = await newModule(db, { assign: true, passages: [{}, {}, {}] });
  await readAloud(db, { user: pupil, module, passage: module.passages[0] });
  await completeM6(db, { user: pupil, module, passage: module.passages[0] });
  await readAloud(db, { user: pupil, module, passage: module.passages[1] });
  const pending = await startM6(db, { user: pupil, module, passage: module.passages[1] });
  await readAloud(db, { user: pupil, module, passage: module.passages[2] });
  const partial = await startM6(db, { user: pupil, module, passage: module.passages[2] });
  const savedReading = (await db.query("select id from public.oral_reading_attempts where user_id = $1 order by completed_at limit 1", [pupil])).rows[0].id;
  const xpBefore = await totalXp(db, pupil);
  const daysBefore = await days(db, pupil);
  assert.ok(xpBefore > 0);
  const fnBefore = await fingerprints(db);

  await db.exec(sqlFile(VERIFY));
  await db.exec(sqlFile(READONLY));
  await db.exec(sqlFile(VERIFY));

  await t.test("applying changes no function and no row; it cannot run twice", async () => {
    assert.deepEqual(await fingerprints(db), fnBefore);
    assert.equal(await scalar(db, "select count(*)::int from pg_trigger where tgname = 'm4_archived_room_readonly'"), 10);
    await assert.rejects(db.exec(sqlFile(READONLY)), /already installed/); await db.exec("rollback");
    for (const role of ["authenticated", "anon"]) {
      assert.equal(await scalar(db, `select has_function_privilege('${role}','public.m4_room_archived_locked(uuid)','EXECUTE')`), false);
    }
  });

  await t.test("an active room works as before: the open assessment can still take answers", async () => {
    await pending.answerNext();
    await pending.answerLast(); // every question answered; only "complete" is left
  });

  await archive(db, ROOM);
  const snapshot = await protectedRows(db);

  await t.test("an assessment opened before Archive cannot be answered or submitted; it stays as it was", async () => {
    await assert.rejects(partial.answerNext(), { code: "55000", message: /classroom is archived/ }, "a new answer");
    await assert.rejects(pending.complete(), { code: "55000", message: /classroom is archived/ }, "submitting a fully answered assessment");
    for (const attempt of [pending, partial]) {
      assert.equal(await scalar(db, "select status from public.m6_comprehension_attempts where id = $1", [attempt.id]), "in_progress", "kept, not deleted or reset");
    }
    assert.equal(await totalXp(db, pupil), xpBefore, "no new XP");
    assert.equal(await days(db, pupil), daysBefore, "no new reading day");
  });

  await t.test("no new reading, recording, pronunciation check or verified reading in the archived room", async () => {
    await assert.rejects(readAloud(db, { user: pupil, module, passage: module.passages[0] }), { code: "55000" }, "new oral attempt (m4_room_archive)");
    await assert.rejects(startM6(db, { user: pupil, module, passage: module.passages[0] }), { code: "55000" }, "new assessment (m4_room_archive)");
    await assert.rejects(db.query("insert into public.oral_reading_recordings(attempt_id, user_id, segments) values ($1,$2,'{}')", [savedReading, pupil]), { code: "55000" });
    await assert.rejects(db.query(`insert into public.m5_verified_readings(attempt_id, user_id, language, content_fingerprint, words_correct, words_total, completed_at)
      values ($1,$2,'en','x',1,1,now())`, [savedReading, pupil]), { code: "55000" });
    await assert.rejects(db.query("update public.oral_reading_attempts set pronunciation_accuracy = 100 where id = $1", [savedReading]), { code: "55000" }, "historical score");
    if (await scalar(db, "select to_regclass('public.oral_reading_pronunciation_checks') is not null")) {
      await assert.rejects(db.query("insert into public.oral_reading_pronunciation_checks(attempt_id, user_id) values ($1,$2)", [savedReading, pupil]), { code: "55000" });
    }
    assert.deepEqual(await protectedRows(db), snapshot, "nothing changed");
  });

  await t.test("the Teacher cannot change the archived room, its assignments or its students", async () => {
    // As the table owner: a trigger binds every writer (client, service-role backend, SECURITY DEFINER function).
    await assert.rejects(db.query("update public.rooms set room_name = 'Renamed' where id = $1", [ROOM]), { code: "55000" });
    await assert.rejects(db.query("update public.room_modules set removed_at = now() where id = $1", [module.assignment]), { code: "55000" });
    if (await scalar(db, "select count(*)::int from public.reading_activity_assignments where room_id = $1", [ROOM])) {
      await assert.rejects(db.query("update public.reading_activity_assignments set status = 'completed' where room_id = $1", [ROOM]), { code: "55000" });
    }
    await assert.rejects(db.query("delete from public.enrollments where room_id = $1 and student_id = $2", [ROOM, pupil]), { code: "55000" }, "even a service-role delete");
    await assert.rejects(db.query("delete from public.room_modules where id = $1", [module.assignment]), { code: "55000" });
    await assert.rejects(db.query("delete from public.rooms where id = $1", [ROOM]), { code: "55000" });
    assert.deepEqual(await protectedRows(db), snapshot);
  });

  await t.test("a cascade (an account deleted) still works in an archived room", async () => {
    const leaving = nextId();
    await db.query("insert into auth.users(id) values ($1)", [leaving]);
    await db.query("insert into public.profiles(id, role) values ($1,'student')", [leaving]);
    await db.exec("set session_replication_role = replica");
    await db.query("insert into public.enrollments(room_id, student_id) values ($1,$2)", [ROOM, leaving]); // joined before the archive
    await db.exec("set session_replication_role = origin");
    await db.query("delete from public.profiles where id = $1", [leaving]);
    assert.equal(await scalar(db, "select count(*)::int from public.enrollments where student_id = $1", [leaving]), 0);
  });

  await t.test("another active classroom and Independent Learners are unaffected", async () => {
    const other = await newUser(db);
    await db.query("update public.profiles set role = 'student' where id = $1", [other]);
    const otherRoom = await newRoom(db, other);
    const assignment = nextId();
    await db.query("insert into public.room_modules(id, room_id, module_id, assigned_by) values ($1,$2,$3,$4)", [assignment, otherRoom, module.id, USERS.teacher]);
    const moved = { ...module, room: otherRoom, assignment };
    await readAloud(db, { user: other, module: moved, passage: module.passages[0] });
    await completeM6(db, { user: other, module: moved, passage: module.passages[0] });
    assert.ok(await totalXp(db, other) > 0, "same module, active room: XP as normal");
    const il = await newUser(db);
    const ilModule = await newModule(db);
    await readAloud(db, { user: il, module: ilModule, passage: ilModule.passages[0] });
    await completeM6(db, { user: il, module: ilModule, passage: ilModule.passages[0] });
    assert.ok(await totalXp(db, il) > 0, "Independent Learner: XP as normal");
    await db.query("update public.rooms set room_name = 'Still editable' where id = $1", [otherRoom]);
  });

  await t.test("reading the archived room and its results still works", async () => {
    assert.equal(await scalar(db, "select count(*)::int from public.oral_reading_attempts where room_id = $1 and user_id = $2", [ROOM, pupil]), 3, "every saved reading still there");
    assert.equal(await scalar(db, "select count(*)::int from public.m6_comprehension_responses r join public.m6_comprehension_attempts a on a.id = r.attempt_id where a.user_id = $1", [pupil]) > 0, true);
    const mine = await asUser(db, pupil, "select * from public.m8_classroom_rankings($1,'en')", [ROOM]);
    assert.equal(mine.filter((r) => r.is_me).length, 1, "historical leaderboard still visible");
  });

  await t.test("Restore re-enables normal activity: the open assessment completes and earns XP", async () => {
    assert.equal((await archive(db, ROOM, false))[0].changed, true);
    await pending.complete();
    assert.equal(await scalar(db, "select status from public.m6_comprehension_attempts where id = $1", [pending.id]), "completed");
    assert.ok(await totalXp(db, pupil) > xpBefore, "XP as normal after Restore");
    await db.query("update public.rooms set room_name = 'Renamed after restore' where id = $1", [ROOM]);
    await partial.answerNext(); // the partly answered assessment continues too
  });

  await t.test("only the room's Teacher or an Admin can archive; Archive itself is not blocked by the new rules", async () => {
    const stranger = await newUser(db, "teacher");
    await assert.rejects(asUser(db, stranger, "select public.m4_set_room_archived($1,true)", [ROOM]), { code: "42501" });
    await assert.rejects(asUser(db, pupil, "select public.m4_set_room_archived($1,true)", [ROOM]), { code: "42501" });
    assert.equal((await archive(db, ROOM))[0].changed, true);
    assert.equal((await archive(db, ROOM, false))[0].changed, true);
  });

  await t.test("the rollback removes only the new rules", async () => {
    await db.exec(sqlFile(ROLLBACK));
    assert.equal(await scalar(db, "select count(*)::int from pg_trigger where tgname = 'm4_archived_room_readonly'"), 0);
    assert.deepEqual(await fingerprints(db), fnBefore);
    await db.exec(sqlFile(READONLY));
  });
});
