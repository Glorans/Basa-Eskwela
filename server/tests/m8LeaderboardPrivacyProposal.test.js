// PROPOSED M8 leaderboard display names with learner privacy choices on real PostgreSQL 17 (PGlite, in memory), on top
// of F1-F4, reward claiming and classroom names. supabase/proposed/m8_leaderboard_privacy_v1_*.sql. No network, no staging.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile } = require("./fixtures/m5M6SecurityDatabase");
const { ROOM, USERS } = require("./fixtures/m8TrustDatabase");
const { completeM6, createM8F1BaseDatabase, newModule, newRoom, newUser, readAloud } = require("./fixtures/m8F1Database");

const F = (name) => `supabase/proposed/${name}.sql`;
const PRIOR = ["m8_f1_xp_rewards_v1_PROPOSED", "m8_f2_badges_streaks_v1_PROPOSED", "m8_f3_achievements_v1_PROPOSED", "m8_f4_rankings_v1_PROPOSED",
  "m8_f2_f3_reward_claims_v1_PROPOSED", "m8_f4_classroom_names_v1_PROPOSED"].map(F);
const PROPOSED = F("m8_leaderboard_privacy_v1_PROPOSED");
const ROLLBACK = F("m8_leaderboard_privacy_v1_ROLLBACK_PROPOSED");
const PREFLIGHT = F("m8_leaderboard_privacy_v1_PREFLIGHT_READONLY");
const VERIFY = F("m8_leaderboard_privacy_v1_VERIFY_READONLY");

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
const rank = (db, user, room = ROOM) => asUser(db, user, "select * from public.m8_classroom_rankings($1,'en')", [room]);
const ilRank = (db, user) => asUser(db, user, "select * from public.m8_independent_rankings('all_time','en')");
const choose = (db, user, visibility, alias = null) => asUser(db, user, "select * from public.m8_set_leaderboard_privacy($1,$2)", [visibility, alias]);
const names = (rows) => rows.map((r) => r.display_name);
const nick = (db, user, nickname) => db.query("update public.profiles set nickname = $2 where id = $1", [user, nickname]);
const enable = (db, audience, on = true) => db.query("update public.m8_leaderboard_settings set names_enabled = $2 where audience = $1", [audience, on]);
const fnmd5 = (db, sig) => scalar(db, `select md5(replace(pg_get_functiondef('public.${sig}'::regprocedure), chr(13), ''))`);
const dataPrint = (db) => scalar(db, `select md5(coalesce((select string_agg(x::text, ',' order by x.id) from public.m8_xp_events x), '') || '|' ||
  coalesce((select string_agg(e::text, ',' order by e.user_id, e.badge_id) from public.m8_earned_badges e), '') || '|' ||
  coalesce((select string_agg(c::text, ',' order by c.user_id, c.badge_id) from public.m8_badge_claims c), '') || '|' ||
  coalesce((select string_agg(p::text, ',' order by p.id) from public.profiles p), ''))`);

