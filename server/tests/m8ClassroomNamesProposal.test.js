// PROPOSED M8 F4 classroom display names on real PostgreSQL 17 (PGlite, in memory), on top of F1-F4 and reward
// claiming. supabase/proposed/m8_f4_classroom_names_v1_*.sql. No network, no staging.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sqlFile } = require("./fixtures/m5M6SecurityDatabase");
const { ROOM, USERS } = require("./fixtures/m8TrustDatabase");
const { completeM6, createM8F1BaseDatabase, newModule, newRoom, newUser, readAloud, totalXp } = require("./fixtures/m8F1Database");

const F = (name) => `supabase/proposed/${name}.sql`;
const PRIOR = ["m8_f1_xp_rewards_v1_PROPOSED", "m8_f2_badges_streaks_v1_PROPOSED", "m8_f3_achievements_v1_PROPOSED", "m8_f4_rankings_v1_PROPOSED",
  "m8_f2_f3_reward_claims_v1_PROPOSED"].map(F);
const NAMES = F("m8_f4_classroom_names_v1_PROPOSED");
const ROLLBACK = F("m8_f4_classroom_names_v1_ROLLBACK_PROPOSED");
const VERIFY = F("m8_f4_classroom_names_v1_VERIFY_READONLY");

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
const rank = (db, user, room, language = "en") => asUser(db, user, "select * from public.m8_classroom_rankings($1,$2)", [room, language]);
const nick = (db, user, nickname) => db.query("update public.profiles set nickname = $2 where id = $1", [user, nickname]);
const fullActivity = async (db, user, module, passage) => { await readAloud(db, { user, module, passage }); await completeM6(db, { user, module, passage }); };
const fingerprints = async (db, except = []) => Object.fromEntries((await db.query(`select p.oid::regprocedure::text f, md5(pg_get_functiondef(p.oid)) m
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all($1)`, [except])).rows.map((r) => [r.f, r.m]));
const displayName = (db, value) => scalar(db, "select public.m8_classroom_display_name($1)", [value]);

