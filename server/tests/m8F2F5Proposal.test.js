// PROPOSED M8 F2-F5 on real PostgreSQL 17 (PGlite, in memory), applied on top of the F1 proposal.
// supabase/proposed/m8_f2_badges_streaks_v1, m8_f3_achievements_v1 and m8_f4_rankings_v1. No network, no staging.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile } = require("./fixtures/m5M6SecurityDatabase");
const { ROOM, USERS, verifiedDiagnostic } = require("./fixtures/m8TrustDatabase");
const {
  completeM6, createM8F1BaseDatabase, newMaterial, newModule, newRoom, newUser, nextId, readAloud, totalXp, xpEvents,
} = require("./fixtures/m8F1Database");

const F = (name) => `supabase/proposed/${name}.sql`;
const F1 = F("m8_f1_xp_rewards_v1_PROPOSED");
const F2 = F("m8_f2_badges_streaks_v1_PROPOSED");
const F2R = F("m8_f2_badges_streaks_v1_ROLLBACK_PROPOSED");
const F3 = F("m8_f3_achievements_v1_PROPOSED");
const F3R = F("m8_f3_achievements_v1_ROLLBACK_PROPOSED");
const F4 = F("m8_f4_rankings_v1_PROPOSED");
const F4R = F("m8_f4_rankings_v1_ROLLBACK_PROPOSED");
const FNS = ["public.m8_grant_xp(uuid,text,uuid,integer)", "public.m8_award_graduate(uuid)", "public.m8_oral_completed()", "public.m5_verify_reading(uuid,uuid,text)"];
const md5 = async (db, fn) => (await db.query(`select md5(replace(pg_get_functiondef('${fn}'::regprocedure), chr(13), '')) m`)).rows[0].m;
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const badges = async (db, user) => (await db.query("select badge_id from public.m8_earned_badges where user_id = $1 order by 1", [user])).rows.map((r) => r.badge_id);
const days = (db, user) => scalar(db, "select count(*)::int from public.m8_reading_days where user_id = $1", [user]);
const count = (db, user) => scalar(db, "select coalesce((select read_aloud_count from public.m8_learner_progress where user_id = $1), 0)", [user]);
async function asUser(db, user, sql, args = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated; set local request.jwt.claims = '{"sub":"${user}"}'`);
    return (await db.query(sql, args)).rows;
  } finally { await db.exec("rollback"); }
}
const fullActivity = async (db, user, module, passage, { correct = 10, accuracy = 100 } = {}) => {
  await readAloud(db, { user, module, passage, accuracy });
  await completeM6(db, { user, module, passage, correct });
};

test("the complete rollback F4, F3, F2, F1 leaves learners unable to reach the older leaderboards", { timeout: 300000 }, async () => {
  const db = await createM8F1BaseDatabase();
  try {
    const legacy = ["public.m8_independent_leaderboard(text)", "public.m8_classroom_leaderboard(uuid)", "public.m8_weekly_leaderboard()"];
    const reviewed = {};
    for (const fn of ["public.m8_grant_xp(uuid,text,uuid,integer)", "public.m8_award_graduate(uuid)", "public.m8_oral_completed()", "public.m8_on_comprehension_completed()", ...legacy]) {
      reviewed[fn] = await md5(db, fn);
    }
    const learner = await newUser(db); const pupil = await newUser(db, "student");
    const calls = ["public.m8_independent_leaderboard('weekly')", `public.m8_classroom_leaderboard('${ROOM}')`, "public.m8_weekly_leaderboard()"];
    const expectClosed = async (stage) => {
      for (const fn of legacy) for (const role of ["authenticated", "anon"]) {
        assert.equal(await scalar(db, `select has_function_privilege('${role}','${fn}','EXECUTE')`), false, `${stage}: ${role} ${fn}`);
      }
      for (const user of [learner, pupil]) for (const call of calls) {
        await assert.rejects(asUser(db, user, `select * from ${call}`), { code: "42501" }, `${stage}: ${call}`);
      }
    };
    for (const file of [F1, F2, F3, F4]) await db.exec(sqlFile(file));
    await expectClosed("all applied");
    await db.exec(sqlFile(F4R)); await expectClosed("after F4 rollback");
    await db.exec(sqlFile(F3R)); await expectClosed("after F3 rollback");
    await db.exec(sqlFile(F2R)); await expectClosed("after F2 rollback");
    await db.exec(sqlFile(F("m8_f1_xp_rewards_v1_ROLLBACK_PROPOSED"))); await expectClosed("after F1 rollback");
    assert.equal(await scalar(db, "select to_regclass('public.m8_reward_settings') is null"), true, "F1 is gone");
    for (const [fn, fp] of Object.entries(reviewed)) assert.equal(await md5(db, fn), fp, `${fn} is back to its original definition`);
    // Saved work still flows on the old rules, and no client function opened up.
    const m = await newModule(db);
    await assert.rejects(asUser(db, learner, "select public.m8_grant_xp(auth.uid(),'module',auth.uid(),30)"), { code: "42501" });
    assert.ok(m.id);
  } finally {
    await db.close();
  }
});

test("M8 F2-F5 proposals on F1", { timeout: 600000 }, async (t) => {
  const db = await createM8F1BaseDatabase();
  t.after(() => db.close());

  await t.test("every proposal stops without F1", async () => {
    for (const file of [F2, F3, F4]) {
      await assert.rejects(db.exec(sqlFile(file)), /apply m8_f1_xp_rewards_v1_PROPOSED\.sql first/, file);
      await db.exec("rollback");
    }
  });

  // History earned under F1 before these proposals.
  await db.exec(sqlFile(F1));
  const before = await newUser(db);
  const beforeModule = await newModule(db);
  await fullActivity(db, before, beforeModule, beforeModule.passages[0]);
  const protectedRows = async () => ({
    xp: (await db.query("select * from public.m8_xp_events order by id")).rows,
    earned: (await db.query("select * from public.m8_earned_badges order by 1,2")).rows,
    days: (await db.query("select * from public.m8_reading_days order by 1,2")).rows,
    progress: (await db.query("select * from public.m8_learner_progress order by user_id")).rows,
    diagnostics: (await db.query("select * from public.diagnostic_results order by id")).rows,
  });
  const f1Md5 = {}; for (const fn of FNS) f1Md5[fn] = await md5(db, fn);
  const f1Others = {};
  for (const fn of ["public.m8_on_comprehension_completed()", "public.m8_on_module_xp_granted()", "public.m8_activity_language(uuid,uuid)", "public.m8_performance_language(text)",
    "public.m8_evaluate_rewards(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)", "public.m8_award_passage(uuid,uuid,uuid,uuid,uuid,text)", "public.m8_try_module_bonus(uuid,uuid,uuid,uuid)",
    "public.m8_calculate_passage_xp(bigint,bigint,bigint,bigint)", "public.m8_same_passage(text,text)", "public.m8_claim_daily_login_at(uuid,timestamptz)", "public.m5_record_transcript_receipt(uuid,text,text,uuid,text,uuid)",
    "public.m8_weekly_leaderboard()", "public.m8_classroom_leaderboard(uuid)", "public.m8_independent_leaderboard(text)", "public.m8_record_reading_day(uuid,date)"]) f1Others[fn] = await md5(db, fn);
  const snapshot = await protectedRows();

  await db.exec(sqlFile(F2)); await db.exec(sqlFile(F3)); await db.exec(sqlFile(F4));

  await t.test("applying changes no learner record, awards nothing and cannot run twice", async () => {
    assert.deepEqual(await protectedRows(), snapshot);
    for (const file of [F2, F3, F4]) {
      await assert.rejects(db.exec(sqlFile(file)), /differs from the reviewed definition|already installed/, file);
      await db.exec("rollback");
    }
  });

  await t.test("F2: First Read and Bookworm count reading activities, including assigned materials", async () => {
    const pupil = await newUser(db, "student");
    for (let i = 1; i <= 5; i += 1) {
      const material = await newMaterial(db, { student: pupil });
      await readAloud(db, { user: pupil, material });
      await completeM6(db, { user: pupil, material });
      const earned = await badges(db, pupil);
      assert.equal(earned.includes("first_read"), true, "the first activity earns First Read");
      assert.equal(earned.includes("bookworm"), i === 5, `Bookworm at five, not at ${i}`);
    }
    assert.equal(await scalar(db, "select completed_modules from public.m8_learner_progress where user_id = $1", [pupil]), 0, "materials are not modules");

    // A multi-passage module earns First Read at its first passage, not at its end. The bonus adds nothing.
    const il = await newUser(db);
    const module = await newModule(db, { passages: [{}, {}, {}] });
    await fullActivity(db, il, module, module.passages[0]);
    assert.deepEqual((await badges(db, il)).includes("first_read"), true);
    await fullActivity(db, il, module, module.passages[1]);
    await fullActivity(db, il, module, module.passages[2]);
    assert.equal(await scalar(db, "select count(*)::int from public.m8_xp_events where user_id = $1 and source_type in ('passage','assignment','module')", [il]), 3, "the bonus is not an activity");
    assert.equal((await badges(db, il)).includes("bookworm"), false);

    // Fixed-reward Filipino still counts as one activity per module.
    const fil = await newUser(db);
    await verifiedDiagnostic(db, fil, "fil", "Frustration", nextId());
    const filModule = await newModule(db, { language: "fil" });
    await fullActivity(db, fil, filModule, filModule.passages[0]);
    assert.ok((await badges(db, fil)).includes("first_read"));

    // A repeat earns nothing and cannot reach Bookworm. A login never counts.
    const repeat = await newUser(db);
    await db.query("select public.m8_claim_daily_login($1)", [repeat]);
    assert.deepEqual(await badges(db, repeat), [], "a login earns no badge");
    const one = await newModule(db);
    await fullActivity(db, repeat, one, one.passages[0]);
    for (let i = 0; i < 6; i += 1) await readAloud(db, { user: repeat, module: one, passage: one.passages[0] });
    assert.equal((await badges(db, repeat)).includes("bookworm"), false);
  });

  await t.test("F2: Diamond, Level Up, Consistent Reader and 3-Day Streak keep their rules", async () => {
    const user = await newUser(db);
    const grant = (type, xp) => db.query("select public.m8_grant_xp($1,$2,$3,$4)", [user, type, nextId(), xp]);
    for (let i = 0; i < 19; i += 1) await grant("passage", 100);
    await grant("module_bonus", 50); await grant("passage", 40);
    await db.query("select public.m8_claim_daily_login_at($1,'2026-12-01T01:00:00Z')", [user]);
    await db.query("select public.m8_claim_daily_login_at($1,'2026-12-02T01:00:00Z')", [user]);
    assert.equal(await totalXp(db, user), 2010);
    assert.equal((await badges(db, user)).includes("diamond"), false, "1990 reading XP, 2010 balance");
    await grant("passage", 20);
    assert.ok((await badges(db, user)).includes("diamond"));

    const level = await newUser(db);
    await verifiedDiagnostic(db, level, "en", "Frustration", nextId());
    assert.equal((await badges(db, level)).includes("level_up"), false, "Frustration does not earn Level Up");
    const higher = await newUser(db);
    await verifiedDiagnostic(db, higher, "en", "Instructional", nextId());
    assert.ok((await badges(db, higher)).includes("level_up"));
    const xpOnly = await newUser(db);
    for (let i = 0; i < 25; i += 1) await db.query("select public.m8_grant_xp($1,'passage',$2,100)", [xpOnly, nextId()]);
    assert.equal((await badges(db, xpOnly)).includes("level_up"), false, "XP never earns Level Up (no F6 progression)");

    const reader = await newUser(db);
    const day = (date) => db.query("select public.m8_record_reading_day($1,$2)", [reader, date]);
    await day("2026-11-01"); await day("2026-11-02");
    assert.equal((await badges(db, reader)).includes("streak_3"), false);
    await day("2026-11-03");
    assert.ok((await badges(db, reader)).includes("streak_3"));
    for (const date of ["2026-10-01", "2026-10-03", "2026-10-05"]) await day(date);
    assert.equal((await badges(db, reader)).includes("consistent_reader"), false, "six days");
    await day("2026-10-07");
    assert.ok((await badges(db, reader)).includes("consistent_reader"), "seven different days, not necessarily in a row");
  });

  await t.test("F2: Graduate ignores trashed modules and accepts the bonus and old module rewards", async () => {
    // A throwaway check of the rule itself, since other tests keep publishing modules.
    const def = (await db.query("select pg_get_functiondef('public.m8_award_graduate(uuid)'::regprocedure) d")).rows[0].d;
    assert.match(def, /m\.status = 'published' and m\.deleted_at is null/);
    await db.exec("begin");
    try {
      await db.exec("update public.modules set status = 'draft'");
      const keep = await newModule(db); const legacy = await newModule(db, { language: "fil" });
      const trashed = await newModule(db);
      await db.query("update public.modules set deleted_at = now() where id = $1", [trashed.id]);
      const user = await newUser(db);
      await verifiedDiagnostic(db, user, "fil", "Frustration", nextId());
      await fullActivity(db, user, legacy, legacy.passages[0]);
      assert.equal((await badges(db, user)).includes("graduate"), false, "the English module is not done");
      await fullActivity(db, user, keep, keep.passages[0]);
      assert.ok((await badges(db, user)).includes("graduate"), "done, despite the trashed module");
    } finally { await db.exec("rollback"); }
  });

  await t.test("F2 and F5: only verified readings count toward Brave Reader and the streak", async () => {
    const user = await newUser(db);
    const module = await newModule(db, { passages: [{ reviewed: false }] });
    const passage = module.passages[0];
    await readAloud(db, { user, module, passage, receipt: false });
    assert.deepEqual([await count(db, user), await days(db, user)], [0, 0], "a forged reading builds no streak");
    assert.equal(await scalar(db, "select count(*)::int from public.oral_reading_attempts where user_id = $1", [user]), 1, "but it is saved");
    await readAloud(db, { user, module, passage });
    assert.deepEqual([await count(db, user), await days(db, user)], [1, 1]);
    for (let i = 0; i < 8; i += 1) await readAloud(db, { user, module, passage });
    assert.equal(await count(db, user), 9);
    assert.equal((await badges(db, user)).includes("brave_reader"), false);
    assert.equal(await days(db, user), 1, "repeat readings the same day are one reading day");
    const { attempt } = await readAloud(db, { user, module, passage });
    assert.ok((await badges(db, user)).includes("brave_reader"), "ten verified readings");
    // A save retry verifies again but counts once.
    await db.query("select public.m5_verify_reading($1,$2,$3)", [attempt.id, user, "a".repeat(64)]);
    assert.equal(await count(db, user), 10);
    // Filipino readings count too, and nobody else's do.
    const fil = await newUser(db);
    const filModule = await newModule(db, { language: "fil", passages: [{ reviewed: false }] });
    await readAloud(db, { user: fil, module: filModule, passage: filModule.passages[0] });
    assert.deepEqual([await count(db, fil), await days(db, fil)], [1, 1]);
    const staff = await newModule(db);
    await readAloud(db, { user: USERS.admin, module: staff, passage: staff.passages[0] });
    assert.equal(await count(db, USERS.admin), 0, "Admin practice earns nothing");
  });

  await t.test("F5: Philippine dates, and a login alone never adds a reading day", async () => {
    const user = await newUser(db);
    await db.query("select public.m8_claim_daily_login_at($1,'2026-11-04T15:59:59Z')", [user]);
    await db.query("select public.m8_claim_daily_login_at($1,'2026-11-04T16:00:00Z')", [user]);
    assert.equal(await days(db, user), 0);
    assert.equal(await scalar(db, "select current_streak from public.m8_learner_progress where user_id = $1", [user]), 0);
    await db.query("select public.m8_count_verified_reading($1,'2026-11-04T16:30:00Z')", [user]);
    assert.equal(await scalar(db, "select reading_date::text from public.m8_reading_days where user_id = $1", [user]), "2026-11-05", "00:30 on Nov 5 in Manila");
    // Own days readable, others' not, none writable. Students and Independent Learners alike.
    assert.equal((await asUser(db, user, "select * from public.m8_reading_days")).length, 1);
    await assert.rejects(asUser(db, user, "insert into public.m8_reading_days values (auth.uid(), '2026-01-01')"), { code: "42501" });
    await assert.rejects(asUser(db, user, `select public.m8_count_verified_reading('${user}', now())`), { code: "42501" });
  });

  await t.test("F3: achievements count how well, once per text, from protected records", async () => {
    const mine = async (user) => Object.fromEntries((await asUser(db, user, "select * from public.m8_my_achievements()")).map((r) => [r.achievement_id, r]));
    const user = await newUser(db);
    const empty = await mine(user);
    assert.deepEqual(Object.keys(empty), ["accurate_reader", "comprehension_star"]);
    assert.equal(empty.accurate_reader.qualifying, 0);
    assert.equal(empty.comprehension_star.bronze_at, null);

    const passage = async (options) => { const m = await newModule(db); await fullActivity(db, user, m, m.passages[0], options); return m; };
    const first = await passage({ accuracy: 100, correct: 10 });
    await passage({ accuracy: 80, correct: 7 }); // below both lines
    await passage({ accuracy: 90, correct: 8 }); // exactly on both lines
    let now = await mine(user);
    assert.deepEqual([now.accurate_reader.qualifying, now.comprehension_star.qualifying], [2, 2]);
    assert.equal(now.accurate_reader.bronze_at, null);
    // Repeating an earlier passage cannot raise anything.
    for (let i = 0; i < 3; i += 1) await readAloud(db, { user, module: first, passage: first.passages[0] });
    assert.equal((await mine(user)).accurate_reader.qualifying, 2, "only the first reading of a text counts");
    await passage({ accuracy: 100, correct: 10 });
    now = await mine(user);
    assert.deepEqual([now.accurate_reader.qualifying, now.comprehension_star.qualifying], [3, 3]);
    assert.ok(now.accurate_reader.bronze_at, "Bronze at three");
    assert.equal(now.accurate_reader.silver_at, null);

    // Filipino comprehension counts; Filipino reading accuracy does not, during validation.
    const fil = await newUser(db);
    await verifiedDiagnostic(db, fil, "fil", "Frustration", nextId());
    const filModule = await newModule(db, { language: "fil", passages: [{}, {}] });
    await fullActivity(db, fil, filModule, filModule.passages[0], { accuracy: 100, correct: 10 });
    const filNow = await mine(fil);
    assert.deepEqual([filNow.accurate_reader.qualifying, filNow.comprehension_star.qualifying], [0, 1]);

    // A malformed saved question is not counted and does not break the page.
    const odd = await newUser(db);
    const oddModule = await newModule(db);
    await readAloud(db, { user: odd, module: oddModule, passage: oddModule.passages[0] });
    await completeM6(db, { user: odd, module: oddModule, passage: oddModule.passages[0], correct: 1, total: 1,
      snapshot: [{ id: nextId(), type: "literal", questionText: "Q?", options: ["a", "b", "c", "d"], correctOptionIndex: "x", scaffoldingHint: "R." }] });
    assert.equal((await mine(odd)).comprehension_star.qualifying, 0);

    // Own results only; staff get an error; it grants nothing.
    const xp = await totalXp(db, user);
    await assert.rejects(asUser(db, USERS.teacher, "select * from public.m8_my_achievements()"), { code: "42501" });
    await assert.rejects(asUser(db, USERS.admin, "select * from public.m8_my_achievements()"), { code: "42501" });
    assert.equal(await totalXp(db, user), xp);
    assert.equal((await db.query("select provolatile v from pg_proc where oid = 'public.m8_my_achievements()'::regprocedure")).rows[0].v, "s", "read only");
  });

  await t.test("F4: classroom rankings are room-scoped, per language, weekly and private", async () => {
    const rank = (user, room, language) => asUser(db, user, "select * from public.m8_classroom_rankings($1,$2)", [room, language]);
    const a = await newUser(db, "student"); const b = await newUser(db, "student");
    const otherRoom = await newRoom(db, a);
    const assigned = await newModule(db, { assign: true });
    const otherAssigned = await newModule(db);
    const second = nextId();
    await db.query("insert into public.room_modules(id, room_id, module_id, assigned_by) values ($1,$2,$3,$4)", [second, otherRoom, otherAssigned.id, USERS.teacher]);
    await fullActivity(db, a, assigned, assigned.passages[0]);
    await fullActivity(db, a, { ...otherAssigned, room: otherRoom, assignment: second }, otherAssigned.passages[0], { correct: 5, accuracy: 50 });
    await db.query("select public.m8_claim_daily_login($1)", [a]);
    await db.query("select public.m8_claim_daily_login($1)", [b]);

    const here = await rank(a, ROOM, "en");
    const me = here.find((row) => row.is_me);
    assert.equal(Number(me.xp), 150, "only this room's passage and bonus; not the other room, not the login");
    assert.equal(me.display_name, "You");
    const there = await rank(a, otherRoom, "en");
    assert.equal(Number(there.find((row) => row.is_me).xp), 110, "the other room's own: 20+20+20+50");
    assert.equal(Number(here.find((row) => !row.is_me && row.xp === "0")?.xp ?? 0), 0);

    // Private: no user ID or reading level leaves the database, and IDs differ per room.
    for (const row of here) {
      assert.deepEqual(Object.keys(row).sort(), ["display_name", "entry_id", "is_me", "xp"]);
      for (const value of [row.entry_id, row.display_name]) assert.equal(String(value).includes(b.slice(-8)), false);
    }
    const others = here.filter((row) => !row.is_me);
    assert.ok(others.every((row) => /^Reader [0-9A-F]{6}$/.test(row.display_name)));
    assert.notEqual(here.find((row) => row.is_me).entry_id, there.find((row) => row.is_me).entry_id);

    // Languages rank separately.
    const fil = await newModule(db, { language: "fil", assign: true });
    await fullActivity(db, b, fil, fil.passages[0]);
    assert.equal(Number((await rank(b, ROOM, "fil")).find((row) => row.is_me).xp), 30);
    assert.equal(Number((await rank(b, ROOM, "en")).find((row) => row.is_me).xp), 0, "Filipino XP is not ranked with English");

    // Assigned materials rank in their own room and language.
    const reader = await newUser(db, "student");
    const material = await newMaterial(db, { student: reader, language: "fil" });
    await readAloud(db, { user: reader, material });
    await completeM6(db, { user: reader, material });
    assert.equal(Number((await rank(reader, ROOM, "fil")).find((row) => row.is_me).xp), 60);

    // Last week does not count; non-members and bad input get nothing.
    await db.query("update public.m8_xp_events set created_at = now() - interval '8 days' where user_id = $1 and source_type = 'assignment'", [reader]);
    assert.equal(Number((await rank(reader, ROOM, "fil")).find((row) => row.is_me).xp), 0);
    assert.deepEqual(await rank(USERS.general, ROOM, "en"), []);
    await assert.rejects(rank(a, ROOM, "xx"), { code: "22023" });
    // Teachers and Admins are never ranked.
    assert.ok(!(await rank(a, ROOM, "en")).some((row) => row.display_name === "Teacher"));
  });

  await t.test("F4: Independent Learner rankings are per language, exclude login, and hide IDs and levels", async () => {
    const rank = (user, period, language) => asUser(db, user, "select * from public.m8_independent_rankings($1,$2)", [period, language]);
    const il = await newUser(db);
    await db.query("update public.profiles set nickname = 'Bituin' where id = $1", [il]);
    const m = await newModule(db);
    await fullActivity(db, il, m, m.passages[0]);
    await db.query("select public.m8_claim_daily_login($1)", [il]);
    const fil = await newModule(db, { language: "fil" });
    await verifiedDiagnostic(db, il, "fil", "Frustration", nextId());
    await fullActivity(db, il, fil, fil.passages[0]);
    const en = (await rank(il, "weekly", "en")).find((row) => row.is_me);
    assert.equal(Number(en.xp), 150, "the login and the Filipino XP are not here");
    assert.equal(en.display_name, "You");
    assert.equal(Number((await rank(il, "weekly", "fil")).find((row) => row.is_me).xp), 30);
    assert.deepEqual(Object.keys(en).sort(), ["display_name", "entry_id", "is_me", "xp"]);
    // Old XP stays in its period and language.
    await db.query("insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned, created_at) values ($1,'module',$2,80, now() - interval '30 days')", [il, m.id]);
    assert.equal(Number((await rank(il, "all_time", "en")).find((row) => row.is_me).xp), 230);
    assert.equal(Number((await rank(il, "weekly", "en")).find((row) => row.is_me).xp), 150);
    await assert.rejects(rank(USERS.student, "weekly", "en"), { code: "42501" });
    await assert.rejects(rank(il, "yearly", "en"), { code: "22023" });
  });

  await t.test("F4: pseudonyms hide every account detail, stay stable in a period and rotate with it", async () => {
    const rank = (user, period, language) => asUser(db, user, "select * from public.m8_independent_rankings($1,$2)", [period, language]);
    const viewer = await newUser(db);
    const other = await newUser(db);
    await db.query("update public.profiles set full_name = 'Maria Santos', nickname = 'Bituin' where id = $1", [other]);
    const m = await newModule(db);
    await fullActivity(db, other, m, m.passages[0]);

    const seen = await rank(viewer, "weekly", "en");
    assert.equal(seen.filter((row) => row.is_me).length, 1);
    assert.equal(seen.find((row) => row.is_me).display_name, "You");
    const text = JSON.stringify(seen);
    for (const secret of ["Maria", "Santos", "Bituin", other, viewer, other.slice(0, 6), "example.com"]) assert.equal(text.includes(secret), false, secret);
    assert.ok(seen.filter((row) => !row.is_me).every((row) => /^Reader [0-9A-F]{6}$/.test(row.display_name)));
    assert.deepEqual(Object.keys(seen[0]).sort(), ["display_name", "entry_id", "is_me", "xp"]);

    // The learner earning 150 keeps one identity and their position across calls and languages this week.
    const top = seen.find((row) => Number(row.xp) === 150 && !row.is_me && row.display_name);
    assert.deepEqual(await rank(viewer, "weekly", "en"), seen, "stable between calls, including ties");
    const namesFor = async (language) => new Set((await rank(viewer, "weekly", language)).map((row) => row.display_name));
    assert.ok((await namesFor("fil")).has(top.display_name), "the same pseudonym in the other language");
    // What the other learner sees for themselves is not what they are shown as.
    assert.equal((await rank(other, "weekly", "en")).find((row) => row.is_me).display_name, "You");
    // A different period is a different identity, so periods cannot be linked by name or ID.
    const allTime = await rank(viewer, "all_time", "en");
    assert.equal(allTime.some((row) => row.display_name === top.display_name || row.entry_id === top.entry_id), false);
    const def = (await db.query("select pg_get_functiondef('public.m8_independent_rankings(text,text)'::regprocedure) d")).rows[0].d;
    assert.match(def, /date_trunc\('week', now\(\) at time zone 'Asia\/Manila'\)\)::date::text/, "weekly pseudonyms rotate on the Manila week");

    // Classroom safeguards hold too: pseudonyms per room, You for the viewer, no account details.
    const a = await newUser(db, "student"); const b = await newUser(db, "student");
    await db.query("update public.profiles set full_name = 'Juan Cruz', nickname = 'Kuya' where id = $1", [b]);
    const classroom = await asUser(db, a, "select * from public.m8_classroom_rankings($1,'en')", [ROOM]);
    const roomText = JSON.stringify(classroom);
    for (const secret of ["Juan", "Cruz", "Kuya", a, b]) assert.equal(roomText.includes(secret), false, secret);
    assert.equal(classroom.find((row) => row.is_me).display_name, "You");

    // No direct route to the older data for any learner or anonymous caller.
    for (const user of [viewer, a]) {
      for (const call of ["public.m8_independent_leaderboard('weekly')", `public.m8_classroom_leaderboard('${ROOM}')`, "public.m8_weekly_leaderboard()"]) {
        await assert.rejects(asUser(db, user, `select * from ${call}`), { code: "42501" }, call);
      }
    }
  });

  await t.test("F3: repeated attempts and other classrooms cannot raise a count; thresholds are as approved", async () => {
    const mine = async (user) => Object.fromEntries((await asUser(db, user, "select * from public.m8_my_achievements()")).map((r) => [r.achievement_id, r]));
    const user = await newUser(db, "student");
    const module = await newModule(db, { assign: true });
    const passage = module.passages[0];
    await fullActivity(db, user, module, passage, { accuracy: 100, correct: 10 });
    const otherRoom = await newRoom(db, user);
    const second = nextId();
    await db.query("insert into public.room_modules(id, room_id, module_id, assigned_by) values ($1,$2,$3,$4)", [second, otherRoom, module.id, USERS.teacher]);
    const moved = { ...module, room: otherRoom, assignment: second };
    await fullActivity(db, user, moved, passage, { accuracy: 100, correct: 10 });
    for (let i = 0; i < 3; i += 1) await readAloud(db, { user, module: moved, passage });
    const now = await mine(user);
    assert.deepEqual([now.accurate_reader.qualifying, now.comprehension_star.qualifying], [1, 1], "one text counts once");
    const def = (await db.query("select prosrc d from pg_proc where oid = 'public.m8_my_achievements()'::regprocedure")).rows[0].d;
    for (const [tier, n] of [["bronze", 3], ["silver", 10], ["gold", 25]]) assert.match(def, new RegExp(`t\\.n = ${n}\\)`), tier);
    assert.match(def, /10 \* f\.words_correct >= 9 \* f\.words_total/, "90%");
    assert.match(def, /5 \* s\.correct >= 4 \* s\.total/, "80%");
    assert.match(def, /r\.language = 'en'/, "no Filipino reading-accuracy achievement");
  });

  await t.test("the proposals change no F1 reward logic beyond what they declare", async () => {
    // Everything F1 installed other than the four guarded functions is byte-identical.
    for (const [fn, fp] of Object.entries(f1Others)) assert.equal(await md5(db, fn), fp, fn);
    // m8_grant_xp keeps its amounts, its uniqueness and F1's Diamond rule.
    const grant = (await db.query("select prosrc d from pg_proc where oid = 'public.m8_grant_xp(uuid,text,uuid,integer)'::regprocedure")).rows[0].d;
    assert.match(grant, /p_type = 'passage' and p_xp between 20 and 100/);
    assert.match(grant, /p_type = 'module_bonus' and p_xp = 50/);
    assert.match(grant, /p_type = 'daily_login' and p_xp = 10/);
    assert.match(grant, /p_type <> 'daily_login' and \(select coalesce\(sum\(x\.xp_earned\), 0\)/);
    // XP results are unchanged: 80 XP, then the bonus, Filipino still the fixed reward.
    const user = await newUser(db);
    const m = await newModule(db);
    await fullActivity(db, user, m, m.passages[0], { accuracy: 80, correct: 7 });
    assert.deepEqual(await xpEvents(db, user), [["passage", 80], ["module_bonus", 50]]);
    // A newer F1 cannot be overwritten: any drift in a guarded function stops F2.
    await db.exec(sqlFile(F2R));
    const drifted = sqlFile(F2).replace(/'[0-9a-f]{32}'\)/, "'00000000000000000000000000000000')");
    await assert.rejects(db.exec(drifted), /differs from the reviewed definition/);
    await db.exec("rollback");
    await db.exec(sqlFile(F2));
  });

  await t.test("clients cannot reach the helpers, and functions run for their callers only", async () => {
    const user = await newUser(db);
    for (const call of [`public.m8_xp_event_language('passage','${user}')`, `public.m8_xp_event_in_room('${user}','passage','${user}','${user}')`]) {
      await assert.rejects(asUser(db, user, `select ${call}`), { code: "42501" }, call);
    }
  });

  await t.test("rollbacks are exact, keep every earned record and stop when not installed", async () => {
    const before = await protectedRows();
    const openBefore = await scalar(db, "select count(*)::int from public.m8_xp_events");
    await db.exec(sqlFile(F4R)); await db.exec(sqlFile(F3R)); await db.exec(sqlFile(F2R));
    assert.equal(await scalar(db, "select count(*)::int from public.m8_xp_events"), openBefore);
    for (const fn of FNS) assert.equal(await md5(db, fn), f1Md5[fn], fn);
    assert.deepEqual(await protectedRows(), before);
    assert.equal(await scalar(db, "select description from public.m8_badges where id = 'first_read'"), "Complete your first module");
    // Privacy holds during a rollback: the older functions stay closed to every client.
    const closedUser = await newUser(db);
    for (const fn of ["public.m8_independent_leaderboard(text)", "public.m8_classroom_leaderboard(uuid)", "public.m8_weekly_leaderboard()"]) {
      for (const role of ["authenticated", "anon"]) {
        assert.equal(await scalar(db, `select has_function_privilege('${role}','${fn}','EXECUTE')`), false, `${role} ${fn}`);
      }
    }
    for (const call of ["public.m8_independent_leaderboard('weekly')", `public.m8_classroom_leaderboard('${ROOM}')`, "public.m8_weekly_leaderboard()"]) {
      await assert.rejects(asUser(db, closedUser, `select * from ${call}`), { code: "42501" }, call);
    }
    assert.equal(await scalar(db, "select to_regprocedure('public.m8_classroom_rankings(uuid,text)') is null"), true, "the new rankings are gone");
    // Re-applying restores the private rankings, and a second rollback holds too.
    await db.exec(sqlFile(F4));
    assert.ok((await asUser(db, closedUser, "select * from public.m8_independent_rankings('weekly','en')")).some((row) => row.is_me));
    await db.exec(sqlFile(F4R));
    await assert.rejects(db.exec(sqlFile(F2R)), /nothing to roll back/);
    await db.exec("rollback");
    // After rollback, F1 behaves as staged: a saved reading counts again.
    const user = await newUser(db);
    const m = await newModule(db);
    await readAloud(db, { user, module: m, passage: m.passages[0], receipt: false });
    assert.equal(await count(db, user), 1);
  });
});