test("M8 leaderboard privacy choices", { timeout: 900000 }, async (t) => {
  const db = await createM8F1BaseDatabase();
  t.after(() => db.close());
  await db.exec("alter table public.rooms add column if not exists archived_at timestamptz");

  await t.test("stops unless the reviewed ranking functions are installed", async () => {
    await assert.rejects(db.exec(sqlFile(PROPOSED)), /not the reviewed version/);
    await db.exec("rollback");
  });
  for (const file of PRIOR) await db.exec(sqlFile(file));

  // Classmates with profile nicknames (never published by this migration), an IL pair and a second classroom.
  const me = await newUser(db, "student"); await nick(db, me, "Mila Santos");
  const ana = await newUser(db, "student"); await nick(db, ana, "Ana Reyes");
  const ben = await newUser(db, "student"); await nick(db, ben, "Ben Cruz");
  const carla = await newUser(db, "student"); await nick(db, carla, "Carla Lim");
  const outsider = await newUser(db); await db.query("update public.profiles set role = 'student' where id = $1", [outsider]);
  const otherRoom = await newRoom(db, outsider);
  const il1 = await newUser(db); await nick(db, il1, "Lena Indie");
  const il2 = await newUser(db); await nick(db, il2, "Paolo Indie");
  const module = await newModule(db, { assign: true });
  await readAloud(db, { user: ben, module, passage: module.passages[0] }); await completeM6(db, { user: ben, module, passage: module.passages[0] });

  const reviewed = { c: await fnmd5(db, "m8_classroom_rankings(uuid,text)"), i: await fnmd5(db, "m8_independent_rankings(text,text)") };
  const before = { room: await rank(db, me), il: await ilRank(db, il1), data: await dataPrint(db) };

  await t.test("PREFLIGHT passes read-only; apply; VERIFY passes; cannot run twice", async () => {
    const pre = (await db.query(sqlFile(PREFLIGHT))).rows;
    assert.deepEqual(pre.filter((r) => r.result === "FAIL"), [], JSON.stringify(pre));
    await db.exec(sqlFile(PROPOSED));
    const ver = (await db.query(sqlFile(VERIFY))).rows;
    assert.deepEqual(ver.filter((r) => r.result === "FAIL"), [], JSON.stringify(ver));
    for (const label of ["claims fingerprint", "earned badges and XP fingerprint", "profiles fingerprint"]) {
      assert.equal(ver.find((r) => r.check.startsWith(label)).detail, pre.find((r) => r.check.startsWith(label)).detail, label);
    }
    await assert.rejects(db.exec(sqlFile(PROPOSED)), /not the reviewed version|already applied/); await db.exec("rollback");
  });

  await t.test("switches OFF after the migration: every classmate is a Reader code; scores and order unchanged", async () => {
    const rows = await rank(db, me);
    assert.deepEqual(names(rows).filter((n) => !/^Reader [0-9A-F]{6}$/.test(n)), ["You (Mila)"], names(rows).join());
    assert.deepEqual(rows.map((r) => [r.entry_id, r.xp, r.is_me]), before.room.map((r) => [r.entry_id, r.xp, r.is_me]));
    assert.deepEqual(await ilRank(db, il1), before.il, "Independent ranking identical while nobody chose anything");
    assert.deepEqual(await asUser(db, me, "select * from public.m8_my_leaderboard_privacy()"), [{ visibility: "nickname", alias: "Mila S.", names_allowed: false }],
      "a Student's default is their classroom nickname (their own data only)");
    assert.deepEqual(await asUser(db, il1, "select * from public.m8_my_leaderboard_privacy()"), [{ visibility: "anonymous", alias: null, names_allowed: false }],
      "an Independent Learner's default is anonymous");
  });

  await t.test("Students never type a nickname: any alias is ignored and the switch is not needed to save a choice", async () => {
    assert.deepEqual(await choose(db, ana, "nickname", "kid@example.com"), [{ visibility: "nickname", alias: "Ana R.", names_allowed: false }]);
    assert.deepEqual(await choose(db, ana, "anonymous", "Maria"), [{ visibility: "anonymous", alias: "Ana R.", names_allowed: false }]);
    assert.equal(await scalar(db, "select alias from public.m8_leaderboard_privacy where user_id = $1", [ana]), null, "no typed alias stored for Students");
    await assert.rejects(choose(db, ana, "public", null), { code: "22023" });
    await choose(db, ana, "nickname");
  });

  await t.test("classroom names ON: classmates show their classroom nickname by default; anonymous keeps a code; hidden left out", async () => {
    await enable(db, "classroom");
    await choose(db, carla, "hidden");
    let rows = await rank(db, me);
    assert.ok(names(rows).includes("Ana R.") && names(rows).includes("Ben C."), names(rows).join());
    assert.equal(rows.length, before.room.length - 1, "Carla left out");
    assert.equal(rows.find((r) => r.display_name === "Ben C.").xp, before.room.find((r) => Number(r.xp) > 0).xp, "XP unchanged");
    for (const secret of ["Carla", "Reyes", "Cruz", "Santos", "Lim", ana, ben, carla]) assert.equal(JSON.stringify(rows).includes(secret), false, secret);
    for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ["display_name", "entry_id", "is_me", "xp"]);
    await choose(db, ben, "anonymous");
    rows = await rank(db, me);
    assert.equal(names(rows).includes("Ben C."), false, "an explicit anonymous choice is honoured with names ON");
    const hers = await rank(db, carla);
    assert.equal(hers.length, before.room.length); assert.equal(hers.find((r) => r.is_me).display_name, "You (Carla)");
    // The viewer sees their own first name; classmates see "Mila S.".
    assert.ok(names(hers).includes("Mila S."));
    await nick(db, ana, "Mila Sy");
    const dup = names(await rank(db, carla)).filter((n) => n.startsWith("Mila S."));
    assert.equal(dup.length, 2); assert.ok(dup.every((n) => /^Mila S\. · [0-9A-F]{6}$/.test(n)), dup.join());
    await nick(db, ana, "Ana Reyes"); await choose(db, ben, "nickname");
  });

  await t.test("only active Students' nicknames, only to active members", async () => {
    await db.query("update public.profiles set status = 'inactive' where id = $1", [ana]);
    assert.equal(names(await rank(db, me)).includes("Ana R."), false, "a deactivated classmate is a code");
    assert.equal(names(await rank(db, ana)).some((n) => /Ben C\.|Mila S\./.test(n)), false, "a deactivated viewer sees codes only");
    await db.query("update public.profiles set status = 'active' where id = $1", [ana]);
  });

  await t.test("access: Students only for classrooms, ILs only for the IL ranking, members only, signed-in only", async () => {
    await assert.rejects(rank(db, il1), { code: "42501" });
    await assert.rejects(rank(db, USERS.teacher), { code: "42501" });
    await assert.rejects(asUser(db, me, "select * from public.m8_independent_rankings('weekly','en')"), { code: "42501" });
    assert.deepEqual(await rank(db, outsider), [], "another classroom's (or school's) Student gets no rows");
    assert.deepEqual(await rank(db, me, otherRoom), []);
    await assert.rejects(choose(db, USERS.teacher, "hidden"), { code: "42501" });
    for (const sql of ["select * from public.m8_leaderboard_privacy", "select * from public.m8_leaderboard_settings", "select public.m8_leaderboard_alias('x')",
      "select public.m8_leaderboard_names_enabled('classroom')"]) {
      await assert.rejects(asUser(db, me, sql), { code: "42501" }, sql);
    }
    for (const sql of ["select * from public.m8_classroom_rankings('" + ROOM + "','en')", "select * from public.m8_independent_rankings('weekly','en')",
      "select * from public.m8_my_leaderboard_privacy()", "select * from public.m8_set_leaderboard_privacy('hidden', null)"]) {
      await assert.rejects(asUser(db, null, sql, [], "anon"), { code: "42501" }, sql);
    }
  });

  await t.test("archived classroom shows codes only (hidden still out); restored shows nicknames again; switch off hides all", async () => {
    await db.query("update public.rooms set archived_at = now() where id = $1", [ROOM]);
    const archived = await rank(db, me);
    assert.ok(names(archived).filter((n) => n !== "You").every((n) => /^Reader [0-9A-F]{6}$/.test(n)), names(archived).join());
    assert.equal(archived.length, before.room.length - 1);
    await db.query("update public.rooms set archived_at = null where id = $1", [ROOM]);
    assert.ok(names(await rank(db, me)).includes("Ana R."));
    await enable(db, "classroom", false);
    assert.deepEqual(names(await rank(db, me)).filter((n) => !/^Reader /.test(n)), ["You (Mila)"]);
    await enable(db, "classroom");
  });

  await t.test("Independent Learners: a typed alias needs the switch (409) and must be safe (400)", async () => {
    await assert.rejects(choose(db, il2, "nickname", "PageTurner"), { code: "PT409" });
    await enable(db, "independent");
    for (const bad of ["kid@example.com", "www.x.com/me", "Reader 4F2A9C", "You", "x", "A".repeat(21), "123456789", "Mila 09171234567", "<b>x</b>"]) {
      await assert.rejects(choose(db, il2, "nickname", bad), { code: "22023" }, bad);
    }
    await assert.rejects(choose(db, il2, "nickname", "   "), { code: "22023" });
    await enable(db, "independent", false);
  });

  await t.test("Independent Learners: separate switch; own alias shown to others; hidden left out; no Student names", async () => {
    await assert.rejects(choose(db, il2, "nickname", "PageTurner"), { code: "PT409" });
    await enable(db, "independent");
    await choose(db, il2, "nickname", "PageTurner");
    assert.ok(names(await ilRank(db, il1)).includes("PageTurner"));
    assert.equal(names(await ilRank(db, il2)).find((n) => n.startsWith("You")), "You (PageTurner)");
    await choose(db, il2, "hidden", "PageTurner");
    const rows = await ilRank(db, il1);
    assert.equal(names(rows).includes("PageTurner"), false);
    assert.equal(rows.length, (await ilRank(db, il2)).length - 1);
    for (const secret of ["Maria", "ReadingStar", "Lena", "Paolo"]) assert.equal(JSON.stringify(rows).includes(secret), false, secret);
  });

  await t.test("choices never change XP, rewards or profiles", async () => {
    assert.equal(await dataPrint(db), before.data);
  });

  await t.test("ROLLBACK restores both ranking functions verbatim and removes the new objects", async () => {
    await db.exec(sqlFile(ROLLBACK));
    assert.equal(await fnmd5(db, "m8_classroom_rankings(uuid,text)"), reviewed.c);
    assert.equal(await fnmd5(db, "m8_independent_rankings(text,text)"), reviewed.i);
    for (const obj of ["public.m8_leaderboard_privacy", "public.m8_leaderboard_settings"]) assert.equal(await scalar(db, `select to_regclass('${obj}')`), null);
    assert.equal(await scalar(db, "select to_regprocedure('public.m8_set_leaderboard_privacy(text,text)')"), null);
    assert.equal(await scalar(db, "select has_function_privilege('authenticated','public.m8_classroom_rankings(uuid,text)','EXECUTE')"), true);
    assert.equal(await scalar(db, "select has_function_privilege('anon','public.m8_classroom_rankings(uuid,text)','EXECUTE')"), false);
    assert.equal(await dataPrint(db), before.data);
    await db.exec(sqlFile(PROPOSED)); // applies again cleanly after a rollback
  });
});
