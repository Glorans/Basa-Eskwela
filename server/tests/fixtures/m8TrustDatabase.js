// Real PostgreSQL 17 (PGlite, in memory) with Supabase-style roles and default
// privileges, replaying the staging order around C9: core baseline, B3-B6
// diagnostics, learner-written (pre-DT1) diagnostic rows, C2-C7, then DT1.
// Small stand-ins replace only objects C9 does not change. No network.
const { PGlite } = require("@electric-sql/pglite");
const { id, sqlFile } = require("./m5M6SecurityDatabase");

const USERS = {
  admin: id(1), teacher: id(2), pendingTeacher: id(3),
  student: id(10), student2: id(11),
  general: id(20), generalNoDiagnostic: id(21), generalUnverified: id(22),
};
const ROOM = id(100);
const PENDING_ROOM = id(101);
const PATH = { en: id(200), fil: id(201), unknown: id(202) };
const MODULE = {
  enEasy: id(300), enMedium: id(301), enHard: id(302), filEasy: id(303), filHard: id(304),
  enDraft: id(305), enDeleted: id(306), unknownLanguage: id(307), enHardPending: id(308),
};
const ROOM_MODULE = { enHard: id(400), enMedium: id(401), pending: id(402), enDraft: id(403) };
const MATERIAL = id(500);
const ACTIVITY = id(600);

async function exec(db, sql) {
  await db.exec(sql);
}

async function createM8TrustDatabase() {
  const db = new PGlite();
  await exec(db, `
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    insert into auth.users select unnest(array['${Object.values(USERS).join("','")}'])::uuid;
  `);
  await exec(db, sqlFile("supabase/staging/00_core_baseline.sql"));
  // Stand-ins for columns/objects added by B2/B8/B15/B16/M3 that C9 only reads.
  await exec(db, `
    alter table public.profiles add column nickname text, add column teacher_status text;
    alter table public.modules add column deleted_at timestamptz;
    create function public.m3_current_role() returns text language sql stable security definer set search_path = ''
      as $$ select role from public.profiles where id = auth.uid() $$;
    create table public.uploaded_materials(id uuid primary key, uploaded_by uuid not null references public.profiles(id),
      language text not null check (language in ('en','fil')), extraction_status text not null default 'pending', content_text text);
    create table public.oral_reading_attempts(id uuid primary key default gen_random_uuid(), user_id uuid,
      completed_at timestamptz default now());
    create table public.comprehension_question_answers(question_id uuid primary key);
    create table public.module_passages(id uuid primary key, module_id uuid);
  `);
  await exec(db, sqlFile("readflow/supabase/migrations/20261005_m4_classroom_management.sql"));
  await exec(db, sqlFile("supabase/m5_reading_activity_assignments.sql"));
  await exec(db, sqlFile("readflow/supabase/m6_comprehension_schema.sql"));
  const b24 = sqlFile("supabase/migrations/20261012_m5_m6_uploaded_reading.sql");
  const m6Alter = b24.indexOf("alter table public.m6_comprehension_attempts");
  await exec(db, b24.slice(m6Alter, b24.indexOf(";", m6Alter) + 1));
  const m6Functions = sqlFile("readflow/supabase/m6_comprehension_functions.sql");
  const m6Start = m6Functions.indexOf("CREATE OR REPLACE FUNCTION public.m6_apply_action");
  await exec(db, m6Functions.slice(m6Start, m6Functions.indexOf("$function$;", m6Start) + "$function$;".length));
  await exec(db, `revoke all on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) from public,anon,authenticated;
    grant execute on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) to service_role;`);

  await exec(db, sqlFile("supabase/staging/03_b3_hardened.sql"));
  await exec(db, sqlFile("supabase/diagnostic_results_language.sql"));
  await exec(db, sqlFile("supabase/diagnostic_results_bilingual.sql"));
  await exec(db, sqlFile("supabase/diagnostic_results_sentence_versions.sql"));

  await exec(db, `
    insert into public.profiles(id, role, teacher_status) values
      ('${USERS.admin}','admin',null), ('${USERS.teacher}','teacher','approved'), ('${USERS.pendingTeacher}','teacher','pending'),
      ('${USERS.student}','student',null), ('${USERS.student2}','student',null),
      ('${USERS.general}','general_user',null), ('${USERS.generalNoDiagnostic}','general_user',null),
      ('${USERS.generalUnverified}','general_user',null);
    -- Pre-DT1 rows the browser wrote: Independent claims that C2 copied into M8.
    insert into public.diagnostic_results(user_id,language,assessment_id,assessment_version,orv_score,comprehension_score,reading_level,difficulty_tier)
    values ('${USERS.generalUnverified}','en','grade5-en-passage-v3','3.0',100,100,'Independent','Hard'),
           ('${USERS.student}','en','grade5-en-passage-v3','3.0',100,100,'Independent','Hard');
  `);

  await exec(db, sqlFile("supabase/staging/c2_m8_gamification_hardened.sql"));
  await exec(db, sqlFile("supabase/staging/c3_m8_completion_integration_hardened.sql"));
  for (const file of ["20261021000000_m8_classroom_leaderboard", "20261022000000_m8_consistent_reader",
    "20261023000000_m8_independent_leaderboard"]) {
    await exec(db, sqlFile(`readflow/supabase/migrations/${file}.sql`));
  }
  await exec(db, sqlFile("supabase/migrations/20261024_m7_analytics.sql"));
  await exec(db, sqlFile("supabase/migrations/20261025_m2_trusted_diagnostics.sql"));

  await exec(db, `
    insert into public.learning_paths(id,path_name,language,reading_level,difficulty_tier) values
      ('${PATH.en}','English','English','Frustration','Easy'), ('${PATH.fil}','Filipino','Filipino','Frustration','Easy'),
      ('${PATH.unknown}','Other','Klingon','Frustration','Easy');
    insert into public.modules(id,path_id,title,difficulty,status,created_by,deleted_at) values
      ('${MODULE.enEasy}','${PATH.en}','EN Easy','Easy','published','${USERS.admin}',null),
      ('${MODULE.enMedium}','${PATH.en}','EN Medium','Medium','published','${USERS.admin}',null),
      ('${MODULE.enHard}','${PATH.en}','EN Hard','Hard','published','${USERS.admin}',null),
      ('${MODULE.filEasy}','${PATH.fil}','FIL Easy','Easy','published','${USERS.admin}',null),
      ('${MODULE.filHard}','${PATH.fil}','FIL Hard','Hard','published','${USERS.admin}',null),
      ('${MODULE.enDraft}','${PATH.en}','EN Draft','Hard','draft','${USERS.admin}',null),
      ('${MODULE.enDeleted}','${PATH.en}','EN Deleted','Hard','published','${USERS.admin}',now()),
      ('${MODULE.unknownLanguage}','${PATH.unknown}','Unknown','Easy','published','${USERS.admin}',null),
      ('${MODULE.enHardPending}','${PATH.en}','EN Hard 2','Hard','published','${USERS.admin}',null);
    insert into public.rooms(id,teacher_id,room_name,room_code) values
      ('${ROOM}','${USERS.teacher}','Room','ROOM1'), ('${PENDING_ROOM}','${USERS.pendingTeacher}','Pending','ROOM2');
    insert into public.enrollments(room_id,student_id) values
      ('${ROOM}','${USERS.student}'), ('${ROOM}','${USERS.student2}'), ('${PENDING_ROOM}','${USERS.student}');
    insert into public.room_modules(id,room_id,module_id,assigned_by) values
      ('${ROOM_MODULE.enHard}','${ROOM}','${MODULE.enHard}','${USERS.teacher}'),
      ('${ROOM_MODULE.enMedium}','${ROOM}','${MODULE.enMedium}','${USERS.teacher}'),
      ('${ROOM_MODULE.pending}','${PENDING_ROOM}','${MODULE.enHardPending}','${USERS.pendingTeacher}'),
      ('${ROOM_MODULE.enDraft}','${ROOM}','${MODULE.enDraft}','${USERS.teacher}');
    insert into public.uploaded_materials values ('${MATERIAL}','${USERS.teacher}','en','completed','Seeds need sun.');
    insert into public.reading_activity_assignments(id,room_id,material_id,student_id,assigned_by)
      values ('${ACTIVITY}','${ROOM}','${MATERIAL}','${USERS.student}','${USERS.teacher}');
  `);
  return db;
}

