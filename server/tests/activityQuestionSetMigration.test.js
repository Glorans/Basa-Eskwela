// Applies the real migration to in-memory PostgreSQL (WASM). Never reads Supabase credentials.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TEACHER = id(1), OTHER_TEACHER = id(2), STUDENT = id(3), ROOM = id(4);
const MATERIAL = id(10), OTHER_MATERIAL = id(11);
const REVIEWED = id(20), UNREVIEWED = id(21), EMPTY = id(22), FOREIGN = id(23);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.profiles(id uuid primary key);
    create table public.uploaded_materials(id uuid primary key, uploaded_by uuid not null);
    create table public.material_question_sets(id uuid primary key, material_id uuid not null
      references public.uploaded_materials(id) on delete cascade, unique (id, material_id));
    create table public.comprehension_questions(id uuid primary key default gen_random_uuid(),
      question_set_id uuid, review_status text not null);
    create table public.reading_activity_assignments(id uuid primary key default gen_random_uuid(),
      room_id uuid not null, material_id uuid not null references public.uploaded_materials(id),
      student_id uuid not null, assigned_by uuid not null, assigned_at timestamptz not null default now(),
      due_at timestamptz, status text not null default 'assigned');
    insert into public.uploaded_materials values ('${MATERIAL}','${TEACHER}'), ('${OTHER_MATERIAL}','${OTHER_TEACHER}');
    insert into public.material_question_sets values ('${REVIEWED}','${MATERIAL}'), ('${UNREVIEWED}','${MATERIAL}'),
      ('${EMPTY}','${MATERIAL}'), ('${FOREIGN}','${OTHER_MATERIAL}');
    insert into public.comprehension_questions(question_set_id, review_status) values
      ('${REVIEWED}','reviewed'), ('${REVIEWED}','reviewed'), ('${REVIEWED}','reviewed'),
      ('${UNREVIEWED}','reviewed'), ('${UNREVIEWED}','generated'), ('${FOREIGN}','reviewed');
    insert into public.reading_activity_assignments(id, room_id, material_id, student_id, assigned_by, status)
      values ('${id(90)}','${ROOM}','${MATERIAL}','${STUDENT}','${TEACHER}','completed');
  `);
  await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations/20261012_m6_activity_question_sets.sql"), "utf8"));
  return db;
}

function assign(db, setId, { material = MATERIAL, teacher = TEACHER } = {}) {
  return db.query(
    "insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by, question_set_id) values ($1,$2,$3,$4,$5) returning id",
    [ROOM, material, STUDENT, teacher, setId],
  );
}

test("activity question set migration keeps legacy rows and enforces reviewed, same-material sets", async t => {
  const db = await database();
  t.after(() => db.close());
  const legacy = await db.query("select status, question_set_id from public.reading_activity_assignments where id = $1", [id(90)]);
  assert.deepEqual(legacy.rows, [{ status: "completed", question_set_id: null }]);

  await assign(db, null);
  const saved = await assign(db, REVIEWED);
  assert.equal(saved.rows.length, 1);

  await assert.rejects(assign(db, UNREVIEWED), { code: "23514", message: /must be reviewed/ });
  await assert.rejects(assign(db, EMPTY), { code: "23514", message: /must be reviewed/ });
  await assert.rejects(assign(db, FOREIGN), { code: "23514", message: /does not belong/ });
  await assert.rejects(assign(db, REVIEWED, { teacher: OTHER_TEACHER }), { code: "23514", message: /does not belong/ });
  await assert.rejects(assign(db, id(99)), { code: "23514" });
  await assert.rejects(
    db.query("update public.reading_activity_assignments set question_set_id = $1 where id = $2", [UNREVIEWED, id(90)]),
    { code: "23514" },
  );

  // An assigned set cannot be deleted; an unassigned one still can.
  await assert.rejects(db.query("delete from public.material_question_sets where id = $1", [REVIEWED]), { code: "23503" });
  await db.query("delete from public.material_question_sets where id = $1", [EMPTY]);

  const index = await db.query("select indexdef from pg_indexes where indexname = 'reading_activity_assignments_question_set_idx'");
  assert.match(index.rows[0].indexdef, /\(question_set_id\) WHERE \(question_set_id IS NOT NULL\)/);
});

test("activity question set migration changes no rows or policies", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261012_m6_activity_question_sets.sql"), "utf8");
  assert.doesNotMatch(sql, /^\s*(?:update|delete from|insert into)\b/im);
  assert.doesNotMatch(sql, /(?:create|drop|alter) policy/i);
  assert.match(sql, /on delete no action/);
});
