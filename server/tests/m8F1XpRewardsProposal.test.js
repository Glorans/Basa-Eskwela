// PROPOSED M8 F1 XP rewards on real PostgreSQL 17 (PGlite, in memory):
// supabase/proposed/m8_f1_xp_rewards_v1_PROPOSED.sql over the definitions ReadFlow-Staging has today.
// PGlite has one connection, so simultaneous requests are checked here for their outcome only;
// true multi-connection races are checked separately on a disposable PostgreSQL.
// No network, no staging database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sqlFile } = require("./fixtures/m5M6SecurityDatabase");
const { ROOM, USERS, verifiedDiagnostic } = require("./fixtures/m8TrustDatabase");
const {
  assignMaterial, completeM6, createM8F1BaseDatabase, newMaterial, newModule, newRoom, newUser, nextId, readAloud, requesterOf, rpcClient,
  totalXp, xpEvents,
} = require("./fixtures/m8F1Database");
const { summarizeComprehension } = require("../services/comprehensionScoring");

const PROPOSED = "supabase/proposed/m8_f1_xp_rewards_v1_PROPOSED.sql";
const ROLLBACK = "supabase/proposed/m8_f1_xp_rewards_v1_ROLLBACK_PROPOSED.sql";
const REPLACED = {
  "public.m8_grant_xp(uuid,text,uuid,integer)": "3e803b9b0c2543fdfe132060a811c70a",
  "public.m8_on_comprehension_completed()": "a31be79ffcd4e76ea3396a808f4cbd3a",
  "public.m8_award_graduate(uuid)": "3516a76d0547cdc64d2d0d9d03555582",
  "public.m8_on_module_xp_granted()": "c63db1f4be03ae32413047cb2844200c",
  "public.m8_weekly_leaderboard()": "e09ba39cdef64cfd31d4eff1500a192c",
  "public.m8_classroom_leaderboard(uuid)": "111d438f1ecddd69f37929270f3d0e27",
  "public.m8_independent_leaderboard(text)": "0fa0574f46b772474da40a72a35af09a",
};
const md5 = async (db, fn) => (await db.query(`select md5(replace(pg_get_functiondef('${fn}'::regprocedure), chr(13), '')) m`)).rows[0].m;
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const claim = async (db, user, at) => scalar(db, "select public.m8_claim_daily_login_at($1,$2)", [user, at]);
const reward = (xp) => ["passage", xp];
const BONUS = ["module_bonus", 50];
/** A saved reading written directly, for receipt tests that control every field. */
async function rawReading(db, { user, module, passage, submission, errors = 0 }) {
  const metrics = passage.text.split(" ").map((word) => ({ expected: word, actual: word, type: "match" }));
  return (await db.query(`insert into public.oral_reading_attempts(user_id, module_id, passage_id, passage_snapshot, transcript, language_snapshot,
      scoring_version, expected_word_count, detected_error_count, pronunciation_accuracy, word_metrics, submission_id)
    values ($1,$2,$3,$4,$4,'en',2,$5,$6,100,$7,$8) returning *`,
  [user, module.id, passage.id, passage.text, metrics.length, errors, JSON.stringify(metrics), submission])).rows[0];
}

