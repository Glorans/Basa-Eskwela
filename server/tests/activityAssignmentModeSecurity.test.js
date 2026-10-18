// Disposable PostgreSQL WASM only: no environment variables, network or Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { sqlFile, id } = require('./fixtures/m5M6SecurityDatabase');

const teacher = id(1), student = id(2), otherStudent = id(3), room = id(4);
const material = id(10), reviewed = id(20), unreviewed = id(21), legacy = id(30);
const migration = sqlFile('supabase/migrations/20261012_m6_activity_question_sets.sql');
const snapshotSql = `select polname, polcmd, polpermissive, polroles,
  pg_get_expr(polqual,polrelid) as qual, pg_get_expr(polwithcheck,polrelid) as check_expr
  from pg_policy where polrelid='public.reading_activity_assignments'::regclass order by polname`;
const grantsSql = `select attname, attacl::text from pg_attribute
  where attrelid='public.reading_activity_assignments'::regclass and attnum>0 order by attnum`;

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    create table public.profiles(id uuid primary key, role text, teacher_status text);
    create table public.rooms(id uuid primary key, teacher_id uuid references public.profiles(id));
    create table public.enrollments(room_id uuid references public.rooms(id), student_id uuid references public.profiles(id));
    create table public.uploaded_materials(id uuid primary key, uploaded_by uuid references public.profiles(id),
      extraction_status text, content_text text);
    create table public.modules(id uuid primary key, status text, deleted_at timestamptz);
    create table public.module_passages(id uuid primary key, module_id uuid references public.modules(id));
    create function public.m3_current_role() returns text language sql stable security definer set search_path='' as $$
      select role from public.profiles where id=auth.uid()
    $$;
    insert into public.profiles values ('${teacher}','teacher','approved'),
      ('${student}','student',null),('${otherStudent}','student',null);
    insert into public.rooms values ('${room}','${teacher}');
    insert into public.enrollments values ('${room}','${student}'),('${room}','${otherStudent}');
    insert into public.uploaded_materials values ('${material}','${teacher}','completed','A story');
  `);
  // Execute the complete historical assignment schema, policies, grants and trigger.
  await db.exec(sqlFile('supabase/m5_reading_activity_assignments.sql'));
  // Use the actual M3 set table DDL and composite FK. The question table contains
  // only the columns needed here, with its material FK copied from M3 verbatim.
  const m3Sets = sqlFile('supabase/m3_material_question_sets.sql');
  await db.exec(m3Sets.match(/create table public\.material_question_sets \([\s\S]*?\n\);/)[0]);
  const m3Content = sqlFile('supabase/m3_content_schema.sql');
  await db.exec(`alter table public.modules add column source_material_id uuid;
    alter table public.modules add constraint modules_source_material_id_fkey
    ${m3Content.match(/foreign key \(source_material_id\)[\s\S]*?on delete restrict/)[0]};`);
  const questionTable = m3Content.slice(m3Content.indexOf('create table if not exists public.comprehension_questions'));
  const materialColumn = questionTable.match(/material_id uuid[\s\S]*?on delete restrict/)[0];
  await db.exec(`create table public.comprehension_questions(id uuid primary key,
    ${materialColumn}, question_set_id uuid, review_status text);
    alter table public.comprehension_questions add constraint comprehension_questions_set_material_fkey
    ${m3Sets.match(/foreign key \(question_set_id, material_id\)[^;]+/)[0]};
    insert into public.material_question_sets(id,material_id,created_by,name,sequence_number)
      values ('${reviewed}','${material}','${teacher}','Reviewed',1),
      ('${unreviewed}','${material}','${teacher}','Draft',2);
    insert into public.comprehension_questions values
      ('${id(40)}','${material}','${reviewed}','reviewed'),
      ('${id(41)}','${material}','${unreviewed}','generated');
    insert into public.reading_activity_assignments(id,room_id,material_id,student_id,assigned_by,status)
      values ('${legacy}','${room}','${material}','${student}','${teacher}','in_progress');
    grant select,insert,update,delete on public.reading_activity_assignments to service_role;
  `);
  return db;
}

async function asRole(db, user, sql, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.exec(`set local role ${role}`);
    return await db.query(sql);
  } finally { await db.exec('rollback'); }
}

test('M6 mode security using real M5 policies, column privileges and identity trigger', async t => {
  const db = await database();
  t.after(() => db.close());
  const policies = (await db.query(snapshotSql)).rows;
  const grants = (await db.query(grantsSql)).rows;
  const old = (await db.query('select * from public.reading_activity_assignments')).rows[0];
  await db.exec(migration);

  await t.test('legacy row values, policies, existing column grants and M5 trigger are unchanged', async () => {
    const after = (await db.query('select * from public.reading_activity_assignments')).rows[0];
    assert.equal(after.read_aloud_only, false);
    assert.equal(after.question_set_id, null);
    for (const [key, value] of Object.entries(old)) assert.deepEqual(after[key], value);
    assert.deepEqual((await db.query(snapshotSql)).rows, policies);
    assert.deepEqual((await db.query(grantsSql)).rows.slice(0, grants.length), grants);
    assert.deepEqual((await db.query(`select has_column_privilege('authenticated',
      'public.reading_activity_assignments','status','UPDATE') as status,
      has_column_privilege('authenticated','public.reading_activity_assignments','read_aloud_only','UPDATE') as mode,
      has_column_privilege('authenticated','public.reading_activity_assignments','question_set_id','UPDATE') as question_set`)).rows,
      [{ status: true, mode: false, question_set: false }]);
    assert.equal((await db.query(`select count(*)::int as n from pg_trigger
      where tgrelid='public.reading_activity_assignments'::regclass and tgname='m5_activity_identity'`)).rows[0].n, 1);
  });

  await t.test('student cannot change either assignment mode column', async () => {
    for (const change of ['read_aloud_only=true', `question_set_id='${reviewed}'`]) {
      await assert.rejects(asRole(db, student, `update public.reading_activity_assignments set ${change} where id='${legacy}'`), { code: '42501' });
    }
  });

  await t.test('student status-only update succeeds and another student cannot update it', async () => {
    const sql = `update public.reading_activity_assignments set status='completed' where id='${legacy}' returning status`;
    assert.deepEqual((await asRole(db, student, sql)).rows, [{ status: 'completed' }]);
    assert.deepEqual((await asRole(db, otherStudent, sql)).rows, []);
    assert.deepEqual((await asRole(db, null, sql)).rows, []);
  });

  await t.test('mode and identity protection survives a pre-existing broad UPDATE grant', async () => {
    await db.exec('grant update on public.reading_activity_assignments to authenticated');
    try {
      for (const change of ['read_aloud_only=true', `question_set_id='${reviewed}'`,
        `id='${id(99)}'`, `room_id='${id(99)}'`, `material_id='${id(99)}'`,
        `student_id='${otherStudent}'`, `assigned_by='${student}'`,
        "assigned_at=assigned_at+interval '1 day'", "due_at=now()"]) {
        await assert.rejects(asRole(db, student, `update public.reading_activity_assignments set ${change} where id='${legacy}'`), { code: '42501' });
      }
      assert.equal((await asRole(db, student, `update public.reading_activity_assignments set status='completed' where id='${legacy}' returning id`)).rows.length, 1);
      // Isolate the new trigger from RLS and M5's non-null-subject guard.
      await db.exec('alter table public.reading_activity_assignments disable row level security');
      try {
        await assert.rejects(asRole(db, null, `update public.reading_activity_assignments
          set read_aloud_only=true where id='${legacy}'`), { code: '42501' });
      } finally { await db.exec('alter table public.reading_activity_assignments enable row level security'); }
    } finally { await db.exec('revoke update on public.reading_activity_assignments from authenticated'); }
  });

  await t.test('reviewed set can be assigned; draft set and combined modes cannot', async () => {
    const insert = (set, mode) => `insert into public.reading_activity_assignments
      (room_id,material_id,student_id,assigned_by,question_set_id,read_aloud_only)
      values ('${room}','${material}','${otherStudent}','${teacher}',${set ? `'${set}'` : 'null'},${mode}) returning id`;
    assert.equal((await asRole(db, teacher, insert(reviewed, false))).rows.length, 1);
    assert.equal((await asRole(db, teacher, insert(null, true))).rows.length, 1);
    await assert.rejects(asRole(db, teacher, insert(unreviewed, false)), { code: '23514' });
    await assert.rejects(asRole(db, teacher, insert(reviewed, true)), { code: '23514' });
    await assert.rejects(asRole(db, student, insert(reviewed, false)), { code: '42501' });
  });

  await t.test('trusted subjectless server role can change mode; check constraints still apply', async () => {
    assert.deepEqual((await asRole(db, null, `update public.reading_activity_assignments
      set read_aloud_only=true where id='${legacy}' returning read_aloud_only`, 'service_role')).rows,
    [{ read_aloud_only: true }]);
    await assert.rejects(asRole(db, null, `update public.reading_activity_assignments
      set read_aloud_only=true,question_set_id='${reviewed}' where id='${legacy}'`, 'service_role'), { code: '23514' });
  });

  await t.test('individual assigned question set deletion is blocked by the new NO ACTION FK', async () => {
    await db.exec(`update public.reading_activity_assignments set question_set_id='${reviewed}' where id='${legacy}';
      delete from public.comprehension_questions where question_set_id='${reviewed}'`);
    await assert.rejects(db.exec(`delete from public.material_question_sets where id='${reviewed}'`),
      error => error.code === '23503' && error.constraint === 'reading_activity_assignments_question_set_id_fkey');
  });

  await t.test('deleting uploaded material with assigned set fails; rows survive rollback', async () => {
    await assert.rejects(db.exec(`delete from public.uploaded_materials where id='${material}'`),
      error => error.code === '23503' && error.constraint === 'reading_activity_assignments_material_id_fkey');
    assert.equal((await db.query('select count(*)::int as n from public.reading_activity_assignments')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from public.material_question_sets')).rows[0].n, 2);
    const fks = (await db.query(`select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where contype='f' and confrelid in ('public.uploaded_materials'::regclass,'public.material_question_sets'::regclass)
      order by conname`)).rows;
    t.diagnostic(JSON.stringify(fks));
    assert.match(fks.find(row => row.conname === 'material_question_sets_material_id_fkey').definition, /ON DELETE CASCADE/);
    assert.doesNotMatch(fks.find(row => row.conname === 'reading_activity_assignments_question_set_id_fkey').definition, /RESTRICT|CASCADE/);
  });
});
