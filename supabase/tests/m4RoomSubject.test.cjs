// Runs only in a disposable in-memory PostgreSQL database; never connects to Supabase.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const sql = name => readFileSync(join(__dirname, '../proposed', name), 'utf8');
const phase1 = sql('m4_room_subject_phase1_PROPOSED.sql');
const phase2 = sql('m4_room_subject_phase2_PROPOSED.sql');
// The documented rollback blocks are commented SQL after their ROLLBACK heading.
const rollbackOf = text => text.slice(text.indexOf('-- ROLLBACK')).split(/\r?\n/).slice(2)
  .filter(line => line.startsWith('--  ')).map(line => line.replace(/^-- {2,3}/, '')).join('\n');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CHECK = { code: '23514' };

test('two-phase room-subject migration stays compatible, then requires a subject', async t => {
  const db = new PGlite();
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) => Object.values((await rows(sql, params))[0])[0];
  const assignModule = (room, module) =>
    db.query('insert into public.room_modules(room_id, module_id, assigned_by) values ($1, $2, $3)', [id(room), id(module), id(1)]);
  const assignMaterial = (room, material) =>
    db.query(`insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by)
      values ($1, $2, $3, $4)`, [id(room), id(material), id(2), id(1)]);
  const room = (n, subject) =>
    db.query(`insert into public.rooms(id, teacher_id, room_name, room_code, subject) values ($1, $2, $3, $3, $4)`,
      [id(n), id(1), `Room ${n}`, subject]);
  // The deployed frontend sends no subject at all.
  const oldClientRoom = n => db.query(`insert into public.rooms(id, teacher_id, room_name, room_code) values ($1, $2, $3, $3)`,
    [id(n), id(1), `Old client ${n}`]);
  try {
    // Shapes follow supabase/staging/00_core_baseline.sql, 07_b7_hardened.sql and m5_reading_activity_assignments.sql.
    await db.exec(`
      create role anon; create role authenticated;
      grant usage on schema public to authenticated, anon;
      create table public.profiles(id uuid primary key);
      create table public.learning_paths(id uuid primary key, path_name text not null, language text not null);
      create table public.modules(id uuid primary key, path_id uuid not null references public.learning_paths(id),
        title text not null, deleted_at timestamptz);
      create table public.rooms(id uuid primary key, teacher_id uuid not null references public.profiles(id),
        room_name text not null, room_code text not null unique, section text, description text,
        created_at timestamptz not null default now());
      create table public.room_modules(id uuid primary key default gen_random_uuid(),
        room_id uuid not null references public.rooms(id) on delete cascade,
        module_id uuid not null references public.modules(id), assigned_by uuid not null references public.profiles(id),
        assigned_at timestamptz not null default now(), unique (module_id, room_id));
      create table public.uploaded_materials(id uuid primary key, title text not null,
        language text not null check (language in ('en', 'fil')), next_question_set_number int not null default 1);
      create table public.reading_activity_assignments(id uuid primary key default gen_random_uuid(),
        room_id uuid not null references public.rooms(id), material_id uuid not null references public.uploaded_materials(id),
        student_id uuid not null references public.profiles(id), assigned_by uuid not null references public.profiles(id),
        assigned_at timestamptz not null default now(), due_at timestamptz,
        status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'completed')));
      grant select, insert, update on all tables in schema public to authenticated;
      insert into public.profiles values ('${id(1)}'), ('${id(2)}');
      insert into public.learning_paths values
        ('${id(10)}', 'English Foundations', 'English'), ('${id(11)}', 'English Growing Readers', 'English'),
        ('${id(12)}', 'Filipino Panimulang Pagbasa', 'Filipino'), ('${id(13)}', 'Unsupported', 'Spanish');
      insert into public.modules(id, path_id, title) values
        ('${id(20)}', '${id(10)}', 'English module'), ('${id(21)}', '${id(12)}', 'Filipino module'),
        ('${id(22)}', '${id(13)}', 'Unsupported module'), ('${id(23)}', '${id(10)}', 'Legacy-only module');
      insert into public.uploaded_materials(id, title, language) values
        ('${id(30)}', 'English story', 'en'), ('${id(31)}', 'Kuwentong Filipino', 'fil');
      -- A legacy room with mixed-language assignments, created before the migration.
      insert into public.rooms(id, teacher_id, room_name, room_code) values ('${id(40)}', '${id(1)}', 'Legacy', 'LEGACY');
      insert into public.room_modules(room_id, module_id, assigned_by) values
        ('${id(40)}', '${id(20)}', '${id(1)}'), ('${id(40)}', '${id(21)}', '${id(1)}');
      insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by) values
        ('${id(40)}', '${id(30)}', '${id(2)}', '${id(1)}'), ('${id(40)}', '${id(31)}', '${id(2)}', '${id(1)}');
    `);
    const snapshot = () => rows(`select
      (select json_agg(r order by r.id) from (select id, room_name, room_code from public.rooms) r) rooms,
      (select json_agg(m order by m.id) from public.room_modules m) modules,
      (select json_agg(a order by a.id) from public.reading_activity_assignments a) activities`);
    const catalog = () => scalar(`select json_build_object(
      'column', (select count(*) from information_schema.columns where table_name = 'rooms' and column_name = 'subject'),
      'functions', (select count(*) from pg_proc where proname like 'm4\\_%'),
      'triggers', (select count(*) from pg_trigger where tgname like 'm4\\_%'))::text`);
    const before = await snapshot();
    const catalogBefore = await catalog();

    await t.test('phase 2 refuses to run before phase 1 and changes nothing', async () => {
      await assert.rejects(db.exec(phase2), /phase1/);
      await db.exec('rollback');
      assert.equal(await catalog(), catalogBefore);
    });

    await db.exec(phase1);

    await t.test('phase 1: existing rooms and assignments are unchanged and remain legacy', async () => {
      assert.deepEqual(await snapshot(), before);
      assert.equal(await scalar(`select subject from public.rooms where id = $1`, [id(40)]), null);
      await db.query(`update public.rooms set room_name = 'Legacy renamed' where id = $1`, [id(40)]);
      await db.query(`update public.reading_activity_assignments set status = 'completed' where room_id = $1`, [id(40)]);
      await assignModule(40, 22); // legacy rooms keep frontend-only filtering
      await assert.rejects(db.query(`update public.rooms set subject = 'en' where id = $1`, [id(40)]), CHECK);
    });

    await t.test('phase 1: the old frontend can still create rooms, which stay legacy', async () => {
      await oldClientRoom(45);
      assert.equal(await scalar(`select subject from public.rooms where id = $1`, [id(45)]), null);
      await assignModule(45, 21);
      await assignModule(45, 20);
      await assert.rejects(db.query(`update public.rooms set subject = 'fil' where id = $1`, [id(45)]), CHECK);
    });

    await t.test('phase 1: the new frontend creates English and Filipino rooms that keep their subject', async () => {
      await assert.rejects(room(50, 'es'), CHECK);
      await assert.rejects(room(50, 'English'), CHECK);
      await room(50, 'en');
      await room(51, 'fil');
      await assert.rejects(db.query(`update public.rooms set subject = 'fil' where id = $1`, [id(50)]), CHECK);
      await assert.rejects(db.query(`update public.rooms set subject = null where id = $1`, [id(50)]), CHECK);
      await db.query(`update public.rooms set room_name = 'English 5', subject = subject where id = $1`, [id(50)]);
    });

    await t.test('English and Filipino rooms accept only matching modules and activities', async () => {
      await assignModule(50, 20);
      await assert.rejects(assignModule(50, 21), CHECK);
      await assert.rejects(assignModule(50, 22), CHECK);
      await assignMaterial(50, 30);
      await assert.rejects(assignMaterial(50, 31), CHECK);
      await assignModule(51, 21);
      await assert.rejects(assignModule(51, 20), CHECK);
      await assignMaterial(51, 31);
      await assert.rejects(assignMaterial(51, 30), CHECK);
      await assert.rejects(db.query(`update public.room_modules set room_id = $1 where room_id = $2 and module_id = $3`,
        [id(51), id(50), id(20)]), CHECK);
      await db.query(`update public.reading_activity_assignments set status = 'in_progress' where room_id = $1`, [id(50)]);
    });

    await t.test('assigned sources cannot switch away from a subject room language', async () => {
      await assert.rejects(db.query(`update public.modules set path_id = $1 where id = $2`, [id(12), id(20)]), CHECK);
      await db.query(`update public.modules set path_id = $1, title = 'English module 2' where id = $2`, [id(11), id(20)]);
      await db.query(`update public.modules set title = title, path_id = path_id where id = $1`, [id(20)]);
      await assert.rejects(db.query(`update public.uploaded_materials set language = 'fil' where id = $1`, [id(30)]), CHECK);
      await db.query(`update public.uploaded_materials set next_question_set_number = 2 where id = $1`, [id(30)]);
      await assert.rejects(db.query(`update public.learning_paths set language = 'Filipino' where id = $1`, [id(11)]), CHECK);
      await db.query(`update public.learning_paths set language = 'english' where id = $1`, [id(11)]);
      await db.query(`update public.modules set path_id = $1 where id = $2`, [id(12), id(23)]); // unassigned
    });

    await t.test('authenticated writes are checked without exposing the helper functions', async () => {
      await db.exec('set role authenticated');
      await assert.rejects(assignModule(50, 21), CHECK);
      await assignMaterial(51, 31);
      await assert.rejects(db.query(`select public.m4_normalize_subject('en')`), { code: '42501' });
      await db.exec('reset role');
    });

    await t.test('a second phase 1 run fails and rolls back without changes', async () => {
      const current = await snapshot();
      await assert.rejects(db.exec(phase1));
      await db.exec('rollback');
      assert.deepEqual(await snapshot(), current);
      assert.equal(await scalar(`select count(*)::int from pg_trigger where tgname like 'm4\\_%'`), 6);
    });

    await t.test('phase 2 requires a subject for new rooms and leaves existing rooms alone', async () => {
      const current = await snapshot();
      await db.exec(phase2);
      await db.exec(phase2); // re-runnable
      assert.deepEqual(await snapshot(), current);
      await assert.rejects(oldClientRoom(46), CHECK);
      await assert.rejects(room(46, null), CHECK);
      await room(52, 'fil');
      for (const legacy of [40, 45]) {
        assert.equal(await scalar(`select subject from public.rooms where id = $1`, [id(legacy)]), null);
        await db.query(`update public.rooms set room_name = room_name || ' (still works)' where id = $1`, [id(legacy)]);
        await assert.rejects(db.query(`update public.rooms set subject = 'en' where id = $1`, [id(legacy)]), CHECK);
      }
      await assignModule(40, 23); // legacy rooms still accept any language
      await assert.rejects(assignModule(52, 20), CHECK);
      await db.exec('set role authenticated');
      await assert.rejects(db.query(`select public.m4_normalize_subject('en')`), { code: '42501' });
      await db.exec('reset role');
    });

    await t.test('documented rollbacks: phase 2 back to phase 1, then phase 1 back to the original schema', async () => {
      await db.exec(rollbackOf(phase2));
      await oldClientRoom(47); // old clients work again
      const legacyModules = await scalar(`select count(*)::int from public.room_modules where room_id = $1`, [id(40)]);
      await db.exec(rollbackOf(phase1));
      assert.equal(await catalog(), catalogBefore);
      assert.equal(await scalar(`select count(*)::int from public.room_modules where room_id = $1`, [id(40)]), legacyModules);
      await db.exec(phase1);
      await db.exec(phase2);
      assert.equal(await scalar(`select count(*)::int from pg_trigger where tgname like 'm4\\_%'`), 6);
    });
  } finally {
    await db.close();
  }
});
