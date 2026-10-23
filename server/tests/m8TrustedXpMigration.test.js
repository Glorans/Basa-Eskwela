// C9 on real PostgreSQL (PGlite): replays core, B3-B6, legacy diagnostics, C2-C7
// and DT1, demonstrates the C3 defect, then applies C9. No network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { id, sqlFile, asUser } = require("./fixtures/m5M6SecurityDatabase");
const {
  ACTIVITY, MATERIAL, MODULE, PENDING_ROOM, ROOM, ROOM_MODULE, USERS,
  completeAttempt, finishAttempt, createM8TrustDatabase, verifiedDiagnostic,
} = require("./fixtures/m8TrustDatabase");

const C9 = "supabase/migrations/20261026_m8_trusted_xp.sql";

async function xp(db, user) {
  return (await db.query(`select source_type, source_id::text, xp_earned from public.m8_xp_events
    where user_id = $1 order by created_at, source_id`, [user])).rows;
}
async function status(db, attemptId) {
  return (await db.query("select status from public.m6_comprehension_attempts where id = $1", [attemptId])).rows[0]?.status;
}
async function attemptCount(db, user) {
  return (await db.query("select count(*)::int n from public.m6_comprehension_attempts where user_id = $1", [user])).rows[0].n;
}
async function badges(db, user) {
  return (await db.query("select badge_id from public.m8_earned_badges where user_id=$1 order by 1", [user])).rows.map((r) => r.badge_id);
}
async function difficulty(db, user) {
  return (await db.query("select unlocked_difficulty from public.m8_learner_progress where user_id=$1", [user])).rows[0]?.unlocked_difficulty;
}
async function inRollback(db, work) {
  await db.exec("begin");
  try { return await work(); } finally { await db.exec("rollback"); }
}

const snapshots = {
  m4: `select c.relname, c.relacl::text, c.relrowsecurity,
      (select json_agg(json_build_object('name', p.polname, 'cmd', p.polcmd, 'permissive', p.polpermissive,
        'qual', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid)) order by p.polname)
       from pg_policy p where p.polrelid = c.oid)::text as policies
    from pg_class c where c.relnamespace = 'public'::regnamespace
      and c.relname in ('rooms','enrollments','room_modules','reading_activity_assignments') order by 1`,
  m4Triggers: `select tgrelid::regclass::text, tgname, tgenabled from pg_trigger where not tgisinternal
    and tgrelid in ('public.rooms'::regclass,'public.enrollments'::regclass,'public.room_modules'::regclass,
      'public.reading_activity_assignments'::regclass) order by 1,2`,
  m4Functions: `select proname, pg_get_functiondef(oid) as definition, proacl::text as acl from pg_proc
    where pronamespace='public'::regnamespace and proname in ('is_admin','m4_current_role','m6_is_enrolled_in_room','join_room_by_code') order by 1`,
  history: `select (select json_agg(e order by e.user_id, e.badge_id) from public.m8_earned_badges e)::text as badges,
    (select json_agg(x order by x.id) from public.m8_xp_events x)::text as xp,
    (select json_agg(d order by d.id) from public.diagnostic_results d)::text as diagnostics`,
};

