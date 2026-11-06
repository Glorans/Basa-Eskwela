// The M8 F1 test database: real PostgreSQL 17 (PGlite, in memory) in the state ReadFlow-Staging has
// today (C9, Admin practice, reward eligibility, one assessment per activity), with the real M5
// scoring and verification services running against it. No network.
const { sqlFile, id } = require("./m5M6SecurityDatabase");
const { createM8TrustDatabase, USERS, ROOM, PATH } = require("./m8TrustDatabase");
const { buildAttemptInsert } = require("../../services/oralReadingAttemptService");
const { recordTranscriptReceipt, verifySavedReading } = require("../../services/readingVerification");

let counter = 0;
const nextId = () => id(500000 + ++counter);

async function createM8F1BaseDatabase() {
  const db = await createM8TrustDatabase();
  await db.exec(sqlFile("supabase/migrations/20261026_m8_trusted_xp.sql"));
  // Columns the staging order adds in files this fixture does not replay. Same names and types.
  await db.exec(`
    alter table public.oral_reading_attempts
      add column module_id uuid, add column passage_id uuid, add column material_id uuid, add column activity_assignment_id uuid,
      add column room_id uuid, add column assignment_id uuid, add column submission_id uuid,
      add column scoring_version integer not null default 2, add column passage_snapshot text, add column transcript text,
      add column duration_seconds numeric, add column reading_speed_wpm numeric, add column pronunciation_accuracy numeric,
      add column expected_word_count integer, add column detected_error_count integer, add column word_metrics jsonb,
      add column stt_confidence numeric, add column passage_title_snapshot text, add column module_title_snapshot text,
      add column language_snapshot text, add column created_at timestamptz not null default now();
    -- As on Staging (supabase/m5_selected_passage_security.sql): the backend alone writes readings.
    revoke insert, update, delete, truncate on public.oral_reading_attempts from anon, authenticated;
    alter table public.modules add column revision_of uuid, add column revision_root uuid, add column revision_number integer;
    alter table public.room_modules add column if not exists removed_at timestamptz, add column if not exists targeting_mode text;
    alter table public.reading_activity_assignments
      add column if not exists read_aloud_only boolean not null default false, add column if not exists removed_at timestamptz;
    alter table public.module_passages add column title text, add column passage_text text, add column display_order integer not null default 1;
    create table public.comprehension_questions(id uuid primary key default gen_random_uuid(), module_id uuid, material_id uuid,
      passage_id uuid, review_status text not null default 'reviewed');
  `);
  await db.exec(sqlFile("supabase/proposed/m6_admin_practice_PROPOSED.sql"));
  await db.exec(sqlFile("supabase/proposed/m8_reward_eligibility_PROPOSED.sql"));
  await db.exec(sqlFile("supabase/proposed/m6_one_assessment_per_activity_PROPOSED.sql"));
  await db.exec(sqlFile("supabase/proposed/m8_classroom_leaderboard_PROPOSED.sql"));
  return db;
}

const WORDS = "river forest morning garden window silver market lantern harvest village".split(" ");
/** Ten distinct words, different for each seed, so accuracy moves in steps of 10%. */
function storyText(seed) {
  const tail = String(seed).split("").map((digit) => "abcdefghij"[Number(digit)]).join("");
  return WORDS.map((word) => `${word}${tail}`).join(" ");
}
function transcriptFor(text, accuracy) {
  const words = text.split(" ");
  return words.slice(0, Math.round((words.length * accuracy) / 100)).join(" ");
}

async function newUser(db, role = "general_user") {
  const user = nextId();
  await db.query("insert into auth.users(id) values ($1)", [user]);
  await db.query("insert into public.profiles(id, role) values ($1, $2)", [user, role]);
  if (role === "student") await db.query("insert into public.enrollments(room_id, student_id) values ($1, $2)", [ROOM, user]);
  return user;
}