test("M8 F1 rewards on real PostgreSQL", { timeout: 600000 }, async (t) => {
  const db = await createM8F1BaseDatabase();
  t.after(() => db.close());

  // ------------------------------------------------------------ history, before the migration
  const history = await newUser(db);
  await verifiedDiagnostic(db, history, "en", "Instructional", nextId());
  const historicModule = await newModule(db);
  const historicM6 = await completeM6(db, { user: history, module: historicModule, passage: historicModule.passages[0] });
  const student = await newUser(db, "student");
  const historicMaterial = await newMaterial(db, { student });
  await completeM6(db, { user: student, material: historicMaterial });
  const historicReadOnlyModule = await newModule(db, { passages: [{ reviewed: false }] });
  await db.query(`insert into public.oral_reading_attempts(user_id, module_id, passage_id, passage_snapshot, language_snapshot)
    values ($1,$2,$3,$4,'en')`, [history, historicReadOnlyModule.id, historicReadOnlyModule.passages[0].id, historicReadOnlyModule.passages[0].text]);
  const multiLegacyModule = await newModule(db, { passages: [{}, {}] });
  await completeM6(db, { user: history, module: multiLegacyModule, passage: multiLegacyModule.passages[0] });

  const snapshot = async () => ({
    xp: (await db.query("select id, user_id, source_type, source_id, xp_earned, created_at from public.m8_xp_events order by id")).rows,
    progress: (await db.query("select * from public.m8_learner_progress order by user_id")).rows,
    badges: (await db.query("select * from public.m8_earned_badges order by 1,2")).rows,
    days: (await db.query("select * from public.m8_reading_days order by 1,2")).rows,
    diagnostics: (await db.query("select id, reading_level, verification_status from public.diagnostic_results order by id")).rows,
  });

  await t.test("the replay equals Staging's fingerprints, so the guards are real", async () => {
    for (const [fn, fp] of Object.entries(REPLACED)) assert.equal(await md5(db, fn), fp, fn);
  });

  const before = await snapshot();
  await db.exec(sqlFile(PROPOSED));
  await t.test("applying changes no existing reward row and cannot run twice", async () => {
    assert.deepEqual(await snapshot(), before);
    assert.ok(before.xp.some((row) => row.source_type === "module"), "the history includes legacy module XP");
    assert.ok(before.xp.some((row) => row.source_type === "assignment" && row.xp_earned === 60), "and legacy assignment XP");
    await assert.rejects(db.exec(sqlFile(PROPOSED)), /differs from the reviewed definition|already installed/);
    await db.exec("rollback");
  });

  const xp = async (rn, rd, cn, cd) => scalar(db, "select public.m8_calculate_passage_xp($1,$2,$3,$4)", [rn, rd, cn, cd]);

  await t.test("1-3. The final formula, including the given examples and exact half-up rounding", async () => {
    for (const [reading, comprehension, expected] of [[40, 40, 52], [60, 60, 68], [80, 70, 80], [90, 90, 92], [100, 100, 100], [0, 0, 20]]) {
      assert.equal(await xp(reading, 100, comprehension, 100), expected, `${reading}/${comprehension}`);
    }
    assert.equal(await xp(1, 16, 0, 1), 23, "22.5 rounds up");
    assert.equal(await xp(21, 32, null, null), 73, "reading only: 72.5 rounds up");
    assert.equal(await xp(1, 3, 2, 3), 60, "thirds sum exactly, with no decimal drift");
    assert.equal(await xp(1, 3, 1, 3), 47, "46.67 rounds to the nearest");
    assert.equal(await xp(null, null, 3, 4), 80, "comprehension only: 20 + 0.8 x 75");
    await assert.rejects(xp(null, null, null, null), /verified score/, "no components is refused, never 0%");
    await assert.rejects(xp(11, 10, null, null), /Invalid passage score/);
  });

  await t.test("the SQL comprehension score agrees with the M6 scorer, using first answers only", async () => {
    const user = await newUser(db);
    const module = await newModule(db);
    const passage = module.passages[0];
    await readAloud(db, { user, module, passage, accuracy: 100 });
    const attempt = await completeM6(db, { user, module, passage, correct: 7, total: 10 });
    const row = (await db.query("select question_snapshot from public.m6_comprehension_attempts where id = $1", [attempt])).rows[0];
    const responses = (await db.query("select question_id, first_option_index, resolved from public.m6_comprehension_responses where attempt_id = $1", [attempt])).rows;
    const summary = summarizeComprehension(row.question_snapshot, responses);
    const saved = (await db.query("select questions_correct, questions_total from public.m8_passage_rewards where user_id = $1", [user])).rows[0];
    assert.deepEqual([saved.questions_correct, saved.questions_total], [summary.firstCorrect, summary.totalQuestions]);
  });

  await t.test("1. Reading 80%, comprehension 70% = 80 XP, plus the bonus for a one-passage module", async () => {
    const user = await newUser(db);
    const module = await newModule(db);
    const passage = module.passages[0];
    const { verification } = await readAloud(db, { user, module, passage, accuracy: 80 });
    assert.equal(verification.verified, true);
    assert.deepEqual(await xpEvents(db, user), [], "reading alone earns nothing while M6 is required");
    await completeM6(db, { user, module, passage, correct: 7 });
    assert.deepEqual(await xpEvents(db, user), [reward(80), BONUS]);
    assert.equal(await totalXp(db, user), 130);
  });

  await t.test("2-3. Perfect scores = 100; low scores still earn completion XP", async () => {
    const perfect = await newUser(db);
    let module = await newModule(db);
    await readAloud(db, { user: perfect, module, passage: module.passages[0], accuracy: 100 });
    await completeM6(db, { user: perfect, module, passage: module.passages[0], correct: 10 });
    assert.deepEqual(await xpEvents(db, perfect), [reward(100), BONUS]);

    const low = await newUser(db);
    module = await newModule(db);
    await readAloud(db, { user: low, module, passage: module.passages[0], accuracy: 10 });
    await completeM6(db, { user: low, module, passage: module.passages[0], correct: 0 });
    assert.deepEqual((await xpEvents(db, low))[0], reward(24));
  });

  await t.test("4. Read-aloud-only passage and material; comprehension-only has no product path", async () => {
    const il = await newUser(db);
    const module = await newModule(db, { passages: [{ reviewed: false }] });
    await readAloud(db, { user: il, module, passage: module.passages[0], accuracy: 70 });
    assert.deepEqual(await xpEvents(db, il), [reward(76), BONUS], "20 + 0.8 x 70");

    const pupil = await newUser(db, "student");
    const material = await newMaterial(db, { student: pupil, readAloudOnly: true });
    await readAloud(db, { user: pupil, material, accuracy: 50 });
    assert.deepEqual(await xpEvents(db, pupil), [reward(60)], "assigned materials have no module bonus");

    // A completed M6 with no verified reading is blocked, not scored as a comprehension-only passage.
    const noReading = await newUser(db);
    const m6Only = await newModule(db);
    await completeM6(db, { user: noReading, module: m6Only, passage: m6Only.passages[0], correct: 10 });
    assert.deepEqual(await xpEvents(db, noReading), []);
  });

  await t.test("a missing required score blocks the award, and the reward arrives once it exists", async () => {
    const user = await newUser(db);
    const module = await newModule(db);
    const passage = module.passages[0];
    await readAloud(db, { user, module, passage, accuracy: 90, receipt: false });
    await completeM6(db, { user, module, passage, correct: 10 });
    assert.deepEqual(await xpEvents(db, user), [], "unverified reading: no XP and no bonus");
    assert.equal(await scalar(db, "select status from public.m6_comprehension_attempts where user_id = $1", [user]), "completed", "the assessment still completes");
    await readAloud(db, { user, module, passage, accuracy: 60 });
    assert.deepEqual(await xpEvents(db, user), [reward(84), BONUS], "20 + 24 + 40");
  });

  await t.test("trusted reading: a receipt authorizes one matching reading, and nothing else", async () => {
    const { transcriptSha256, verifySavedReading } = require("../services/readingVerification");
    const deps = { getSupabaseAdmin: () => rpcClient(db), log: () => {} };
    const readOnly = async () => (await newModule(db, { passages: [{ reviewed: false }] }));
    const noXp = async (user) => assert.deepEqual(await xpEvents(db, user), []);
    const refused = (result) => assert.deepEqual(result.verification, { verified: false, reason: "no_receipt" });

    // Forged: a transcript sent straight to the save API with no Azure receipt.
    let user = await newUser(db);
    let module = await readOnly();
    const forged = await readAloud(db, { user, module, passage: module.passages[0], receipt: false });
    refused(forged);
    await noXp(user);
    assert.equal(await scalar(db, "select count(*)::int from public.oral_reading_attempts where id = $1", [forged.attempt.id]), 1, "the reading itself is still saved");

    // Another reading's submission ID.
    user = await newUser(db);
    module = await readOnly();
    refused(await readAloud(db, { user, module, passage: module.passages[0], receiptOverride: { submissionId: nextId() } }));
    await noXp(user);

    // Another learner's receipt, for the same text and submission.
    user = await newUser(db);
    module = await readOnly();
    refused(await readAloud(db, { user, module, passage: module.passages[0], receiptOverride: { requester: await requesterOf(db, await newUser(db)) } }));
    await noXp(user);

    // Issued for another passage ID, or for different text under this passage ID.
    user = await newUser(db);
    module = await readOnly();
    refused(await readAloud(db, { user, module, passage: module.passages[0], receiptOverride: { source: { passageId: nextId() } } }));
    await noXp(user);
    user = await newUser(db);
    module = await readOnly();
    refused(await readAloud(db, { user, module, passage: module.passages[0], receiptOverride: { source: { passage: "A completely different story text." } } }));
    await noXp(user);

    // Another language: the upload's language disagrees with the server's source, so no receipt exists.
    user = await newUser(db);
    module = await readOnly();
    refused(await readAloud(db, { user, module, passage: module.passages[0], receiptOverride: { language: "fil" } }));
    await noXp(user);

    // A different transcript from the one Azure returned.
    user = await newUser(db);
    module = await readOnly();
    const passage = module.passages[0];
    const saved = await readAloud(db, { user, module, passage, accuracy: 50, receipt: false });
    await db.query("select public.m5_record_transcript_receipt($1,'en',$2,$3,$4,$5)", [user, transcriptSha256(passage.text), passage.id, passage.text, saved.attempt.submission_id]);
    assert.deepEqual(await verifySavedReading(await requesterOf(db, user), saved.attempt, deps), { verified: false, reason: "no_receipt" }, "receipt issued after the save is not evidence either");

    // Issued after the reading was saved: a late receipt cannot upgrade an old forged reading.
    const lateUser = await newUser(db);
    const late = await readOnly();
    const lateSaved = await readAloud(db, { user: lateUser, module: late, passage: late.passages[0], accuracy: 100, receipt: false });
    await db.query("select public.m5_record_transcript_receipt($1,'en',$2,$3,$4,$5)", [lateUser, transcriptSha256(lateSaved.attempt.transcript), late.passages[0].id, late.passages[0].text, lateSaved.attempt.submission_id]);
    assert.deepEqual(await verifySavedReading(await requesterOf(db, lateUser), lateSaved.attempt, deps), { verified: false, reason: "no_receipt" });
    await noXp(lateUser);

    // Expired, even though everything else matches.
    const oldUser = await newUser(db);
    const old = await readOnly();
    const oldSubmission = nextId();
    const oldText = old.passages[0].text;
    await db.query("select public.m5_record_transcript_receipt($1,'en',$2,$3,$4,$5)", [oldUser, transcriptSha256(oldText), old.passages[0].id, oldText, oldSubmission]);
    await db.query("update public.m5_transcript_receipts set issued_at = now() - interval '25 hours' where user_id = $1", [oldUser]);
    const oldRow = await rawReading(db, { user: oldUser, module: old, passage: old.passages[0], submission: oldSubmission });
    assert.deepEqual(await verifySavedReading(await requesterOf(db, oldUser), oldRow, deps), { verified: false, reason: "no_receipt" });

    // Replayed: one receipt, two saves carrying the same submission and transcript.
    const twice = await newUser(db);
    const twiceModule = await readOnly();
    const twiceText = twiceModule.passages[0].text;
    const twiceSubmission = nextId();
    await db.query("select public.m5_record_transcript_receipt($1,'en',$2,$3,$4,$5)", [twice, transcriptSha256(twiceText), twiceModule.passages[0].id, twiceText, twiceSubmission]);
    const first = await rawReading(db, { user: twice, module: twiceModule, passage: twiceModule.passages[0], submission: twiceSubmission });
    const second = await rawReading(db, { user: twice, module: twiceModule, passage: twiceModule.passages[0], submission: twiceSubmission });
    const requester = await requesterOf(db, twice);
    assert.equal((await verifySavedReading(requester, first, deps)).verified, true);
    assert.deepEqual(await verifySavedReading(requester, second, deps), { verified: false, reason: "no_receipt" }, "single use");
    assert.deepEqual(await verifySavedReading(requester, first, deps), { verified: true, repeat: true }, "a save retry is idempotent");
    assert.equal(await totalXp(db, twice), 150);

    // Scores altered after scoring are refused even with a valid receipt.
    const tamper = await newUser(db);
    const tamperModule = await readOnly();
    const tamperText = tamperModule.passages[0].text;
    const tamperSubmission = nextId();
    await db.query("select public.m5_record_transcript_receipt($1,'en',$2,$3,$4,$5)", [tamper, transcriptSha256(tamperText), tamperModule.passages[0].id, tamperText, tamperSubmission]);
    const altered = await rawReading(db, { user: tamper, module: tamperModule, passage: tamperModule.passages[0], submission: tamperSubmission, errors: 4 });
    assert.deepEqual(await verifySavedReading(await requesterOf(db, tamper), altered, deps), { verified: false, reason: "inconsistent_score" });

    // Incomplete receipts cannot be created at all.
    for (const args of [[null, "x", nextId()], [nextId(), " ", nextId()], [nextId(), "x", null]]) {
      assert.equal(await scalar(db, "select public.m5_record_transcript_receipt($1,'en',$2,$3,$4,$5)", [twice, "a".repeat(64), ...args]), null);
    }
  });

  await t.test("the same-passage rule: trivial edits match, real rewrites do not", async () => {
    const same = (a, b) => scalar(db, "select public.m8_same_passage($1,$2)", [a, b]);
    const words = Array.from({ length: 40 }, (_, index) => `word${index}`);
    const text = words.join(" ");
    assert.equal(await same(text, text.toUpperCase().replace(/ /g, ",  ")), true, "case, spacing and punctuation");
    assert.equal(await same(text, [...words.slice(0, 39), "changed"].join(" ")), true, "one word of 40");
    assert.equal(await same(text, [...words, "added", "more"].join(" ")), true, "two words added");
    assert.equal(await same(text, [...words.slice(0, 36), "a", "b", "c", "d"].join(" ")), true, "10% changed in one place");
    const scattered = [...words];
    for (const at of [3, 13, 23, 33]) scattered[at] = `edit${at}`;
    assert.equal(await same(text, scattered.join(" ")), true, "10% changed, scattered: the worst case for word pairs");
    assert.equal(await same(text, [...words.slice(20), ...words.slice(0, 20)].join(" ")), true, "a sentence block moved");
    assert.equal(await same(text, [...words].reverse().join(" ")), false, "the same words in another order are a different text");
    const shuffled = words.filter((_, index) => index % 2 === 0).concat(words.filter((_, index) => index % 2 === 1));
    assert.equal(await same(text, shuffled.join(" ")), false, "same vocabulary, different sentences");
    assert.equal(await same(text, [...words.slice(0, 35), "a", "b", "c", "d", "e"].join(" ")), false, "beyond 10% is a new passage");
    assert.equal(await same(text, Array.from({ length: 40 }, (_, index) => `other${index}`).join(" ")), false, "a different story");
    assert.equal(await same("one two three four five", "one two three four six"), false, "under 10 words must match exactly");
    assert.equal(await same("one two three", "One, two: three!"), true);
    assert.equal(await same(null, text), false);

    // Realistic stories. Same theme and shared function words must stay different passages.
    const en = "Maria woke up early and went to the market with her mother. They bought fish, rice and fresh vegetables. On the way home it started to rain, so they waited under a big mango tree until the sky was clear.";
    const fil = "Maagang gumising si Maria at pumunta sa palengke kasama ang kanyang ina. Bumili sila ng isda, bigas at sariwang gulay. Habang pauwi ay umulan, kaya naghintay sila sa ilalim ng malaking puno ng mangga hanggang sa tumigil ang ulan.";
    assert.equal(await same(en, en.replace("Maria", "Ana")), true, "one name changed");
    assert.equal(await same(en, en.replace("big mango tree", "big acacia tree").replace("fish", "meat")), true, "two nouns changed");
    assert.equal(await same(en, en.replace(/[.,]/g, "").toLowerCase()), true, "punctuation and case only");
    assert.equal(await same(en, `${en.split(". ").slice(1).join(". ")}. ${en.split(". ")[0]}.`), true, "sentences reordered");
    assert.equal(await same(fil, fil.replace("Maria", "Ana")), true, "Filipino: one name changed");
    assert.equal(await same(fil, fil.replace(/[.,]/g, "").toUpperCase()), true, "Filipino: punctuation and case only");
    assert.equal(await same(en, "Pedro woke up early and went to the farm with his father. They planted corn, beans and sweet potatoes. On the way home it started to rain, so they waited under a small bamboo hut until the sky was clear."), false, "same frame, a different story");
    assert.equal(await same(en, "The market was busy that morning. Her mother bought rice and fish while Maria watched the rain fall on a big mango tree near the road home."), false, "same topic and vocabulary, written differently");
    assert.equal(await same(fil, "Si Maria at ang kanyang ina ay nasa bukid. Nagtanim sila ng gulay at palay habang mainit ang araw, at umuwi sila bago dumating ang malakas na ulan."), false, "Filipino: same theme, a different story");
    assert.equal(await same(en, fil), false, "a translation is a different reading");
    const part1 = en.split(". ")[0];
    assert.equal(await same(en, part1), false, "an excerpt is not the whole passage");
  });

  await t.test("the Diamond badge counts reading and comprehension XP, never login XP", async () => {
    const hasDiamond = async (user) => (await db.query("select 1 from public.m8_earned_badges where user_id = $1 and badge_id = 'diamond'", [user])).rows.length === 1;
    const grant = (user, type, amount) => db.query("select public.m8_grant_xp($1,$2,$3,$4)", [user, type, nextId(), amount]);
    const earn = async (user, xp) => { for (let left = xp; left > 0; left -= 100) await grant(user, "passage", Math.max(20, Math.min(100, left))); };

    // 1990 from reading plus logins reaches 2000 in the balance but not for Diamond.
    const user = await newUser(db);
    await earn(user, 1990);
    for (let day = 1; day <= 3; day += 1) await claim(db, user, `2026-12-0${day}T01:00:00Z`);
    assert.equal(await totalXp(db, user), 2020);
    assert.equal(await hasDiamond(user), false, "2020 balance, 1990 reading XP");
    await grant(user, "module_bonus", 50);
    assert.equal(await hasDiamond(user), true, "2040 reading XP");

    // Exactly 2000 from reading is enough, and a login never takes it away or adds a second.
    const exact = await newUser(db);
    await earn(exact, 2000);
    assert.equal(await hasDiamond(exact), true);
    await claim(db, exact, "2026-12-05T01:00:00Z");
    assert.equal(await scalar(db, "select count(*)::int from public.m8_earned_badges where user_id = $1 and badge_id = 'diamond'", [exact]), 1);

    // Login alone never reaches it.
    const onlyLogins = await newUser(db);
    await db.query("insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned) select $1, 'daily_login', gen_random_uuid(), 10 from generate_series(1, 300)", [onlyLogins]);
    await db.query("insert into public.m8_learner_progress(user_id, total_xp) values ($1, 3000)", [onlyLogins]);
    await claim(db, onlyLogins, "2026-12-06T01:00:00Z");
    assert.equal(await hasDiamond(onlyLogins), false);

    // Legacy XP counts, and a Diamond already earned stays.
    const legacy = await newUser(db);
    await db.query("insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned) select $1, 'module', gen_random_uuid(), 80 from generate_series(1, 25)", [legacy]);
    await db.query("insert into public.m8_learner_progress(user_id, total_xp) values ($1, 2000)", [legacy]);
    await grant(legacy, "passage", 20);
    assert.equal(await hasDiamond(legacy), true, "legacy module XP counts");
    const keeper = await newUser(db);
    await db.query("insert into public.m8_earned_badges(user_id, badge_id) values ($1, 'diamond')", [keeper]);
    await grant(keeper, "passage", 20);
    assert.equal(await hasDiamond(keeper), true, "an earned Diamond is never removed");

    // Other badges keep their rules.
    assert.deepEqual((await db.query("select id, description from public.m8_badges where id in ('diamond','first_read','bookworm') order by id")).rows,
      [{ id: "bookworm", description: "Complete 5 modules" }, { id: "diamond", description: "Reach 2000 XP" }, { id: "first_read", description: "Complete your first module" }]);
  });

  await t.test("the badge proposal and its rollback cannot overwrite F1", async () => {
    const fp = await md5(db, "public.m8_grant_xp(uuid,text,uuid,integer)");
    // Those two proposals are separate, unfinished work; they are checked wherever they exist.
    const badgeProposal = path.resolve(__dirname, "..", "..", "supabase", "proposed", "m8_badge_completions_PROPOSED.sql");
    if (fs.existsSync(badgeProposal)) {
      const filled = sqlFile("supabase/proposed/m8_badge_completions_PROPOSED.sql").replace("'__FILL_FROM_PREFLIGHT__'", `'${fp}'`);
      await assert.rejects(db.exec(filled), /M8 F1 is installed/);
      await db.exec("rollback");
      await assert.rejects(db.exec(sqlFile("supabase/proposed/m8_badge_completions_ROLLBACK_PROPOSED.sql")), /M8 F1 is installed/);
      await db.exec("rollback");
      assert.equal(await md5(db, "public.m8_grant_xp(uuid,text,uuid,integer)"), fp);
    }
    await assert.rejects(db.exec(sqlFile("supabase/proposed/m6_admin_practice_ROLLBACK_PROPOSED.sql")), /Stop|differs/);
    await db.exec("rollback");
  });

  await t.test("5-6. Multi-passage module: passage XP separately, +50 once when complete, one context only", async () => {
    const user = await newUser(db);
    const module = await newModule(db, { passages: [{}, {}, {}] });
    for (const [index, passage] of module.passages.entries()) {
      await readAloud(db, { user, module, passage, accuracy: 100 });
      await completeM6(db, { user, module, passage, correct: 10 });
      assert.equal((await xpEvents(db, user)).filter(([type]) => type === "passage").length, index + 1);
      assert.equal((await xpEvents(db, user)).some(([type]) => type === "module_bonus"), index === 2, "the bonus waits for the last passage");
    }
    assert.equal(await totalXp(db, user), 350);
    assert.equal(await scalar(db, "select completed_modules from public.m8_learner_progress where user_id = $1", [user]), 1);
    assert.deepEqual((await db.query("select badge_id from public.m8_earned_badges where user_id = $1", [user])).rows.map((row) => row.badge_id), ["first_read"]);

    // Mixed module: a read-aloud-only passage needs a reading, the other needs M6.
    const mixedUser = await newUser(db);
    const mixed = await newModule(db, { passages: [{ reviewed: false }, {}] });
    await readAloud(db, { user: mixedUser, module: mixed, passage: mixed.passages[0], accuracy: 100 });
    assert.deepEqual(await xpEvents(db, mixedUser), [reward(100)]);
    await readAloud(db, { user: mixedUser, module: mixed, passage: mixed.passages[1], accuracy: 100 });
    await completeM6(db, { user: mixedUser, module: mixed, passage: mixed.passages[1] });
    assert.deepEqual(await xpEvents(db, mixedUser), [reward(100), reward(100), BONUS]);

    // Passages finished in two different classroom assignments do not complete either one (M4 rule).
    const pupil = await newUser(db, "student");
    const shared = await newModule(db, { passages: [{}, {}], assign: true });
    const secondAssignment = nextId();
    const secondRoom = await newRoom(db, pupil);
    await db.query("insert into public.room_modules(id, room_id, module_id, assigned_by) values ($1,$2,$3,$4)", [secondAssignment, secondRoom, shared.id, USERS.teacher]);
    await readAloud(db, { user: pupil, module: shared, passage: shared.passages[0] });
    await completeM6(db, { user: pupil, module: shared, passage: shared.passages[0] });
    const other = { ...shared, room: secondRoom, assignment: secondAssignment };
    await readAloud(db, { user: pupil, module: other, passage: shared.passages[1] });
    await completeM6(db, { user: pupil, module: other, passage: shared.passages[1] });
    assert.deepEqual(await xpEvents(db, pupil), [reward(100), reward(100)], "no bonus across assignments");

    // An empty module cannot earn a bonus.
    assert.equal(await scalar(db, "select public.m8_try_module_bonus($1,$2,null,null)", [user, (await newModule(db, { passages: [] })).id]), false);
    // Nor a removed assignment.
    const removedUser = await newUser(db, "student");
    const removed = await newModule(db, { assign: true });
    await readAloud(db, { user: removedUser, module: removed, passage: removed.passages[0] });
    await db.query("update public.room_modules set removed_at = now() where id = $1", [removed.assignment]);
    await db.query("update public.oral_reading_attempts set room_id = room_id where user_id = $1", [removedUser]);
    assert.equal(await scalar(db, "select public.m8_try_module_bonus($1,$2,$3,$4)", [removedUser, removed.id, ROOM, removed.assignment]), false);
  });

  await t.test("7. Repeated recordings and reopened results cannot farm or raise XP", async () => {
    const user = await newUser(db);
    const module = await newModule(db);
    const passage = module.passages[0];
    await readAloud(db, { user, module, passage, accuracy: 50 });
    await readAloud(db, { user, module, passage, accuracy: 100 });
    const attempt = await completeM6(db, { user, module, passage, correct: 10 });
    assert.deepEqual(await xpEvents(db, user), [reward(80), BONUS], "the FIRST verified reading decides: 20 + 20 + 40");
    const total = await totalXp(db, user);
    await readAloud(db, { user, module, passage, accuracy: 100 });
    await db.exec("set role service_role");
    await db.query("select public.m6_apply_action($1,$2,null,'complete',null,null)", [attempt, user]);
    await db.exec("reset role");
    assert.equal(await totalXp(db, user), total);
    // The one-per-activity guard refuses a second assessment; direct re-evaluation adds nothing.
    await assert.rejects(completeM6(db, { user, module, passage }), /already has a comprehension assessment/);
    assert.equal(await scalar(db, "select public.m8_evaluate_rewards($1,null,null,$2,$3,null,null,$4)", [user, module.id, passage.id, passage.text]), false);
    assert.equal(await totalXp(db, user), total);
  });

  await t.test("8. Reassignment, another classroom and copied content cannot duplicate XP", async () => {
    // A material assigned to the same student again in another classroom: same reward identity.
    const pupil = await newUser(db, "student");
    const material = await newMaterial(db, { student: pupil });
    await readAloud(db, { user: pupil, material, accuracy: 100 });
    await completeM6(db, { user: pupil, material, correct: 10 });
    assert.deepEqual(await xpEvents(db, pupil), [reward(100)]);
    const otherRoom = await newRoom(db, pupil);
    const again = { ...material, room: otherRoom, activity: await assignMaterial(db, material.id, pupil, false, otherRoom) };
    await readAloud(db, { user: pupil, material: again, accuracy: 100 });
    await completeM6(db, { user: pupil, material: again, correct: 10 });
    assert.deepEqual(await xpEvents(db, pupil), [reward(100)], "no second award");

    // The same module assigned in a second classroom: one bonus and one passage award.
    const twice = await newUser(db, "student");
    const module = await newModule(db, { assign: true });
    await readAloud(db, { user: twice, module, passage: module.passages[0] });
    await completeM6(db, { user: twice, module, passage: module.passages[0] });
    const reassigned = nextId();
    const movedRoom = await newRoom(db, twice);
    await db.query("insert into public.room_modules(id, room_id, module_id, assigned_by) values ($1,$2,$3,$4)", [reassigned, movedRoom, module.id, USERS.teacher]);
    const moved = { ...module, room: movedRoom, assignment: reassigned };
    await readAloud(db, { user: twice, module: moved, passage: module.passages[0] });
    await completeM6(db, { user: twice, module: moved, passage: module.passages[0] });
    assert.deepEqual(await xpEvents(db, twice), [reward(100), BONUS]);

    // A revision copy has new IDs and the same text: no passage XP and no second bonus.
    const reader = await newUser(db);
    const original = await newModule(db);
    await readAloud(db, { user: reader, module: original, passage: original.passages[0] });
    await completeM6(db, { user: reader, module: original, passage: original.passages[0] });
    const revision = await newModule(db, { root: original.id, texts: [original.passages[0].text] });
    await readAloud(db, { user: reader, module: revision, passage: revision.passages[0] });
    await completeM6(db, { user: reader, module: revision, passage: revision.passages[0] });
    assert.deepEqual(await xpEvents(db, reader), [reward(100), BONUS]);

    // A separate module that only copies a rewarded one is not a new module: nothing at all.
    const copied = await newModule(db, { texts: [`  ${original.passages[0].text.toUpperCase()}! `] });
    await readAloud(db, { user: reader, module: copied, passage: copied.passages[0] });
    await completeM6(db, { user: reader, module: copied, passage: copied.passages[0] });
    assert.deepEqual(await xpEvents(db, reader), [reward(100), BONUS], "spacing, case and punctuation do not make a new passage");
    assert.equal(await scalar(db, "select completed_modules from public.m8_learner_progress where user_id = $1", [reader]), 1);

    // A trivial edit in a revision or in a separate module: no passage XP, no bonus.
    const oneWord = (text) => { const words = text.split(" "); words[0] = "changed"; return words.join(" "); };
    const edited = await newModule(db, { root: original.id, texts: [oneWord(original.passages[0].text)] });
    await readAloud(db, { user: reader, module: edited, passage: edited.passages[0] });
    await completeM6(db, { user: reader, module: edited, passage: edited.passages[0] });
    const elsewhere = await newModule(db, { texts: [oneWord(original.passages[0].text)] });
    await readAloud(db, { user: reader, module: elsewhere, passage: elsewhere.passages[0] });
    await completeM6(db, { user: reader, module: elsewhere, passage: elsewhere.passages[0] });
    assert.deepEqual(await xpEvents(db, reader), [reward(100), BONUS], "a one-word edit earns nothing");

    // A revision with a genuinely rewritten passage: that passage earns, the family's bonus does not repeat.
    const rewritten = await newModule(db, { root: original.id });
    await readAloud(db, { user: reader, module: rewritten, passage: rewritten.passages[0] });
    await completeM6(db, { user: reader, module: rewritten, passage: rewritten.passages[0] });
    assert.deepEqual(await xpEvents(db, reader), [reward(100), BONUS, reward(100)], "new reading is rewarded, without a second +50");

    // A genuinely different module earns both, even if it reuses one earlier passage.
    const overlap = await newModule(db, { passages: [{}, {}], texts: [original.passages[0].text] });
    for (const passage of overlap.passages) {
      await readAloud(db, { user: reader, module: overlap, passage });
      await completeM6(db, { user: reader, module: overlap, passage });
    }
    assert.deepEqual((await xpEvents(db, reader)).slice(-2), [reward(100), BONUS], "only the new passage earns, then its own bonus");
    assert.equal(await scalar(db, "select completed_modules from public.m8_learner_progress where user_id = $1", [reader]), 2);
  });

  await t.test("9-10. Students and Independent Learners are equal; Admins and Teachers earn nothing", async () => {
    const il = await newUser(db);
    const pupil = await newUser(db, "student");
    const shared = await newModule(db);
    const assigned = await newModule(db, { assign: true });
    await readAloud(db, { user: il, module: shared, passage: shared.passages[0], accuracy: 80 });
    await completeM6(db, { user: il, module: shared, passage: shared.passages[0], correct: 7 });
    await readAloud(db, { user: pupil, module: assigned, passage: assigned.passages[0], accuracy: 80 });
    await completeM6(db, { user: pupil, module: assigned, passage: assigned.passages[0], correct: 7 });
    assert.deepEqual(await xpEvents(db, il), await xpEvents(db, pupil));
    assert.deepEqual(await xpEvents(db, il), [reward(80), BONUS]);
    assert.equal((await db.query("select count(*)::int n from public.diagnostic_results where user_id = $1", [il])).rows[0].n, 0, "no diagnostic was needed: the level does not cap XP");

    // A Frustration-level Independent Learner on a Hard module: the old 30 XP cap is gone.
    const capped = await newUser(db);
    await verifiedDiagnostic(db, capped, "en", "Frustration", nextId());
    const hard = await newModule(db);
    await db.query("update public.modules set difficulty = 'Hard' where id = $1", [hard.id]);
    await readAloud(db, { user: capped, module: hard, passage: hard.passages[0] });
    await completeM6(db, { user: capped, module: hard, passage: hard.passages[0] });
    assert.deepEqual(await xpEvents(db, capped), [reward(100), BONUS]);
    assert.equal(await scalar(db, "select public.m2_trusted_reading_level($1,'en')", [capped]), "Frustration", "XP never changes the level");

    // Admin practice and any non-learner: reading verifies nothing and earns nothing.
    const adminModule = await newModule(db);
    const admin = await readAloud(db, { user: USERS.admin, module: adminModule, passage: adminModule.passages[0] });
    assert.deepEqual(admin.verification, { verified: false, reason: "not_learner" });
    await completeM6(db, { user: USERS.admin, module: adminModule, passage: adminModule.passages[0], oral: admin.attempt.id });
    assert.deepEqual(await xpEvents(db, USERS.admin), []);
    assert.deepEqual(await scalar(db, "select public.m8_claim_daily_login($1)", [USERS.admin]), { eligible: false, awarded: false });
    assert.deepEqual(await scalar(db, "select public.m8_claim_daily_login($1)", [USERS.teacher]), { eligible: false, awarded: false });
    assert.equal(await scalar(db, "select public.m5_record_transcript_receipt($1,'en',$2,$3,'x',$3)", [USERS.teacher, "a".repeat(64), nextId()]), null);
    assert.equal(await scalar(db, "select count(*)::int from public.m8_xp_events where user_id = any($1)", [[USERS.admin, USERS.teacher]]), 0);
  });

  await t.test("11. Daily login: 10 XP once per Philippine date, no reading day, no streak", async () => {
    const user = await newUser(db);
    assert.deepEqual(await claim(db, user, "2026-11-07T15:59:59Z"), { eligible: true, awarded: true, xp: 10, date: "2026-11-07" }, "23:59:59 in Manila");
    assert.equal((await claim(db, user, "2026-11-07T00:00:00Z")).awarded, false, "the morning of the same Manila date");
    assert.equal((await claim(db, user, "2026-11-07T15:59:59Z")).awarded, false, "a refresh");
    assert.deepEqual(await claim(db, user, "2026-11-07T16:00:00Z"), { eligible: true, awarded: true, xp: 10, date: "2026-11-08" }, "00:00:00 in Manila: a new day");
    assert.equal(await totalXp(db, user), 20);
    assert.equal(await scalar(db, "select count(*)::int from public.m8_reading_days where user_id = $1", [user]), 0);
    const progress = (await db.query("select current_streak, longest_streak, last_read_date, read_aloud_count, completed_modules from public.m8_learner_progress where user_id = $1", [user])).rows[0];
    assert.deepEqual(progress, { current_streak: 0, longest_streak: 0, last_read_date: null, read_aloud_count: 0, completed_modules: 0 });
    // The public entry point uses the database clock and takes no date.
    assert.equal(await scalar(db, "select count(*)::int from pg_proc where proname = 'm8_claim_daily_login' and pronargs = 1"), 1);
    const today = await newUser(db);
    assert.equal((await db.query("select public.m8_claim_daily_login($1) r", [today])).rows[0].r.awarded, true);
    assert.equal((await db.query("select public.m8_claim_daily_login($1) r", [today])).rows[0].r.awarded, false);
  });

  await t.test("12. Simultaneous login and completion requests award once (outcome; one connection)", async () => {
    const user = await newUser(db);
    const logins = await Promise.all(Array.from({ length: 8 }, () => claim(db, user, "2026-12-01T01:00:00Z")));
    assert.equal(logins.filter((row) => row.awarded).length, 1);
    assert.equal(await totalXp(db, user), 10);

    const reader = await newUser(db);
    const module = await newModule(db, { passages: [{ reviewed: false }] });
    const passage = module.passages[0];
    await readAloud(db, { user: reader, module, passage, accuracy: 100 });
    await Promise.all(Array.from({ length: 6 }, () => db.query("select public.m8_evaluate_rewards($1,null,null,$2,$3,null,null,$4)", [reader, module.id, passage.id, passage.text])));
    assert.deepEqual(await xpEvents(db, reader), [reward(100), BONUS]);
    await assert.rejects(db.query("insert into public.m8_passage_rewards(user_id,source_kind,source_id,content_fingerprint,content_text,reading_attempt_id,xp_awarded) values ($1,'passage',$2,'x','x',$3,50)",
      [reader, passage.id, nextId()]), /m8_passage_rewards_user_id_source_kind_source_id_key/, "the database refuses a duplicate source");
    await assert.rejects(db.query("insert into public.m8_passage_rewards(user_id,source_kind,source_id,content_fingerprint,content_text,reading_attempt_id,xp_awarded) select user_id,'passage',$2,content_fingerprint,'x',$3,50 from public.m8_passage_rewards where user_id = $1",
      [reader, nextId(), nextId()]), /m8_passage_rewards_user_id_content_fingerprint_key/, "and duplicate content");
  });

  await t.test("13. Historical completions stay as they are and earn nothing new", async () => {
    const legacyTotal = await totalXp(db, history);
    assert.ok(legacyTotal > 0);
    const passage = historicModule.passages[0];
    // New verified readings of a passage whose M6 finished before the cutover.
    await readAloud(db, { user: history, module: historicModule, passage, accuracy: 100 });
    assert.equal(await totalXp(db, history), legacyTotal, "no retroactive passage XP or bonus");
    // A read-aloud-only passage read before the cutover.
    await readAloud(db, { user: history, module: historicReadOnlyModule, passage: historicReadOnlyModule.passages[0], accuracy: 100 });
    assert.equal(await totalXp(db, history), legacyTotal);
    // The same material reassigned after earning the old 60 XP.
    const pupilTotal = await totalXp(db, student);
    assert.equal(pupilTotal, 60);
    const historicRoom = await newRoom(db, student);
    const again = { ...historicMaterial, room: historicRoom, activity: await assignMaterial(db, historicMaterial.id, student, false, historicRoom) };
    await readAloud(db, { user: student, material: again, accuracy: 100 });
    await completeM6(db, { user: student, material: again, correct: 10 });
    assert.equal(await totalXp(db, student), 60);
    assert.equal(await scalar(db, "select status from public.m6_comprehension_attempts where id = $1", [historicM6]), "completed");
    // The same text in a new module.
    const copy = await newModule(db, { texts: [passage.text] });
    await readAloud(db, { user: history, module: copy, passage: copy.passages[0] });
    await completeM6(db, { user: history, module: copy, passage: copy.passages[0] });
    assert.deepEqual((await xpEvents(db, history)).filter(([type]) => type === "passage"), [], "old content does not earn passage XP again");

    // A module part-finished before the cutover: only the new passage earns. The bonus needs verified
    // evidence for every passage, so it waits for a verified reading of the older passage, which itself
    // earns no XP. The module is not counted twice in completed_modules.
    const counted = await scalar(db, "select completed_modules from public.m8_learner_progress where user_id = $1", [history]);
    const remaining = multiLegacyModule.passages[1];
    await readAloud(db, { user: history, module: multiLegacyModule, passage: remaining, accuracy: 100 });
    await completeM6(db, { user: history, module: multiLegacyModule, passage: remaining, correct: 10 });
    assert.deepEqual((await xpEvents(db, history)).slice(-1), [reward(100)], "no bonus yet: the older passage has no verified reading");
    await readAloud(db, { user: history, module: multiLegacyModule, passage: multiLegacyModule.passages[0], accuracy: 100 });
    assert.deepEqual((await xpEvents(db, history)).slice(-2), [reward(100), BONUS], "the old passage earned nothing itself");
    assert.equal(await scalar(db, "select completed_modules from public.m8_learner_progress where user_id = $1", [history]), counted, "already counted when it earned legacy module XP");
    assert.ok(before.xp.every((row) => row.created_at), "legacy rows untouched");
    const legacyNow = (await db.query("select id, xp_earned from public.m8_xp_events where source_type in ('module','assignment') and created_at < (select f1_cutover_at from public.m8_reward_settings) order by id")).rows;
    assert.deepEqual(legacyNow, before.xp.map(({ id: rowId, xp_earned }) => ({ id: rowId, xp_earned })).sort((a, b) => a.id.localeCompare(b.id)));
  });

  await t.test("14. Clients can read their own XP as before and reach nothing new", async () => {
    const user = await newUser(db);
    const asClient = async (sql) => {
      await db.exec("begin");
      try {
        await db.exec(`set local role authenticated; set local request.jwt.claims = '{"sub":"${user}"}'`);
        return await db.query(sql);
      } finally { await db.exec("rollback"); }
    };
    for (const table of ["m8_reward_settings", "m5_transcript_receipts", "m5_verified_readings", "m8_passage_rewards", "m8_daily_logins"]) {
      await assert.rejects(asClient(`select * from public.${table}`), { code: "42501" }, table);
      await assert.rejects(asClient(`delete from public.${table}`), { code: "42501" }, table);
      assert.equal(await scalar(db, "select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`]), true);
    }
    for (const call of [
      `public.m8_grant_xp('${user}','passage','${user}',100)`, `public.m8_claim_daily_login('${user}')`,
      `public.m8_claim_daily_login_at('${user}',now())`, `public.m5_record_transcript_receipt('${user}','en','${"a".repeat(64)}','${user}','x','${user}')`,
      `public.m5_verify_reading('${user}','${user}','${"a".repeat(64)}')`, `public.m8_evaluate_rewards('${user}',null,null,null,null,null,null,null)`,
      `public.m8_award_passage('${user}',null,null,null,null,null)`, `public.m8_try_module_bonus('${user}','${user}',null,null)`,
    ]) {
      await assert.rejects(asClient(`select ${call}`), { code: "42501" }, call);
    }
    await assert.rejects(asClient(`insert into public.m8_xp_events(user_id,source_type,source_id,xp_earned) values ('${user}','daily_login','${user}',10)`), { code: "42501" });
    await assert.rejects(asClient(`update public.m8_learner_progress set total_xp = 9999`), { code: "42501" });
    assert.deepEqual((await asClient("select count(*)::int n from public.m8_xp_events")).rows, [{ n: 0 }], "own rows only");
    // Grants refuse anything outside the new amounts.
    for (const [type, amount] of [["passage", 19], ["passage", 101], ["module_bonus", 49], ["daily_login", 11], ["module", 20], ["assignment", 100], ["other", 30]]) {
      await assert.rejects(db.query("select public.m8_grant_xp($1,$2,$3,$4)", [user, type, nextId(), amount]), /Invalid XP grant/, `${type} ${amount}`);
    }
    await assert.rejects(db.query("insert into public.m8_xp_events(user_id,source_type,source_id,xp_earned) values ($1,'passage',$2,101)", [user, nextId()]), /m8_xp_events_xp_earned_check/);
    await assert.rejects(db.query("insert into public.m8_xp_events(user_id,source_type,source_id,xp_earned) values ($1,'other',$2,50)", [user, nextId()]), /m8_xp_events_source_type_check/);
  });

  await t.test("15. M5, M6 and M7 still work: attempts, reading days, Brave Reader, risk queue, access checks", async () => {
    const user = await newUser(db);
    const module = await newModule(db);
    const passage = module.passages[0];
    const forged = await readAloud(db, { user, module, passage, receipt: false });
    assert.ok(forged.attempt.id, "M5 saves without any receipt");
    assert.equal(await scalar(db, "select read_aloud_count from public.m8_learner_progress where user_id = $1", [user]), 1);
    assert.equal(await scalar(db, "select count(*)::int from public.m8_reading_days where user_id = $1", [user]), 1);
    await completeM6(db, { user, module, passage, correct: 5 });
    assert.equal(await scalar(db, "select count(*)::int from public.m7_risk_queue where id = $1", [user]), 1, "the M7 queue trigger still fires");
    for (let index = 0; index < 9; index += 1) await readAloud(db, { user, module, passage, receipt: false });
    assert.ok((await db.query("select badge_id from public.m8_earned_badges where user_id = $1", [user])).rows.some((row) => row.badge_id === "brave_reader"));

    // Revoked access still rejects a completion. Rewards never loosen M6 access.
    const pupil = await newUser(db, "student");
    const denied = await newModule(db, { assign: true });
    await db.query("delete from public.enrollments where student_id = $1", [pupil]);
    await assert.rejects(completeM6(db, { user: pupil, module: denied, passage: denied.passages[0] }), { code: "42501" });

    // A malformed saved question does not block the completion; it earns no XP.
    const broken = await newUser(db);
    const brokenModule = await newModule(db);
    await readAloud(db, { user: broken, module: brokenModule, passage: brokenModule.passages[0] });
    const question = nextId();
    await completeM6(db, { user: broken, module: brokenModule, passage: brokenModule.passages[0], correct: 1, total: 1,
      snapshot: [{ id: question, type: "literal", questionText: "Q?", options: ["a", "b", "c", "d"], correctOptionIndex: "not-a-number", scaffoldingHint: "Read." }] });
    assert.equal(await scalar(db, "select status from public.m6_comprehension_attempts where user_id = $1", [broken]), "completed");
    assert.deepEqual((await xpEvents(db, broken)).filter(([type]) => type === "passage"), []);

  });

  await t.test("leaderboards rank reading and comprehension XP; daily login counts only in the personal balance", async () => {
    const as = (user) => db.exec(`select set_config('request.jwt.claims', '{"sub":"${user}"}', false)`);
    const xpOf = (rows, user) => Number(rows.find((entry) => entry.user_id === user).xp);
    const reader = await newUser(db);
    const loginOnly = await newUser(db);
    const m = await newModule(db);
    await readAloud(db, { user: reader, module: m, passage: m.passages[0] });
    await completeM6(db, { user: reader, module: m, passage: m.passages[0] });
    await db.query("select public.m8_claim_daily_login($1)", [reader]);
    await db.query("select public.m8_claim_daily_login($1)", [loginOnly]);
    assert.equal(await totalXp(db, reader), 160, "personal balance includes the login");
    assert.equal(await totalXp(db, loginOnly), 10);
    await as(reader);
    for (const period of ["weekly", "all_time"]) {
      const rows = (await db.query("select * from public.m8_independent_leaderboard($1)", [period])).rows;
      assert.equal(xpOf(rows, reader), 150, period);
      if (rows.some((entry) => entry.user_id === loginOnly)) assert.equal(xpOf(rows, loginOnly), 0, period);
    }

    const pupil = await newUser(db, "student");
    const classmate = await newUser(db, "student");
    const assigned = await newModule(db, { assign: true });
    await readAloud(db, { user: pupil, module: assigned, passage: assigned.passages[0] });
    await completeM6(db, { user: pupil, module: assigned, passage: assigned.passages[0] });
    await db.query("select public.m8_claim_daily_login($1)", [pupil]);
    await db.query("select public.m8_claim_daily_login($1)", [classmate]);
    await as(pupil);
    for (const rows of [(await db.query("select * from public.m8_classroom_leaderboard($1)", [ROOM])).rows, (await db.query("select * from public.m8_weekly_leaderboard()")).rows]) {
      assert.equal(xpOf(rows, pupil), 150);
      assert.equal(xpOf(rows, classmate), 0, "logging in does not raise a rank");
    }

    // Legacy XP still ranks.
    await as(history);
    const legacy = (await db.query("select * from public.m8_independent_leaderboard('all_time')")).rows.find((entry) => entry.user_id === history);
    assert.ok(Number(legacy.xp) > 0);
    await db.exec("select set_config('request.jwt.claims', '', false)");
  });

  await t.test("16. English first: Filipino keeps its deployed rewards, verified readings, and no new XP", async () => {
    const fil = "Ang isang bata ay naglakad sa malawak na bukid";
    const passageRewards = async (user) => scalar(db, "select count(*)::int from public.m8_passage_rewards where user_id = $1", [user]);

    // Independent Learner: the level-capped tier, once per module; no passage XP and no +50.
    const il = await newUser(db);
    await verifiedDiagnostic(db, il, "fil", "Frustration", nextId());
    const module = await newModule(db, { language: "fil", passages: [{}, {}], texts: [fil] });
    const { verification } = await readAloud(db, { user: il, module, passage: module.passages[0], transcript: "Ang isang bata ay naglakad, sa malawak na bukid." });
    assert.equal(verification.verified, true, "Filipino readings are still verified");
    assert.equal(await scalar(db, "select language from public.m5_verified_readings where user_id = $1", [il]), "fil");
    assert.deepEqual(await xpEvents(db, il), [], "a reading alone earns nothing, as today");
    await completeM6(db, { user: il, module, passage: module.passages[0], correct: 10 });
    assert.deepEqual(await xpEvents(db, il), [["module", 30]], "the deployed rule: Frustration level, 30 XP");
    await readAloud(db, { user: il, module, passage: module.passages[1] });
    await completeM6(db, { user: il, module, passage: module.passages[1], correct: 10 });
    assert.deepEqual(await xpEvents(db, il), [["module", 30]], "once per module, and no +50 when the module is complete");
    assert.equal(await passageRewards(il), 0);
    assert.equal(await scalar(db, "select completed_modules from public.m8_learner_progress where user_id = $1", [il]), 1, "the deployed counter");
    assert.deepEqual((await db.query("select badge_id from public.m8_earned_badges where user_id = $1", [il])).rows.map((r) => r.badge_id), ["first_read"], "the deployed badge");
    assert.equal(await scalar(db, "select count(*)::int from public.m8_reading_days where user_id = $1", [il]), 1);

    // Tiers follow the deployed cap, and no trusted level still means no XP.
    const instructional = await newUser(db);
    await verifiedDiagnostic(db, instructional, "fil", "Instructional", nextId());
    const hard = await newModule(db, { language: "fil" });
    await db.query("update public.modules set difficulty = 'Hard' where id = $1", [hard.id]);
    await readAloud(db, { user: instructional, module: hard, passage: hard.passages[0] });
    await completeM6(db, { user: instructional, module: hard, passage: hard.passages[0] });
    assert.deepEqual(await xpEvents(db, instructional), [["module", 50]]);
    const noLevel = await newUser(db);
    await readAloud(db, { user: noLevel, module: hard, passage: hard.passages[0] });
    await completeM6(db, { user: noLevel, module: hard, passage: hard.passages[0] });
    assert.deepEqual(await xpEvents(db, noLevel), []);

    // Student in a classroom: the full tier; assigned material: the fixed 60.
    const pupil = await newUser(db, "student");
    const assigned = await newModule(db, { language: "fil", assign: true });
    await readAloud(db, { user: pupil, module: assigned, passage: assigned.passages[0] });
    await completeM6(db, { user: pupil, module: assigned, passage: assigned.passages[0] });
    assert.deepEqual(await xpEvents(db, pupil), [["module", 30]]);
    const reader = await newUser(db, "student");
    const material = await newMaterial(db, { student: reader, language: "fil" });
    await readAloud(db, { user: reader, material, accuracy: 50 });
    await completeM6(db, { user: reader, material, correct: 1 });
    assert.deepEqual(await xpEvents(db, reader), [["assignment", 60]], "60 regardless of scores, as deployed");
    const otherRoom = await newRoom(db, reader);
    const another = await newMaterial(db, { student: reader, language: "fil" });
    const again = { ...another, room: otherRoom, activity: await assignMaterial(db, another.id, reader, false, otherRoom) };
    await readAloud(db, { user: reader, material: again });
    await completeM6(db, { user: reader, material: again });
    assert.deepEqual(await xpEvents(db, reader), [["assignment", 60], ["assignment", 60]], "each assigned activity, as deployed");

    // Read-aloud-only earns nothing in Filipino, as today. Admins earn nothing either.
    const aloud = await newUser(db, "student");
    const onlyAloud = await newMaterial(db, { student: aloud, language: "fil", readAloudOnly: true });
    assert.equal((await readAloud(db, { user: aloud, material: onlyAloud })).verification.verified, true);
    assert.deepEqual(await xpEvents(db, aloud), []);
    const passageOnly = await newUser(db);
    const aloudModule = await newModule(db, { language: "fil", passages: [{ reviewed: false }] });
    await readAloud(db, { user: passageOnly, module: aloudModule, passage: aloudModule.passages[0] });
    assert.deepEqual(await xpEvents(db, passageOnly), []);

    // The new path cannot be reached directly, and the login still works in any language.
    assert.equal(await scalar(db, "select public.m8_evaluate_rewards($1,null,null,$2,$3,null,null,$4)", [il, module.id, module.passages[0].id, fil]), false);
    assert.equal((await db.query("select public.m8_claim_daily_login($1) r", [il])).rows[0].r.awarded, true);
  });

  await t.test("language comes from the source: it cannot be spoofed, misfiled or used to collect both rewards", async () => {
    const { transcriptSha256, verifySavedReading } = require("../services/readingVerification");
    const deps = { getSupabaseAdmin: () => rpcClient(db), log: () => {} };

    // An M6 attempt labelled English on a Filipino module is refused at completion.
    const spoof = await newUser(db);
    await verifiedDiagnostic(db, spoof, "fil", "Independent", nextId());
    const fil = await newModule(db, { language: "fil" });
    const passage = fil.passages[0];
    await assert.rejects(completeM6(db, { user: spoof, module: fil, passage: { ...passage, language: "en" } }), /language does not match/i);
    assert.deepEqual(await xpEvents(db, spoof), []);

    // A saved reading filed as English on a Filipino module does not verify, even with a valid receipt.
    const reader = await newUser(db);
    const submission = nextId();
    await db.query("select public.m5_record_transcript_receipt($1,'en',$2,$3,$4,$5)", [reader, transcriptSha256(passage.text), passage.id, passage.text, submission]);
    const metrics = passage.text.split(" ").map((word) => ({ expected: word, actual: word, type: "match" }));
    const misfiled = (await db.query(`insert into public.oral_reading_attempts(user_id, module_id, passage_id, passage_snapshot, transcript, language_snapshot,
        scoring_version, expected_word_count, detected_error_count, pronunciation_accuracy, word_metrics, submission_id)
      values ($1,$2,$3,$4,$4,'en',2,$5,0,100,$6,$7) returning *`, [reader, fil.id, passage.id, passage.text, metrics.length, JSON.stringify(metrics), submission])).rows[0];
    assert.deepEqual(await verifySavedReading(await requesterOf(db, reader), misfiled, deps), { verified: false, reason: "language_mismatch" });
    assert.equal((await db.query("select public.m5_verify_reading($1,$2,$3) r", [misfiled.id, reader, transcriptSha256(passage.text)])).rows[0].r.verified, false);

    // Filipino reward first, then the same text under an English module: no new XP.
    const both = await newUser(db, "student");
    const assignedFil = await newModule(db, { language: "fil", assign: true });
    await readAloud(db, { user: both, module: assignedFil, passage: assignedFil.passages[0] });
    await completeM6(db, { user: both, module: assignedFil, passage: assignedFil.passages[0] });
    const sameTextEn = await newModule(db, { language: "en", assign: true, texts: [assignedFil.passages[0].text] });
    await readAloud(db, { user: both, module: sameTextEn, passage: sameTextEn.passages[0] });
    await completeM6(db, { user: both, module: sameTextEn, passage: sameTextEn.passages[0] });
    assert.deepEqual((await xpEvents(db, both)).filter(([type]) => type === "module" || type === "passage"), [["module", 30]], "not both");

    // English reward first, then the same text under a Filipino module: no old XP.
    const reverse = await newUser(db, "student");
    const assignedEn = await newModule(db, { language: "en", assign: true });
    await readAloud(db, { user: reverse, module: assignedEn, passage: assignedEn.passages[0] });
    await completeM6(db, { user: reverse, module: assignedEn, passage: assignedEn.passages[0] });
    const sameTextFil = await newModule(db, { language: "fil", assign: true, texts: [assignedEn.passages[0].text] });
    await readAloud(db, { user: reverse, module: sameTextFil, passage: sameTextFil.passages[0] });
    await completeM6(db, { user: reverse, module: sameTextFil, passage: sameTextFil.passages[0] });
    assert.deepEqual(await xpEvents(db, reverse), [["passage", 100], ["module_bonus", 50]], "not both");

    // Each completion on one path only, across every learner in this database.
    assert.deepEqual((await db.query(`select count(*)::int n from public.m8_passage_rewards pr join public.m8_xp_events x on x.user_id = pr.user_id
      and x.source_type = 'assignment' join public.reading_activity_assignments ra on ra.id = x.source_id and ra.material_id = pr.source_id
      where pr.source_kind = 'material'`)).rows, [{ n: 0 }]);
    assert.equal(await scalar(db, `select count(*)::int from public.m8_passage_rewards pr where public.m8_activity_language(
      case when pr.source_kind = 'material' then pr.source_id end, pr.module_id) is distinct from 'en'`), 0, "no Filipino passage reward exists");
    // An unknown language earns nothing new.
    assert.equal(await scalar(db, "select public.m8_performance_language(null)"), false);
    assert.equal(await scalar(db, "select public.m8_performance_language('Klingon')"), false);
  });

  await t.test("17. One award path: no double trigger, no score changed by a reward", async () => {
    const triggers = (await db.query(`select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'public.m6_comprehension_attempts'::regclass and not t.tgisinternal and p.proname like 'm8%'`)).rows;
    assert.deepEqual(triggers, [{ tgname: "m8_m6_completed", proname: "m8_on_comprehension_completed" }]);
    const user = await newUser(db);
    const module = await newModule(db);
    const passage = module.passages[0];
    const { attempt } = await readAloud(db, { user, module, passage, accuracy: 80 });
    const oralBefore = (await db.query("select pronunciation_accuracy, detected_error_count, word_metrics from public.oral_reading_attempts where id = $1", [attempt.id])).rows;
    const m6 = await completeM6(db, { user, module, passage, correct: 7 });
    const answers = (await db.query("select first_option_index, first_answer_correct from public.m6_comprehension_responses where attempt_id = $1 order by question_id", [m6])).rows;
    assert.deepEqual((await db.query("select pronunciation_accuracy, detected_error_count, word_metrics from public.oral_reading_attempts where id = $1", [attempt.id])).rows, oralBefore);
    assert.equal(answers.filter((row) => row.first_answer_correct).length, 7);
    assert.equal(await scalar(db, "select count(*)::int from public.m8_xp_events where user_id = $1 and source_type = 'passage'", [user]), 1);
    assert.equal(await scalar(db, "select count(*)::int from public.m8_passage_rewards where user_id = $1", [user]), 1);
    // Nothing here touched the diagnostic rows.
    assert.deepEqual((await db.query("select id, reading_level, verification_status from public.diagnostic_results where id = any($1) order by id", [before.diagnostics.map((row) => row.id)])).rows, before.diagnostics);
  });
});

test("M8 F1 rollback restores the exact definitions while no new-rule XP exists, and refuses after", { timeout: 300000 }, async () => {
  const db = await createM8F1BaseDatabase();
  try {
    await db.exec(sqlFile(PROPOSED));
    await db.exec(sqlFile(ROLLBACK));
    for (const [fn, fp] of Object.entries(REPLACED)) assert.equal(await md5(db, fn), fp, fn);
    assert.equal((await db.query("select to_regclass('public.m8_passage_rewards') is null gone")).rows[0].gone, true);
    await assert.rejects(db.exec(sqlFile(ROLLBACK)), /nothing to roll back/);
    await db.exec("rollback");
    // No grant is added: existing access is kept here, and a closed function would stay closed.
    for (const fn of ["public.m8_weekly_leaderboard()", "public.m8_classroom_leaderboard(uuid)", "public.m8_independent_leaderboard(text)"]) {
      assert.equal(await scalar(db, `select has_function_privilege('authenticated','${fn}','EXECUTE')`), true, fn);
    }
    assert.doesNotMatch(sqlFile(ROLLBACK), /grant execute on function public\.m8_\w*leaderboard/i);

    await db.exec(sqlFile(PROPOSED));
    await db.exec("revoke execute on function public.m8_independent_leaderboard(text) from authenticated");
    await db.exec(sqlFile(ROLLBACK));
    assert.equal(await scalar(db, "select has_function_privilege('authenticated','public.m8_independent_leaderboard(text)','EXECUTE')"), false, "a closed function stays closed");
    await db.exec("grant execute on function public.m8_independent_leaderboard(text) to authenticated");

    await db.exec(sqlFile(PROPOSED));
    const user = await newUser(db);
    await db.query("select public.m8_claim_daily_login($1)", [user]);
    await assert.rejects(db.exec(sqlFile(ROLLBACK)), /new-rule XP exists/);
    await db.exec("rollback");
    assert.equal(await totalXp(db, user), 10);
  } finally {
    await db.close();
  }
});