// The backend's (service-role) verified diagnostic insert, as DT1 requires.
async function verifiedDiagnostic(db, user, language, level, recording) {
  const tier = { Frustration: "Easy", Instructional: "Medium", Independent: "Hard" }[level];
  await db.query(`insert into public.diagnostic_results(user_id,language,assessment_id,assessment_version,orv_score,comprehension_score,
      reading_level,difficulty_tier,verification_status,verification_method,verification_recording_id,verified_at)
    values ($1,$2,$3,'3.0',90,90,$4,$5,'server_verified','server_stt_receipt_v1',$6,now())`,
  [user, language, `grade5-${language}-passage-v3`, level, tier, recording]);
}

let submission = 0;
// An M6 attempt as the backend writes it (module or uploaded-material source).
async function completeAttempt(db, { user, module, room = null, assignment = null, language = "en",
  material = null, activity = null, viaUpdate = false, startOnly = false }) {
  const oral = material
    ? (await db.query("insert into public.oral_reading_attempts(user_id) values ($1) returning id", [user])).rows[0].id
    : null;
  const status = viaUpdate || startOnly ? "in_progress" : "completed";
  const question = id(8000);
  const snapshot = JSON.stringify([{ id: question, type: "literal", questionText: "What?",
    options: ["a", "b", "c", "d"], correctOptionIndex: 0, scaffoldingHint: "Read." }]);
  const { rows } = await db.query(`insert into public.m6_comprehension_attempts(user_id,submission_id,module_id,passage_id,room_id,
      assignment_id,passage_title,passage_text,language,question_snapshot,status,completed_at,material_id,activity_assignment_id,
      oral_reading_attempt_id)
    values ($1,$2,$3,$4,$5,$6,'Story','Story text',$7,$13,$8,$9,$10,$11,$12) returning id`,
  [user, id(9000 + ++submission), module ?? null, module ?? null, room, assignment, language, status,
    status === "in_progress" ? null : new Date().toISOString(), material, activity, oral, snapshot]);
  await db.query(`insert into public.m6_comprehension_responses(attempt_id,question_id,first_option_index,first_answer_correct,resolved)
    values ($1,$2,0,true,true)`, [rows[0].id, question]);
  if (viaUpdate) {
    await finishAttempt(db, rows[0].id, user);
  }
  return rows[0].id;
}

async function finishAttempt(db, attempt, user) {
  return db.query("select public.m6_apply_action($1,$2,null,'complete',null,null) as result", [attempt, user]);
}

module.exports = {
  ACTIVITY, MATERIAL, MODULE, PATH, PENDING_ROOM, ROOM, ROOM_MODULE, USERS,
  completeAttempt, finishAttempt, createM8TrustDatabase, verifiedDiagnostic,
};
