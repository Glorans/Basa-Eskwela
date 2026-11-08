// PROPOSED M8 reward claiming on real PostgreSQL 17 (PGlite, in memory), applied on top of F1-F4.
// supabase/proposed/m8_f2_f3_reward_claims_v1_*.sql. No network, no staging.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile } = require("./fixtures/m5M6SecurityDatabase");
const { ROOM, USERS, verifiedDiagnostic } = require("./fixtures/m8TrustDatabase");
const { completeM6, createM8F1BaseDatabase, newModule, newUser, nextId, readAloud, totalXp } = require("./fixtures/m8F1Database");

const F = (name) => `supabase/proposed/${name}.sql`;
const PRIOR = ["m8_f1_xp_rewards_v1_PROPOSED", "m8_f2_badges_streaks_v1_PROPOSED", "m8_f3_achievements_v1_PROPOSED", "m8_f4_rankings_v1_PROPOSED"].map(F);
const CLAIMS = F("m8_f2_f3_reward_claims_v1_PROPOSED");
const ROLLBACK = F("m8_f2_f3_reward_claims_v1_ROLLBACK_PROPOSED");
const NEW_FNS = ["m8_badge_eligible", "m8_my_badges", "m8_claim_badge", "m8_my_achievement_claims", "m8_claim_achievement"];