test("M8 F4 classroom display names", { timeout: 900000 }, async (t) => {
  const db = await createM8F1BaseDatabase();
  t.after(() => db.close());
  // As on Staging (M4 archive): rooms can be archived.
  await db.exec("alter table public.rooms add column if not exists archived_at timestamptz");

  await t.test("stops without F1-F4", async () => {
    await assert.rejects(db.exec(sqlFile(NAMES)), /apply M8 F1-F4 first/);
    await db.exec("rollback");
  });
  for (const file of PRIOR) await db.exec(sqlFile(file));

  // A classroom with named classmates, plus a second classroom.
  const me = await newUser(db, "student"); await nick(db, me, "maria santos");
  const jose = await newUser(db, "student"); await nick(db, jose, "Jose  Rizal Mercado");
  const ana1 = await newUser(db, "student"); await nick(db, ana1, "Ana");
  const ana2 = await newUser(db, "student"); await nick(db, ana2, "ana");
  const none = await newUser(db, "student");
  const email = await newUser(db, "student"); await nick(db, email, "kid@example.com");
  const digits = await newUser(db, "student"); await nick(db, digits, "Ben10");
  const you = await newUser(db, "student"); await nick(db, you, "You");
  const fake = await newUser(db, "student"); await nick(db, fake, "Reader 03DF2F");
  await db.query("update public.profiles set full_name = 'Legal Fullname Secret' where id = $1", [jose]);
  // A Student of another classroom only (newUser enrols every new Student in ROOM, so add the role afterwards).
  const outsider = await newUser(db); await nick(db, outsider, "Zed Outsider");
  await db.query("update public.profiles set role = 'student' where id = $1", [outsider]);
  const otherRoom = await newRoom(db, outsider);
  const module = await newModule(db, { assign: true });
  await fullActivity(db, jose, module, module.passages[0]);
  const il = await newUser(db); await nick(db, il, "Lena Indie");

  const f4Rooms = await rank(db, me, ROOM);
  const f4Independent = await asUser(db, il, "select * from public.m8_independent_rankings('weekly','en')");
  const before = await fingerprints(db, ["m8_classroom_rankings"]);
  const xpBefore = (await db.query("select * from public.m8_xp_events order by id")).rows;
  await db.exec(sqlFile(VERIFY)); // the read-only verify script runs before applying
  await db.exec(sqlFile(NAMES));
  await db.exec(sqlFile(VERIFY)); // and after

  await t.test("applying changes only m8_classroom_rankings and adds the internal name helper; cannot run twice", async () => {
    const after = await fingerprints(db, ["m8_classroom_rankings", "m8_classroom_display_name"]);
    assert.deepEqual(after, before, "F1 XP, F2 badges, F3 achievements, F5 streaks, claiming and Independent rankings untouched");
    assert.deepEqual((await db.query("select * from public.m8_xp_events order by id")).rows, xpBefore);
    await assert.rejects(db.exec(sqlFile(NAMES)), /already installed/); await db.exec("rollback");
    for (const [role, fn] of [["authenticated", "public.m8_classroom_display_name(text)"], ["anon", "public.m8_classroom_display_name(text)"],
      ["authenticated", "public.m8_classroom_leaderboard(uuid)"], ["authenticated", "public.m8_weekly_leaderboard()"], ["authenticated", "public.m8_independent_leaderboard(text)"],
      ["anon", "public.m8_classroom_rankings(uuid,text)"]]) {
      assert.equal(await scalar(db, `select has_function_privilege('${role}','${fn}','EXECUTE')`), false, `${role} ${fn}`);
    }
  });

  await t.test("the short name: first word and last initial; unsafe or missing nicknames give null", async () => {
    const cases = {
      "maria santos": "Maria S.", "Jose  Rizal Mercado": "Jose M.", "  Ana\t": "Ana", "Ma. Cristina de la Cruz": "Ma. C.",
      "Niño Peña": "Niño P.", "O'Neil Smith-Jones": "O'Neil S.",
      "": null, "   ": null, "New user": null, "kid@example.com": null, "Ben10": null, "www.example.com/x": null, "<b>Hi</b>": null,
      "You": null, "you there": null, "Reader 03DF2F": null, "Reader": null, "Supercalifragilisticexpialidocious": null, [null]: null,
    };
    for (const [input, want] of Object.entries(cases)) assert.equal(await displayName(db, input === "null" ? null : input), want, JSON.stringify(input));
    assert.equal(await displayName(db, "a".repeat(41)), null, "too long");
  });

  await t.test("Students see classmates' short names; the viewer is 'You (First)'; unsafe and missing names stay pseudonyms", async () => {
    const rows = await rank(db, me, ROOM);
    const label = Object.fromEntries(rows.map((r) => [r.entry_id, r.display_name]));
    const byXp = rows.find((r) => Number(r.xp) > 0);
    assert.equal(byXp.display_name, "Jose M.", "Jose leads with this week's XP and shows his short name");
    assert.equal(rows.find((r) => r.is_me).display_name, "You (Maria)");
    assert.equal(rows.filter((r) => r.is_me).length, 1);
    const names = rows.map((r) => r.display_name);
    // Same short name twice: both get the pseudonym code so they can be told apart.
    const anas = names.filter((n) => n.startsWith("Ana"));
    assert.equal(anas.length, 2); assert.ok(anas.every((n) => /^Ana · [0-9A-F]{6}$/.test(n)), anas); assert.notEqual(anas[0], anas[1]);
    // Everyone else falls back to the real pseudonym: no nickname, an email, digits, "You", a fake pseudonym,
    // and the fixture's two Students without nicknames.
    const named = names.filter((n) => !/^Reader [0-9A-F]{6}$/.test(n));
    assert.deepEqual(named.map((n) => n.replace(/ · [0-9A-F]{6}$/, "")).sort(), ["Ana", "Ana", "Jose M.", "You (Maria)"], names);
    assert.equal(names.length - named.length, 7, "5 unsafe or missing nicknames + 2 fixture Students");
    assert.equal(names.filter((n) => n === "You" || n.startsWith("You (")).length, 1, "nobody else can look like the viewer");
    // Rankings and XP unchanged from F4: same opaque IDs, same XP, same order.
    assert.deepEqual(rows.map((r) => [r.entry_id, r.xp, r.is_me]), f4Rooms.map((r) => [r.entry_id, r.xp, r.is_me]));
    assert.equal(Object.keys(label).length, rows.length);
  });

  await t.test("nothing private leaves: no IDs, emails, full names, other rooms or reading levels", async () => {
    const text = JSON.stringify(await rank(db, me, ROOM)) + JSON.stringify(await rank(db, me, ROOM, "fil"));
    for (const secret of [me, jose, ana1, outsider, il, "example.com", "Legal", "Fullname", "Secret", "Santos", "Rizal", "Mercado", "Zed", "Outsider",
      "Lena", "Frustration", "Instructional", "Independent", "Easy", "Medium", "Hard"]) {
      assert.equal(text.includes(secret), false, secret);
    }
    for (const row of await rank(db, me, ROOM)) assert.deepEqual(Object.keys(row).sort(), ["display_name", "entry_id", "is_me", "xp"]);
  });

  await t.test("membership is checked in the database: no rows for another classroom, staff or anonymous callers", async () => {
    assert.deepEqual(await rank(db, me, otherRoom), [], "a room the Student is not in");
    assert.deepEqual(await rank(db, outsider, ROOM), [], "the outsider cannot see this room's names");
    const theirs = await rank(db, outsider, otherRoom);
    assert.deepEqual(theirs.map((r) => r.display_name), ["You (Zed)"], "the other room holds only its own member");
    for (const staff of [USERS.teacher, USERS.admin]) assert.deepEqual(await rank(db, staff, ROOM), [], "staff are not members");
    await assert.rejects(rank(db, null, ROOM).then(() => asUser(db, null, "select * from public.m8_classroom_rankings($1,'en')", [ROOM], "anon")), { code: "42501" });
    await assert.rejects(rank(db, me, ROOM, "xx"), { code: "22023" });
  });

  await t.test("names only for an active Student in an active classroom; otherwise the F4 pseudonyms", async () => {
    await db.query("update public.rooms set archived_at = now() where id = $1", [ROOM]);
    const archived = await rank(db, me, ROOM);
    assert.ok(archived.filter((r) => !r.is_me).every((r) => /^Reader [0-9A-F]{6}$/.test(r.display_name)));
    assert.equal(archived.find((r) => r.is_me).display_name, "You");
    await db.query("update public.rooms set archived_at = null where id = $1", [ROOM]);
    await db.query("update public.profiles set status = 'suspended' where id = $1", [jose]);
    assert.match((await rank(db, me, ROOM)).find((r) => Number(r.xp) > 0).display_name, /^Reader [0-9A-F]{6}$/, "an inactive classmate keeps the pseudonym");
    await db.query("update public.profiles set status = 'active' where id = $1", [jose]);
    // An enrolled non-Student (data error) sees pseudonyms only, and is never named.
    await db.query("update public.profiles set role = 'general_user' where id = $1", [ana2]);
    const odd = await rank(db, ana2, ROOM);
    assert.ok(odd.filter((r) => !r.is_me).every((r) => /^Reader [0-9A-F]{6}$/.test(r.display_name)));
    assert.equal((await rank(db, me, ROOM)).filter((r) => r.display_name.startsWith("Ana")).map((r) => r.display_name).join(), "Ana", "now unique: no suffix");
    await db.query("update public.profiles set role = 'student' where id = $1", [ana2]);
  });

  await t.test("a renamed nickname shows at once; English and Filipino still rank separately", async () => {
    await nick(db, jose, "Pepe Cruz");
    assert.ok((await rank(db, me, ROOM)).some((r) => r.display_name === "Pepe C."));
    const fil = await rank(db, me, ROOM, "fil");
    assert.equal(Number(fil.find((r) => r.display_name === "Pepe C.").xp), 0, "English XP is not in the Filipino ranking");
  });

  await t.test("Independent Learner rankings stay anonymous and unchanged", async () => {
    const now = await asUser(db, il, "select * from public.m8_independent_rankings('weekly','en')");
    assert.deepEqual(now, f4Independent);
    assert.ok(now.every((r) => r.display_name === "You" || /^Reader [0-9A-F]{6}$/.test(r.display_name)));
    assert.equal(JSON.stringify(now).includes("Lena"), false);
  });

  await t.test("reward claiming and XP still work", async () => {
    const xp = await totalXp(db, jose);
    const claim = await asUser(db, jose, "select * from public.m8_claim_badge('first_read')");
    assert.equal(claim[0].newly_claimed, true);
    assert.equal(await totalXp(db, jose), xp);
  });

  await t.test("the rollback restores F4 exactly", async () => {
    await db.exec(sqlFile(ROLLBACK));
    assert.equal(await scalar(db, "select to_regprocedure('public.m8_classroom_display_name(text)') is null"), true);
    const restored = await rank(db, me, ROOM);
    assert.ok(restored.filter((r) => !r.is_me).every((r) => /^Reader [0-9A-F]{6}$/.test(r.display_name)));
    assert.equal(restored.find((r) => r.is_me).display_name, "You");
    assert.deepEqual(await fingerprints(db, ["m8_classroom_rankings"]), before);
    await db.exec(sqlFile(NAMES)); // re-apply works
    assert.equal((await rank(db, me, ROOM)).find((r) => r.is_me).display_name, "You (Maria)");
  });
});