/** A published module with its passages. Pass `reviewed: false` for a read-aloud-only passage. */
async function newModule(db, { language = "en", passages = [{}], assign = false, root = null, texts = [] } = {}) {
  const module = nextId();
  await db.query(`insert into public.modules(id, path_id, title, difficulty, status, created_by, revision_of, revision_root, revision_number)
    values ($1, $2, 'Module', 'Easy', 'published', $3, $4, $4, case when $4::uuid is null then null else 2 end)`,
  [module, PATH[language], USERS.admin, root]);
  const rows = [];
  for (const [index, passage] of passages.entries()) {
    const passageId = nextId();
    const text = texts[index] ?? storyText(++counter);
    await db.query("insert into public.module_passages(id, module_id, title, passage_text, display_order) values ($1,$2,'Passage',$3,$4)",
      [passageId, module, text, index + 1]);
    if (passage.reviewed !== false) await db.query("insert into public.comprehension_questions(module_id, passage_id) values ($1,$2)", [module, passageId]);
    rows.push({ id: passageId, text, language });
  }
  let assignment = null;
  if (assign) {
    assignment = nextId();
    await db.query("insert into public.room_modules(id, room_id, module_id, assigned_by) values ($1,$2,$3,$4)", [assignment, ROOM, module, USERS.teacher]);
  }
  return { id: module, passages: rows, assignment, room: assign ? ROOM : null, language };
}

async function newMaterial(db, { language = "en", readAloudOnly = false, text = storyText(++counter), student }) {
  const material = nextId();
  await db.query("insert into public.uploaded_materials values ($1,$2,$3,'completed',$4)", [material, USERS.teacher, language, text]);
  const activity = await assignMaterial(db, material, student, readAloudOnly);
  return { id: material, activity, text, language, room: ROOM };
}
async function assignMaterial(db, material, student, readAloudOnly = false, room = ROOM) {
  const activity = nextId();
  await db.query(`insert into public.reading_activity_assignments(id, room_id, material_id, student_id, assigned_by, read_aloud_only)
    values ($1,$2,$3,$4,$5,$6)`, [activity, room, material, student, USERS.teacher, readAloudOnly]);
  return activity;
}
/** Another classroom of the same teacher, with this student enrolled. One student can hold one
 *  assignment of a material per classroom, so reassigning a material means another classroom. */
async function newRoom(db, student) {
  const room = nextId();
  await db.query("insert into public.rooms(id, teacher_id, room_name, room_code) values ($1,$2,'Room',$3)", [room, USERS.teacher, room.slice(-8)]);
  await db.query("insert into public.enrollments(room_id, student_id) values ($1,$2)", [room, student]);
  return room;
}

/** The backend's Supabase client, reduced to the RPC calls these services make, as service_role. */
function rpcClient(db) {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      await db.exec("set role service_role");
      try {
        const sql = `select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(", ")}) as result`;
        const { rows } = await db.query(sql, keys.map((key) => args[key]));
        return { data: rows[0].result, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      } finally {
        await db.exec("reset role");
      }
    },
  };
}
const requesterOf = async (db, user) => ({
  user: { id: user },
  profile: { role: (await db.query("select role from public.profiles where id = $1", [user])).rows[0].role },
});

/**
 * A learner's read-aloud through the real backend steps: the speech endpoint's receipt for what
 * Azure returned, the real scoring (buildAttemptInsert), the save, then verification.
 * `receipt: false` models a forged transcript sent straight to the save API.
 */