const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const earned = async (db, user) => (await db.query("select badge_id from public.m8_earned_badges where user_id = $1 order by 1", [user])).rows.map((r) => r.badge_id);
const claimRows = async (db, user) => (await db.query("select badge_id, preserved from public.m8_badge_claims where user_id = $1 order by 1", [user])).rows;
const tierRows = async (db, user) => (await db.query("select achievement_id, tier from public.m8_achievement_claims where user_id = $1 order by 1, 2", [user])).rows;
/** Runs as a signed-in client and COMMITS, like a real PostgREST call. */
async function asUser(db, user, sql, args = [], role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}; set local request.jwt.claims = '${user ? JSON.stringify({ sub: user }) : "{}"}'`);
    const rows = (await db.query(sql, args)).rows;
    await db.exec("commit");
    return rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const myBadges = async (db, user) => Object.fromEntries((await asUser(db, user, "select * from public.m8_my_badges()")).map((r) => [r.badge_id, r]));
const claimBadge = async (db, user, badge) => (await asUser(db, user, "select * from public.m8_claim_badge($1)", [badge]))[0];
const claimTier = async (db, user, id, tier) => (await asUser(db, user, "select * from public.m8_claim_achievement($1,$2)", [id, tier]))[0];
const fullActivity = async (db, user, module, passage, { correct = 10, accuracy = 100 } = {}) => {
  await readAloud(db, { user, module, passage, accuracy });
  await completeM6(db, { user, module, passage, correct });
};
const fingerprints = async (db) => Object.fromEntries((await db.query(`select p.oid::regprocedure::text f, md5(pg_get_functiondef(p.oid)) m
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all($1)`, [NEW_FNS])).rows.map((r) => [r.f, r.m]));
const protectedRows = async (db) => ({
  xp: (await db.query("select * from public.m8_xp_events order by id")).rows,
  earned: (await db.query("select * from public.m8_earned_badges order by 1,2")).rows,
  days: (await db.query("select * from public.m8_reading_days order by 1,2")).rows,
  progress: (await db.query("select * from public.m8_learner_progress order by user_id")).rows,
  diagnostics: (await db.query("select * from public.diagnostic_results order by id")).rows,
});

test("M8 reward claiming on F1-F4", { timeout: 900000 }, async (t) => {
  const db = await createM8F1BaseDatabase();
  t.after(() => db.close());

  await t.test("stops without F1-F4", async () => {
    await assert.rejects(db.exec(sqlFile(CLAIMS)), /apply M8 F1, F2, F3 and F4 first/);
    await db.exec("rollback");
  });

  for (const file of PRIOR) await db.exec(sqlFile(file));

  // History from before claiming: an Independent Learner and a Student who each earned badges automatically.
  const veteran = await newUser(db);
  const vModule = await newModule(db);
  await fullActivity(db, veteran, vModule, vModule.passages[0]);
  await verifiedDiagnostic(db, veteran, "en", "Instructional", nextId());
  const veteranPupil = await newUser(db, "student");
  const pModule = await newModule(db, { assign: true });
  await fullActivity(db, veteranPupil, pModule, pModule.passages[0]);
  // A learner who met a rule without a recorded unlock (a historical read-aloud counter).
  const quiet = await newUser(db);
  await db.query("insert into public.m8_learner_progress(user_id, read_aloud_count) values ($1, 10)", [quiet]);
  // An achievement tier reached before claiming existed.
  const achiever = await newUser(db);
  for (let i = 0; i < 3; i += 1) { const m = await newModule(db); await fullActivity(db, achiever, m, m.passages[0]); }

  const veteranBadges = await earned(db, veteran);
  assert.deepEqual(veteranBadges, ["first_read", "level_up"], "the fixture earned badges the old way");
  assert.deepEqual(await earned(db, quiet), [], "no recorded unlock");
  const before = await protectedRows(db);
  const fnBefore = await fingerprints(db);
  const triggersBefore = (await db.query("select tgname, pg_get_triggerdef(oid) d from pg_trigger where not tgisinternal order by 1")).rows;

  await db.exec(sqlFile(CLAIMS));

  await t.test("applying preserves every earned badge as claimed, changes no record or F1-F5 function, and cannot run twice", async () => {
    assert.deepEqual(await protectedRows(db), before, "XP, earned badges, reading days, progress and diagnostics unchanged");
    assert.deepEqual(await fingerprints(db), fnBefore, "no existing function was replaced");
    assert.deepEqual((await db.query("select tgname, pg_get_triggerdef(oid) d from pg_trigger where not tgisinternal order by 1")).rows, triggersBefore);
    assert.deepEqual(await claimRows(db, veteran), veteranBadges.map((badge_id) => ({ badge_id, preserved: true })));
    assert.equal(await scalar(db, "select count(*)::int from public.m8_badge_claims"), await scalar(db, "select count(*)::int from public.m8_earned_badges"));
    assert.equal(await scalar(db, `select bool_and(c.claimed_at = e.earned_at) from public.m8_badge_claims c
      join public.m8_earned_badges e using (user_id, badge_id)`), true, "original dates kept");
    assert.equal(await scalar(db, "select count(*)::int from public.m8_achievement_claims"), 0, "achievements had no saved state");
    await assert.rejects(db.exec(sqlFile(CLAIMS)), /already installed/);
    await db.exec("rollback");
  });

  await t.test("existing badges show as Claimed for both roles; others are Locked", async () => {
    for (const user of [veteran, veteranPupil]) {
      const mine = await myBadges(db, user);
      assert.equal(Object.keys(mine).length, 8, "all eight badges");
      assert.ok(mine.first_read.claimed_at, "First Read stays claimed");
      assert.equal(mine.first_read.preserved, true, "marked as awarded before claiming began");
      assert.equal(new Date(mine.first_read.claimed_at).getTime(), new Date(mine.first_read.unlocked_at).getTime(), "its date is the original award date");
      assert.equal(mine.first_read.eligible, true);
      assert.equal(mine.bookworm.eligible, false); assert.equal(mine.bookworm.claimed_at, null);
    }
    assert.ok((await myBadges(db, veteran)).level_up.claimed_at);
  });

  await t.test("a locked badge cannot be claimed and stores nothing", async () => {
    const user = await newUser(db);
    for (const badge of ["first_read", "bookworm", "diamond", "level_up", "streak_3", "consistent_reader", "brave_reader", "graduate"]) {
      await assert.rejects(claimBadge(db, user, badge), { code: "55000" }, badge);
    }
    await assert.rejects(claimBadge(db, user, "made_up"), { code: "22023" });
    await assert.rejects(claimBadge(db, user, null), { code: "22023" });
    assert.deepEqual(await claimRows(db, user), []);
  });

  await t.test("meeting a rule makes a badge Ready to claim, never claimed automatically; Claim stores it once", async () => {
    for (const role of ["general_user", "student"]) {
      const user = await newUser(db, role);
      const m = await newModule(db, { assign: role === "student" });
      await fullActivity(db, user, m, m.passages[0]);
      assert.deepEqual(await earned(db, user), ["first_read"], `${role}: unlocked by the F2 rule`);
      assert.deepEqual(await claimRows(db, user), [], `${role}: not claimed automatically`);
      let mine = await myBadges(db, user);
      assert.equal(mine.first_read.eligible, true); assert.equal(mine.first_read.claimed_at, null, "Ready to claim");
      assert.ok(mine.first_read.unlocked_at);

      const xp = await totalXp(db, user);
      const daysBefore = await scalar(db, "select count(*)::int from public.m8_reading_days where user_id = $1", [user]);
      const first = await claimBadge(db, user, "first_read");
      assert.equal(first.newly_claimed, true); assert.ok(first.claimed_at);
      const again = await claimBadge(db, user, "first_read");
      assert.equal(again.newly_claimed, false, "a repeat claim adds nothing");
      assert.equal(new Date(again.claimed_at).getTime(), new Date(first.claimed_at).getTime(), "the first claim date stands");
      assert.deepEqual(await claimRows(db, user), [{ badge_id: "first_read", preserved: false }], "one row");
      assert.equal(await totalXp(db, user), xp, "claiming adds no XP");
      assert.equal(await scalar(db, "select count(*)::int from public.m8_reading_days where user_id = $1", [user]), daysBefore, "no reading day");
      mine = await myBadges(db, user);
      assert.ok(mine.first_read.claimed_at, `${role}: still Claimed after a refresh`);
      assert.equal(mine.first_read.preserved, false, `${role}: a manual claim, not a preserved award`);
    }
  });

  await t.test("a learner who met a rule before claiming existed can still claim it", async () => {
    assert.equal((await myBadges(db, quiet)).brave_reader.eligible, true, "recalculated from the saved counter");
    assert.equal((await claimBadge(db, quiet, "brave_reader")).newly_claimed, true);
    // Earlier unlocks that were never claimed by hand are claimable later too (the earned row is the record).
    const late = await newUser(db);
    await db.query("insert into public.m8_earned_badges(user_id, badge_id, earned_at) values ($1, 'streak_3', now() - interval '30 days')", [late]);
    assert.equal((await claimBadge(db, late, "streak_3")).newly_claimed, true);
  });

  await t.test("every badge rule is recalculated as in F2", async () => {
    const user = await newUser(db);
    const eligible = async (badge) => scalar(db, "select public.m8_badge_eligible($1, $2)", [user, badge]);
    const grant = (type, xp) => db.query("insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned) values ($1,$2,$3,$4)", [user, type, nextId(), xp]);
    await grant("daily_login", 10);
    assert.equal(await eligible("first_read"), false, "a login is not an activity");
    for (let i = 0; i < 4; i += 1) await grant("passage", 100);
    assert.equal(await eligible("first_read"), true); assert.equal(await eligible("bookworm"), false);
    await grant("assignment", 60);
    assert.equal(await eligible("bookworm"), true, "five activities");
    for (let i = 0; i < 14; i += 1) await grant("passage", 100);
    await grant("module_bonus", 50); await grant("passage", 80); await grant("daily_login", 10);
    assert.equal(await eligible("diamond"), false, "1990 reading XP + 20 login XP; login XP does not count");
    await grant("passage", 20);
    assert.equal(await eligible("diamond"), true);
    const day = (d) => db.query("insert into public.m8_reading_days values ($1, $2)", [user, d]);
    await day("2026-10-01"); await day("2026-10-02"); await day("2026-10-04");
    assert.equal(await eligible("streak_3"), false, "a gap breaks the run");
    await day("2026-10-03");
    assert.equal(await eligible("streak_3"), true);
    await day("2026-10-10"); await day("2026-10-12");
    assert.equal(await eligible("consistent_reader"), false, "six days");
    await day("2026-10-20");
    assert.equal(await eligible("consistent_reader"), true);
    await db.query("insert into public.m8_learner_progress(user_id, read_aloud_count) values ($1, 9)", [user]);
    assert.equal(await eligible("brave_reader"), false);
    await db.query("update public.m8_learner_progress set read_aloud_count = 10 where user_id = $1", [user]);
    assert.equal(await eligible("brave_reader"), true);
    await verifiedDiagnostic(db, user, "en", "Frustration", nextId());
    assert.equal(await eligible("level_up"), false, "Frustration is not Level Up");
    // A legacy unverified result, as older history holds; new ones are refused by a guard trigger.
    await db.exec("begin; set local session_replication_role = replica");
    await db.query(`insert into public.diagnostic_results(user_id,language,assessment_id,assessment_version,orv_score,comprehension_score,reading_level,difficulty_tier,verification_status)
      values ($1,'en','grade5-en-passage-v3','3.0',90,90,'Independent','Hard','unverified')`, [user]);
    await db.exec("commit");
    assert.equal(await eligible("level_up"), false, "an unverified result does not count");
    await verifiedDiagnostic(db, user, "fil", "Independent", nextId());
    assert.equal(await eligible("level_up"), true);
    assert.equal(await eligible("graduate"), false);
    // Graduate: every published, non-trashed module, by its fixed reward or its bonus.
    await db.exec("begin");
    try {
      await db.exec("update public.modules set status = 'draft'");
      const a = await newModule(db); const b = await newModule(db); const trashed = await newModule(db);
      await db.query("update public.modules set deleted_at = now() where id = $1", [trashed.id]);
      await grant("module", 30); // not tied to a module
      await db.query("insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned) values ($1,'module',$2,30)", [user, a.id]);
      assert.equal(await eligible("graduate"), false);
      await db.query("insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned) values ($1,'module_bonus',$2,50)", [user, b.id]);
      assert.equal(await eligible("graduate"), true, "the trashed module is not required");
    } finally { await db.exec("rollback"); }
  });

  await t.test("learners cannot claim for someone else, forge a claim, or read others' claims", async () => {
    const other = await newUser(db);
    await assert.rejects(claimBadge(db, other, "first_read"), { code: "55000" }, "the veteran's badge is not the other learner's");
    assert.equal((await myBadges(db, other)).first_read.claimed_at, null);
    for (const sql of [
      `insert into public.m8_badge_claims(user_id, badge_id) values ('${other}', 'diamond')`,
      `insert into public.m8_achievement_claims(user_id, achievement_id, tier) values ('${other}', 'accurate_reader', 'gold')`,
      `update public.m8_badge_claims set claimed_at = now() where user_id = '${veteran}'`,
      `delete from public.m8_badge_claims where user_id = '${veteran}'`,
      "select * from public.m8_badge_claims", "select * from public.m8_achievement_claims",
      `insert into public.m8_earned_badges(user_id, badge_id) values ('${other}', 'diamond')`,
      `select public.m8_badge_eligible('${other}', 'diamond')`,
    ]) await assert.rejects(asUser(db, other, sql), { code: "42501" }, sql);
    // The functions take no user argument: there is no way to name another learner.
    for (const fn of ["m8_claim_badge", "m8_claim_achievement", "m8_my_badges", "m8_my_achievement_claims"]) {
      const args = await scalar(db, `select pg_get_function_identity_arguments('public.${fn}'::regproc)`);
      assert.doesNotMatch(args, /uuid/, fn);
    }
    assert.deepEqual(await claimRows(db, other), []);
  });

  await t.test("staff and anonymous callers are refused", async () => {
    for (const user of [USERS.teacher, USERS.admin]) {
      for (const sql of ["select * from public.m8_my_badges()", "select * from public.m8_claim_badge('first_read')",
        "select * from public.m8_my_achievement_claims()", "select * from public.m8_claim_achievement('accurate_reader','bronze')"]) {
        await assert.rejects(asUser(db, user, sql), { code: "42501" }, `${user}: ${sql}`);
      }
    }
    for (const sql of ["select * from public.m8_my_badges()", "select * from public.m8_claim_badge('first_read')", "select * from public.m8_claim_achievement('accurate_reader','bronze')"]) {
      await assert.rejects(asUser(db, null, sql, [], "anon"), { code: "42501" }, sql);
    }
  });

  await t.test("achievement tiers: a tier reached before claiming is Ready, each tier is claimed separately and once", async () => {
    let claims = await asUser(db, achiever, "select * from public.m8_my_achievement_claims()");
    assert.deepEqual(claims, [], "nothing claimed automatically");
    await assert.rejects(claimTier(db, achiever, "accurate_reader", "silver"), { code: "55000" }, "Silver is locked at 3");
    await assert.rejects(claimTier(db, achiever, "comprehension_star", "gold"), { code: "55000" });
    await assert.rejects(claimTier(db, achiever, "made_up", "bronze"), { code: "22023" });
    await assert.rejects(claimTier(db, achiever, "accurate_reader", "platinum"), { code: "22023" });
    const xp = await totalXp(db, achiever);
    const bronze = await claimTier(db, achiever, "accurate_reader", "bronze");
    assert.equal(bronze.newly_claimed, true);
    assert.equal((await claimTier(db, achiever, "accurate_reader", "bronze")).newly_claimed, false, "once");
    assert.deepEqual(await tierRows(db, achiever), [{ achievement_id: "accurate_reader", tier: "bronze" }], "Comprehension Star Bronze is separate");
    assert.equal(await totalXp(db, achiever), xp, "no XP for claiming");
    claims = await asUser(db, achiever, "select * from public.m8_my_achievement_claims()");
    assert.deepEqual(claims.map((r) => [r.achievement_id, r.tier]), [["accurate_reader", "bronze"]], "still claimed after a refresh");
  });

  await t.test("achievement tiers are independent: claiming Silver claims neither Bronze nor Gold (Student)", async () => {
    const pupil = await newUser(db, "student");
    for (let i = 0; i < 10; i += 1) { const m = await newModule(db, { assign: true }); await fullActivity(db, pupil, m, m.passages[0]); }
    // A repeated reading of an earlier text cannot add an eleventh.
    const ach = Object.fromEntries((await asUser(db, pupil, "select * from public.m8_my_achievements()")).map((r) => [r.achievement_id, r]));
    assert.equal(ach.comprehension_star.qualifying, 10);
    assert.equal((await claimTier(db, pupil, "comprehension_star", "silver")).newly_claimed, true);
    assert.deepEqual(await tierRows(db, pupil), [{ achievement_id: "comprehension_star", tier: "silver" }]);
    await assert.rejects(claimTier(db, pupil, "comprehension_star", "gold"), { code: "55000" });
    assert.equal((await claimTier(db, pupil, "comprehension_star", "bronze")).newly_claimed, true, "Bronze is still claimable on its own");
    assert.deepEqual((await tierRows(db, pupil)).map((r) => r.tier), ["bronze", "silver"]);
  });

  await t.test("claiming does not change rankings, XP, streaks or reading days", async () => {
    const pupil = await newUser(db, "student");
    const m = await newModule(db, { assign: true });
    await fullActivity(db, pupil, m, m.passages[0]);
    const snapshot = async () => ({
      rows: await protectedRows(db),
      en: await asUser(db, pupil, "select * from public.m8_classroom_rankings($1, 'en')", [ROOM]),
      fil: await asUser(db, pupil, "select * from public.m8_classroom_rankings($1, 'fil')", [ROOM]),
    });
    const s = await snapshot();
    await claimBadge(db, pupil, "first_read");
    assert.deepEqual(await snapshot(), s);
  });

  await t.test("the F1-F5 triggers still unlock badges; logins and reading claim nothing", async () => {
    const user = await newUser(db);
    await db.query("select public.m8_claim_daily_login($1)", [user]);
    for (let i = 0; i < 2; i += 1) { const m = await newModule(db); await fullActivity(db, user, m, m.passages[0]); }
    await db.query("select public.m8_record_reading_day($1, '2026-10-01')", [user]);
    await db.query("select public.m8_record_reading_day($1, '2026-10-02')", [user]);
    await db.query("select public.m8_record_reading_day($1, '2026-10-03')", [user]);
    assert.deepEqual(await earned(db, user), ["first_read", "streak_3"]);
    assert.deepEqual(await claimRows(db, user), []);
    assert.equal(await scalar(db, "select count(*)::int from public.m8_achievement_claims where user_id = $1", [user]), 0);
  });

  await t.test("the rollback refuses once a learner has claimed", async () => {
    await assert.rejects(db.exec(sqlFile(ROLLBACK)), /learners have claimed rewards/);
    await db.exec("rollback");
    assert.ok(await scalar(db, "select to_regclass('public.m8_badge_claims') is not null"));
  });
});

test("the rollback before any learner claim restores the catalog and keeps earned badges", { timeout: 300000 }, async () => {
  const db = await createM8F1BaseDatabase();
  try {
    for (const file of PRIOR) await db.exec(sqlFile(file));
    const user = await newUser(db);
    const m = await newModule(db);
    await fullActivity(db, user, m, m.passages[0]);
    const catalog = async () => ({
      fns: await fingerprints(db),
      all: (await db.query("select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace")).rows[0].n,
      tables: (await db.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).rows,
    });
    const before = await catalog(); const rows = await protectedRows(db);
    const earnedCount = await scalar(db, "select count(*)::int from public.m8_earned_badges");
    assert.ok(earnedCount >= 1);
    await db.exec(sqlFile(CLAIMS));
    assert.equal(await scalar(db, "select count(*)::int from public.m8_badge_claims where preserved"), earnedCount);
    await db.exec(sqlFile(ROLLBACK));
    assert.deepEqual(await catalog(), before);
    assert.deepEqual(await protectedRows(db), rows, "the earned badge is still there");
    await db.exec(sqlFile(CLAIMS)); // re-apply works
    assert.equal(await scalar(db, "select count(*)::int from public.m8_badge_claims where preserved"), earnedCount);
  } finally {
    await db.close();
  }
});