test("C9 on real PostgreSQL: trusted, non-blocking M8 XP", { timeout: 180000 }, async (t) => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());

  await t.test("before C9: the C3 trigger rolls back a valid completion and trusts legacy unlocks", async () => {
    await inRollback(db, async () => {
      await assert.rejects(completeAttempt(db, { user: USERS.generalNoDiagnostic, module: MODULE.enHard }), /Reading difficulty is locked/);
    });
    // A learner-written Independent claim (pre-DT1) unlocked Hard XP.
    await inRollback(db, async () => {
      await completeAttempt(db, { user: USERS.generalUnverified, module: MODULE.enHard });
      assert.deepEqual(await xp(db, USERS.generalUnverified), [{ source_type: "module", source_id: MODULE.enHard, xp_earned: 80 }]);
    });
  });

  // Verified diagnostics written by the backend after DT1 (old C2 sync still runs here).
  await verifiedDiagnostic(db, USERS.general, "en", "Independent", id(7001));
  await verifiedDiagnostic(db, USERS.general, "fil", "Frustration", id(7002));
  await verifiedDiagnostic(db, USERS.student, "en", "Frustration", id(7003));

  const m4Before = { tables: (await db.query(snapshots.m4)).rows, triggers: (await db.query(snapshots.m4Triggers)).rows,
    functions: (await db.query(snapshots.m4Functions)).rows };
  const historyBefore = (await db.query(snapshots.history)).rows[0];
  const functionsBefore = (await db.query(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace`)).rows[0].n;
  await db.exec(sqlFile(C9));

  await t.test("migration keeps history: badges, XP events and diagnostic rows are unchanged", async () => {
    assert.deepEqual((await db.query(snapshots.history)).rows[0], historyBefore);
  });

  await t.test("display summary is recomputed from verified results only", async () => {
    assert.equal(await difficulty(db, USERS.generalUnverified), "Easy"); // only unverified history
    assert.equal(await difficulty(db, USERS.student), "Easy");           // verified EN Frustration replaces the legacy Hard
    assert.equal(await difficulty(db, USERS.general), "Hard");           // highest verified tier (EN Independent)
  });

  await t.test("historical level_up badges are preserved, but unverified history earns no new ones", async () => {
    assert.deepEqual(await badges(db, USERS.generalUnverified), ["level_up"]);
    await verifiedDiagnostic(db, USERS.generalNoDiagnostic, "fil", "Frustration", id(7004));
    assert.deepEqual(await badges(db, USERS.generalNoDiagnostic), []);
    await verifiedDiagnostic(db, USERS.generalNoDiagnostic, "en", "Instructional", id(7005));
    assert.deepEqual(await badges(db, USERS.generalNoDiagnostic), ["level_up"]);
    assert.equal(await difficulty(db, USERS.generalNoDiagnostic), "Medium");
    // Reset this learner for the "no trusted diagnostic" scenarios below.
    await db.exec(`alter table public.diagnostic_results disable trigger diagnostic_results_protect_verification;
      delete from public.diagnostic_results where user_id='${USERS.generalNoDiagnostic}';
      delete from public.m8_earned_badges where user_id='${USERS.generalNoDiagnostic}';
      alter table public.diagnostic_results enable trigger diagnostic_results_protect_verification;`);
  });

  await t.test("authorized Easy/Medium/Hard independent completions earn their tier XP", async () => {
    for (const module of [MODULE.enEasy, MODULE.enMedium, MODULE.enHard]) {
      const attempt = await completeAttempt(db, { user: USERS.general, module });
      assert.equal(await status(db, attempt), "completed");
    }
    assert.deepEqual((await xp(db, USERS.general)).map((row) => row.xp_earned), [30, 50, 80]);
  });

  await t.test("English Hard / Filipino Easy: eligibility is per language; above-tier work is capped", async () => {
    await completeAttempt(db, { user: USERS.general, module: MODULE.filHard, language: "fil" });
    await completeAttempt(db, { user: USERS.general, module: MODULE.filEasy, language: "fil" });
    const filipino = (await xp(db, USERS.general)).filter((row) => [MODULE.filHard, MODULE.filEasy].includes(row.source_id));
    assert.deepEqual(filipino.map((row) => row.xp_earned), [30, 30]);
  });

  await t.test("teacher-assigned work above the student's diagnostic level earns full tier XP", async () => {
    const attempt = await completeAttempt(db, { user: USERS.student, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enHard });
    assert.equal(await status(db, attempt), "completed");
    assert.deepEqual(await xp(db, USERS.student), [{ source_type: "module", source_id: MODULE.enHard, xp_earned: 80 }]);
    await completeAttempt(db, { user: USERS.student, module: null, room: ROOM, material: MATERIAL, activity: ACTIVITY });
    assert.deepEqual((await xp(db, USERS.student)).at(-1), { source_type: "assignment", source_id: ACTIVITY, xp_earned: 60 });
  });

  await t.test("no trusted diagnostic, or only unverified history: completion saves, no XP", async () => {
    for (const user of [USERS.generalNoDiagnostic, USERS.generalUnverified]) {
      for (const module of [MODULE.enEasy, MODULE.enHard]) {
        const attempt = await completeAttempt(db, { user, module, viaUpdate: true });
        assert.equal(await status(db, attempt), "completed");
      }
      assert.deepEqual(await xp(db, user), []);
      assert.equal((await db.query("select count(*)::int n from public.m8_reading_days where user_id=$1", [user])).rows[0].n, 0);
    }
  });

  await t.test("an attempt whose language contradicts its module or material is rejected", async () => {
    const before = await attemptCount(db, USERS.general);
    await assert.rejects(completeAttempt(db, { user: USERS.general, module: MODULE.enMedium, language: "fil" }), /does not match its module/);
    await assert.rejects(completeAttempt(db, { user: USERS.general, module: MODULE.unknownLanguage }), /Unknown module language/);
    await assert.rejects(completeAttempt(db, { user: USERS.student, module: null, room: ROOM, material: MATERIAL,
      activity: ACTIVITY, language: "fil" }), /does not match its material/);
    assert.equal(await attemptCount(db, USERS.general), before);
  });

  await t.test("another learner's assignment, or a mismatched classroom module, is rejected", async () => {
    await assert.rejects(completeAttempt(db, { user: USERS.student2, module: null, room: ROOM, material: MATERIAL, activity: ACTIVITY }),
      /does not belong to learner/);
    await assert.rejects(completeAttempt(db, { user: USERS.student2, module: MODULE.enHard, room: ROOM, assignment: ROOM_MODULE.enMedium }),
      /does not belong to this classroom module/);
    await assert.rejects(completeAttempt(db, { user: USERS.student2, module: MODULE.enHard, room: ROOM }), /Malformed classroom/);
    assert.deepEqual(await xp(db, USERS.student2), []);
  });

  for (const [label, change] of [
    ["withdrawn assignment", `delete from room_modules where id='${ROOM_MODULE.enMedium}'`],
    ["ended enrollment", `delete from enrollments where room_id='${ROOM}' and student_id='${USERS.student2}'`],
    ["teacher disapproval", `update profiles set teacher_status='pending' where id='${USERS.teacher}'`],
    ["ownership transfer", `update profiles set teacher_status='approved' where id='${USERS.pendingTeacher}'; update rooms set teacher_id='${USERS.pendingTeacher}' where id='${ROOM}'`],
    ["unpublished module", `update modules set status='draft' where id='${MODULE.enMedium}'`],
    ["soft-deleted module", `update modules set deleted_at=now() where id='${MODULE.enMedium}'`],
    ["deleted module", `delete from room_modules where module_id='${MODULE.enMedium}'; delete from modules where id='${MODULE.enMedium}'`],
  ]) {
    await t.test(`real M6 RPC rejects a previously started attempt after ${label}`, async () => {
      await inRollback(db, async () => {
        const attempt = await completeAttempt(db, { user: USERS.student2, module: MODULE.enMedium,
          room: ROOM, assignment: ROOM_MODULE.enMedium, startOnly: true });
        await db.exec(change);
        const queue = (await db.query("select * from m7_risk_queue order by id")).rows;
        await db.exec("savepoint completion");
        await assert.rejects(finishAttempt(db, attempt, USERS.student2), { code: "42501" });
        await db.exec("rollback to savepoint completion");
        assert.equal(await status(db, attempt), "in_progress");
        assert.deepEqual(await xp(db, USERS.student2), []);
        assert.deepEqual((await db.query("select * from m7_risk_queue order by id")).rows, queue);
      });
    });
  }

  await t.test("withdrawn material assignment rejects a saved attempt; direct completed inserts cannot bypass access", async () => {
    await inRollback(db, async () => {
      const attempt = await completeAttempt(db, { user: USERS.student, module: null, room: ROOM,
        material: MATERIAL, activity: ACTIVITY, startOnly: true });
      await db.query("delete from reading_activity_assignments where id=$1", [ACTIVITY]);
      await assert.rejects(finishAttempt(db, attempt, USERS.student), { code: "42501" });
    });
    await assert.rejects(completeAttempt(db, { user: USERS.student, module: MODULE.enHardPending,
      room: PENDING_ROOM, assignment: ROOM_MODULE.pending }), { code: "42501" });
    for (const module of [MODULE.enDeleted, MODULE.enDraft, id(399)]) {
      await assert.rejects(completeAttempt(db, { user: USERS.general, module }), { code: "42501" });
    }
  });

  for (const [label, change] of [
    ["ended enrollment", `delete from enrollments where room_id='${ROOM}' and student_id='${USERS.student}'`],
    ["teacher disapproval", `update profiles set teacher_status='pending' where id='${USERS.teacher}'`],
    ["approved ownership transfer", `update profiles set teacher_status='approved' where id='${USERS.pendingTeacher}'; update rooms set teacher_id='${USERS.pendingTeacher}' where id='${ROOM}'`],
  ]) {
    await t.test(`material completion rejects ${label} through the real M6 RPC`, async () => {
      await inRollback(db, async () => {
        const attempt = await completeAttempt(db, { user: USERS.student, module: null, room: ROOM,
          material: MATERIAL, activity: ACTIVITY, startOnly: true });
        await db.exec(change);
        const events = await xp(db, USERS.student);
        await db.exec("savepoint revoked_material");
        await assert.rejects(finishAttempt(db, attempt, USERS.student), { code: "42501" });
        await db.exec("rollback to savepoint revoked_material");
        assert.equal(await status(db, attempt), "in_progress");
        assert.deepEqual(await xp(db, USERS.student), events);
      });
    });
  }

  await t.test("real M6 RPC enforces ownership, resolved answers, roles and immutable saved-question semantics", async () => {
    const attempt = await completeAttempt(db, { user: USERS.student2, module: MODULE.enMedium,
      room: ROOM, assignment: ROOM_MODULE.enMedium, startOnly: true });
    await assert.rejects(finishAttempt(db, attempt, USERS.general), { code: "P0002" });
    await db.query("update m6_comprehension_responses set resolved=false where attempt_id=$1", [attempt]);
    await assert.rejects(finishAttempt(db, attempt, USERS.student2), /Finish every question/);
    await db.query("update m6_comprehension_responses set resolved=true where attempt_id=$1", [attempt]);
    const snapshot = (await db.query("select question_snapshot from m6_comprehension_attempts where id=$1", [attempt])).rows[0];
    await db.query("update modules set title='Ordinary content edit' where id=$1", [MODULE.enMedium]);
    await finishAttempt(db, attempt, USERS.student2);
    await finishAttempt(db, attempt, USERS.student2);
    assert.equal(await status(db, attempt), "completed");
    assert.deepEqual((await db.query("select question_snapshot from m6_comprehension_attempts where id=$1", [attempt])).rows[0], snapshot);
    assert.equal((await xp(db, USERS.student2)).length, 1);
    for (const user of [USERS.admin, USERS.teacher, USERS.pendingTeacher]) {
      await assert.rejects(completeAttempt(db, { user, module: MODULE.enEasy }), /Learner access required/);
    }
    await assert.rejects(completeAttempt(db, { user: USERS.student, module: MODULE.enEasy }), /role does not match/);
    await assert.rejects(completeAttempt(db, { user: USERS.general, module: MODULE.enHard,
      room: ROOM, assignment: ROOM_MODULE.enHard }), /role does not match/);
  });

  await t.test("duplicate completions and re-saves never grant XP twice", async () => {
    const before = await xp(db, USERS.general);
    const badgesBefore = await badges(db, USERS.general);
    const attempt = await completeAttempt(db, { user: USERS.general, module: MODULE.enHard });
    await db.query("update public.m6_comprehension_attempts set status='completed', completed_at=now() where id=$1", [attempt]);
    await completeAttempt(db, { user: USERS.general, module: MODULE.enHard, viaUpdate: true });
    assert.deepEqual(await xp(db, USERS.general), before);
    assert.deepEqual(await badges(db, USERS.general), badgesBefore);
    const total = (await db.query("select total_xp from public.m8_learner_progress where user_id=$1", [USERS.general])).rows[0].total_xp;
    assert.equal(total, before.reduce((sum, row) => sum + row.xp_earned, 0));
  });

  await t.test("unrelated database errors are not swallowed", async () => {
    await inRollback(db, async () => {
      await db.exec("alter table public.m8_xp_events add constraint c9_test_failure check (false) not valid");
      await assert.rejects(completeAttempt(db, { user: USERS.general, module: MODULE.filEasy, language: "fil" }), /c9_test_failure/);
    });
  });

  await t.test("M7: every saved completion is queued; a rejected one queues nothing", async () => {
    const generation = async (user) => (await db.query("select generation from public.m7_risk_queue where id=$1", [user])).rows[0]?.generation;
    const before = await generation(USERS.generalNoDiagnostic);
    await completeAttempt(db, { user: USERS.generalNoDiagnostic, module: MODULE.enMedium });  // saved, no XP
    assert.notEqual(await generation(USERS.generalNoDiagnostic), before);
    const rejectedBefore = await generation(USERS.student2);
    await assert.rejects(completeAttempt(db, { user: USERS.student2, module: null, room: ROOM, material: MATERIAL, activity: ACTIVITY }));
    assert.equal(await generation(USERS.student2), rejectedBefore);
    assert.equal((await db.query("select count(*)::int n from pg_trigger where not tgisinternal and tgname ~ '^(m7|m8)_'"
      + " and tgrelid in ('public.diagnostic_results'::regclass,'public.oral_reading_attempts'::regclass,"
      + "'public.m6_comprehension_attempts'::regclass,'public.enrollments'::regclass,'public.rooms'::regclass,'public.profiles'::regclass)")).rows[0].n, 7);
  });

  await t.test("M4 tables, policies, grants and triggers are unchanged", async () => {
    assert.deepEqual((await db.query(snapshots.m4)).rows, m4Before.tables);
    assert.deepEqual((await db.query(snapshots.m4Triggers)).rows, m4Before.triggers);
    assert.deepEqual((await db.query(snapshots.m4Functions)).rows, m4Before.functions);
    assert.doesNotMatch(sqlFile(C9), /\b(?:create policy|alter policy|drop policy|alter table|(?:insert into|update|delete from) public\.(?:rooms|enrollments|room_modules|reading_activity_assignments))\b/i);
  });

  await t.test("actual M4 join/removal RPC and policies retain their behavior with C9 installed", async () => {
    const result = await asUser(db, USERS.student2, "select (public.join_room_by_code(' room1 ')).student_id::text as student");
    assert.equal(result.rows[0].student, USERS.student2);
    await assert.rejects(asUser(db, USERS.general, "select public.join_room_by_code('ROOM1')"), /Only students/);
    const removed = await asUser(db, USERS.teacher, `delete from enrollments where room_id='${ROOM}' and student_id='${USERS.student2}' returning student_id::text`);
    assert.equal(removed.rows.length, 1);
    const unrelated = await asUser(db, USERS.pendingTeacher, `delete from enrollments where room_id='${ROOM}' returning student_id`);
    assert.equal(unrelated.rows.length, 0);
  });

  await t.test("function ownership, security, search_path and EXECUTE privileges", async () => {
    const rows = (await db.query(`select p.proname, p.prosecdef as definer, array_to_string(p.proconfig, ',') as config,
        pg_get_userbyid(p.proowner) = current_user as owned_by_migrator,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
        ('m8_on_comprehension_completed','m8_sync_diagnostic','m8_normalize_language','m8_verified_difficulty_summary')
      order by 1`)).rows;
    assert.deepEqual(rows, [
      { proname: "m8_normalize_language", definer: false, config: 'search_path=""', owned_by_migrator: true, anon: false, auth: false },
      { proname: "m8_on_comprehension_completed", definer: true, config: 'search_path=""', owned_by_migrator: true, anon: false, auth: false },
      { proname: "m8_sync_diagnostic", definer: true, config: 'search_path=""', owned_by_migrator: true, anon: false, auth: false },
      { proname: "m8_verified_difficulty_summary", definer: false, config: 'search_path=""', owned_by_migrator: true, anon: false, auth: false },
    ]);
    assert.equal((await db.query(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace`)).rows[0].n, functionsBefore + 3);
    const audit = sqlFile("supabase/staging/audit_stage_b.sql");
    const section = (name) => audit.slice(audit.indexOf(`-- ${name}.`), audit.indexOf(";", audit.indexOf(`-- ${name}.`)) + 1);
    assert.deepEqual((await db.query(section("A5"))).rows.filter((row) => /m8_|m2_/.test(JSON.stringify(row))), []);
    assert.deepEqual((await db.query(section("A7"))).rows.map((row) => row.function_name).filter((name) => /^m8_|^m2_/.test(name)).sort(),
      ["m8_independent_leaderboard(text)", "m8_weekly_leaderboard()"]);
  });

  await t.test("C9 is re-runnable and the read-only verification file runs", async () => {
    const before = (await db.query(snapshots.history)).rows[0];
    await db.exec(sqlFile(C9));
    assert.deepEqual((await db.query(snapshots.history)).rows[0], before);
    await db.exec(sqlFile("supabase/staging/verify_c9_trusted_xp.sql"));
  });

  await t.test("M6 scoring body changes only by the authorization call; helper and RPC remain backend-only", async () => {
    const source = sqlFile("readflow/supabase/m6_comprehension_functions.sql").replace(/\r\n/g, "\n");
    const start = source.indexOf("$function$", source.indexOf("CREATE OR REPLACE FUNCTION public.m6_apply_action")) + "$function$".length;
    const original = source.slice(start, source.indexOf("$function$;", start));
    const actual = (await db.query("select prosrc from pg_proc where oid='public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)'::regprocedure")).rows[0].prosrc;
    assert.equal(actual.replace(/\r\n/g, "\n").replace("    perform public.m6_assert_completion_access(activity.id);\n\n", ""), original);
    for (const role of ["anon", "authenticated"]) {
      for (const fn of ["m6_assert_completion_access(uuid)", "m6_apply_action(uuid,uuid,uuid,text,integer,uuid)"]) {
        assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, `public.${fn}`])).rows[0].allowed, false);
      }
    }
  });

  await t.test("invalid module difficulty rolls back completion and queue, even when no diagnostic means no XP", async () => {
    await inRollback(db, async () => {
      // Fault injection only in this rolled-back test: the real CHECK normally
      // rejects this value before any attempt can be created.
      await db.exec("alter table modules drop constraint modules_difficulty_check");
      await db.query("update modules set difficulty='Impossible' where id=$1", [MODULE.enEasy]);
      const attempt = await completeAttempt(db, { user: USERS.generalNoDiagnostic, module: MODULE.enEasy, startOnly: true });
      const queue = (await db.query("select * from m7_risk_queue order by id")).rows;
      await db.exec("savepoint bad_tier");
      await assert.rejects(finishAttempt(db, attempt, USERS.generalNoDiagnostic), /Unknown module difficulty/);
      await db.exec("rollback to savepoint bad_tier");
      assert.equal(await status(db, attempt), "in_progress");
      assert.deepEqual((await db.query("select * from m7_risk_queue order by id")).rows, queue);
    });
  });

  await t.test("C9 refuses client-writable M6 evidence or an unexpected completion RPC", async () => {
    for (const mutation of [
      "grant update(language) on m6_comprehension_attempts to authenticated",
      "grant execute on function m6_apply_action(uuid,uuid,uuid,text,integer,uuid) to authenticated",
      "create or replace function m6_apply_action(target_attempt uuid,target_user uuid,target_question uuid,action_name text,selected_option integer,request_id uuid) returns jsonb language sql as $$select '{}'::jsonb$$",
    ]) {
      await inRollback(db, async () => {
        await db.exec(mutation);
        await assert.rejects(db.exec(sqlFile(C9)), /Stop:|cannot change name of input parameter/);
      });
    }
  });

  await t.test("C9 refuses to run without DT1", async () => {
    await inRollback(db, async () => {
      await db.exec("drop function public.m8_verified_difficulty_summary(uuid); drop function public.m2_trusted_reading_level(uuid,text)");
      await assert.rejects(db.exec(sqlFile(C9)), /apply DT1/);
    });
  });
});