async function readAloud(db, { user, module = null, passage = null, material = null, accuracy = 100, transcript, receipt = true, receiptOverride = {} }) {
  const text = passage?.text ?? material.text;
  const language = passage?.language ?? material.language;
  const spoken = transcript ?? transcriptFor(text, accuracy);
  const requester = await requesterOf(db, user);
  const submissionId = nextId();
  const source = { id: module?.id ?? null, materialId: material?.id ?? null, passageId: passage?.id ?? null, passage: text, language };
  const deps = { getSupabaseAdmin: () => rpcClient(db), log: () => {}, loadReadingSource: async () => ({ ...source, ...receiptOverride.source }) };
  if (receipt) {
    await recordTranscriptReceipt(receiptOverride.requester ?? requester, {
      language: receiptOverride.language ?? language,
      query: { submissionId: receiptOverride.submissionId ?? submissionId, ...(material ? { materialId: material.id } : { moduleId: module.id }) },
    }, spoken, deps);
  }
  const payload = buildAttemptInsert(requester, {
    id: module?.id ?? null, title: "Module", passage: text, passageId: passage?.id ?? null, passageTitle: "Passage",
    roomId: module?.room ?? material?.room ?? null, assignmentId: module?.assignment ?? null, language,
    ...(material ? { materialId: material.id, activityAssignmentId: material.activity } : {}),
  }, { transcript: spoken, durationSeconds: 30, submissionId });
  const keys = Object.keys(payload);
  const { rows } = await db.query(
    `insert into public.oral_reading_attempts(${keys.join(",")}) values (${keys.map((key, index) => `$${index + 1}`).join(",")}) returning *`,
    keys.map((key) => (key === "word_metrics" ? JSON.stringify(payload[key]) : payload[key])));
  const verification = await verifySavedReading(requester, rows[0], deps);
  return { attempt: rows[0], verification };
}

/** An M6 assessment as the backend writes it, finished through the protected m6_apply_action. */
async function completeM6(db, { user, module = null, passage = null, material = null, correct = 10, total = 10, oral = null, snapshot = null }) {
  const questions = snapshot ?? Array.from({ length: total }, () => ({
    id: nextId(), type: "literal", questionText: "Q?", options: ["a", "b", "c", "d"], correctOptionIndex: 0, scaffoldingHint: "Read.",
  }));
  // An assigned material's M6 always links to a reading (m6_reading_source_check).
  if (material && !oral) {
    oral = (await db.query(`insert into public.oral_reading_attempts(user_id, material_id, activity_assignment_id, room_id, passage_snapshot, language_snapshot)
      values ($1,$2,$3,$4,$5,$6) returning id`, [user, material.id, material.activity, material.room, material.text, material.language])).rows[0].id;
  }
  const { rows } = await db.query(`insert into public.m6_comprehension_attempts(user_id, submission_id, module_id, passage_id, room_id, assignment_id,
      material_id, activity_assignment_id, oral_reading_attempt_id, passage_title, passage_text, language, question_snapshot, status)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Passage',$10,$11,$12,'in_progress') returning id`,
  [user, nextId(), module?.id ?? null, passage?.id ?? null, module?.room ?? material?.room ?? null, module?.assignment ?? null,
    material?.id ?? null, material?.activity ?? null, oral, passage?.text ?? material.text, passage?.language ?? material.language, JSON.stringify(questions)]);
  for (const [index, question] of questions.entries()) {
    const right = index < correct;
    await db.query(`insert into public.m6_comprehension_responses(attempt_id, question_id, first_option_index, first_answer_correct, resolved)
      values ($1,$2,$3,$4,true)`, [rows[0].id, question.id, right ? 0 : 1, right]);
  }
  await db.exec("set role service_role");
  try {
    await db.query("select public.m6_apply_action($1,$2,null,'complete',null,null)", [rows[0].id, user]);
  } finally {
    await db.exec("reset role");
  }
  return rows[0].id;
}

const xpEvents = async (db, user) => (await db.query(
  // A passage reward and the bonus it completes share one transaction timestamp.
  "select source_type, xp_earned from public.m8_xp_events where user_id = $1 order by created_at, source_type = 'module_bonus', id", [user])).rows
  .map((row) => [row.source_type, row.xp_earned]);
const totalXp = async (db, user) => (await db.query("select total_xp from public.m8_learner_progress where user_id = $1", [user])).rows[0]?.total_xp ?? 0;

module.exports = {
  assignMaterial, completeM6, createM8F1BaseDatabase, newMaterial, newModule, newRoom, newUser, nextId, readAloud, requesterOf, rpcClient,
  storyText, totalXp, transcriptFor, xpEvents,
};
