// Runs only in a disposable in-memory PostgreSQL database; never connects to Supabase.
// Covers supabase/proposed/m4_module_due_dates, m4_unassign and m8_classroom_leaderboard.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const sql = name => readFileSync(join(__dirname, '../proposed', name), 'utf8');
// The rollback is the commented block from "--   begin;" to "--   commit;" after the ROLLBACK heading.
const rollbackOf = text => {
  const tail = text.slice(text.indexOf('-- ROLLBACK')).split(/\r?\n/).map(line => line.replace(/^-- {3}/, ''));
  return tail.slice(tail.indexOf('begin;'), tail.indexOf('commit;') + 1).join('\n');
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TEACHER = id(1), OTHER_TEACHER = id(2), S1 = id(3), S2 = id(4), S3 = id(5);
const ROOM_A = id(10), ROOM_B = id(11);

// Shapes follow the read-only staging catalog (rooms, enrollments, room_modules,
// reading_activity_assignments, m8_xp_events, m8_learner_progress) and the existing trigger.
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, role text not null, approved boolean not null default true);
    create function public.m4_current_role() returns text language sql stable set search_path = '' as
      $$ select role from public.profiles where id = auth.uid() $$;
    create function public.m1_teacher_access_allowed() returns boolean language sql stable set search_path = '' as
      $$ select coalesce((select role <> 'teacher' or approved from public.profiles where id = auth.uid()), true) $$;
    create table public.rooms(id uuid primary key, teacher_id uuid not null references public.profiles(id),
      room_name text not null, room_code text not null unique);
    create table public.enrollments(id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.rooms(id), student_id uuid not null references public.profiles(id),
      enrolled_at timestamptz not null default now());
    create table public.room_modules(id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.rooms(id) on delete cascade, module_id uuid not null,
      assigned_by uuid not null references public.profiles(id), assigned_at timestamptz not null default now(),
      unique (module_id, room_id));
    create table public.reading_activity_assignments(id uuid primary key default gen_random_uuid(),
      room_id uuid not null references public.rooms(id), material_id uuid not null,
      student_id uuid not null references public.profiles(id), assigned_by uuid not null references public.profiles(id),
      assigned_at timestamptz not null default now(), due_at timestamptz, question_set_id uuid,
      read_aloud_only boolean not null default false,
      status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'completed')));
    create function public.m6_protect_activity_assignment_mode() returns trigger
    language plpgsql set search_path = '' as $$
    begin
      if (auth.uid() is not null) and
        (new.id, new.room_id, new.material_id, new.student_id, new.assigned_by,
         new.assigned_at, new.due_at, new.question_set_id, new.read_aloud_only)
        is distinct from
        (old.id, old.room_id, old.material_id, old.student_id, old.assigned_by,
         old.assigned_at, old.due_at, old.question_set_id, old.read_aloud_only)
      then raise exception using errcode = '42501', message = 'Reading assignment identity and mode cannot be changed';
      end if;
      return new;
    end; $$;
    create trigger m6_activity_assignment_mode before update on public.reading_activity_assignments
      for each row execute function public.m6_protect_activity_assignment_mode();
    create table public.m8_xp_events(id uuid primary key default gen_random_uuid(), user_id uuid not null,
      source_type text not null, source_id uuid not null, xp_earned integer not null,
      created_at timestamptz not null default now());
    create table public.m8_learner_progress(user_id uuid primary key, total_xp integer not null default 0,
      unlocked_difficulty text not null default 'Easy');
    insert into public.profiles(id, role) values
      ('${TEACHER}', 'teacher'), ('${OTHER_TEACHER}', 'teacher'),
      ('${S1}', 'student'), ('${S2}', 'student'), ('${S3}', 'student');
    insert into public.rooms values ('${ROOM_A}', '${TEACHER}', 'A', 'AAA'), ('${ROOM_B}', '${TEACHER}', 'B', 'BBB');
    insert into public.enrollments(room_id, student_id) values
      ('${ROOM_A}', '${S1}'), ('${ROOM_A}', '${S2}'), ('${ROOM_B}', '${S1}'), ('${ROOM_B}', '${S3}');
  `);
  const as = uid => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  return { db, as, rows };
}

test('module due dates: optional column, old inserts unchanged, rollback restores the shape', async () => {
  const { db, rows } = await database();
  const proposal = sql('m4_module_due_dates_PROPOSED.sql');
  await db.query(`insert into public.room_modules(room_id, module_id, assigned_by) values ($1, $2, $3)`, [ROOM_A, id(50), TEACHER]);
  await db.exec(proposal);
  // Existing rows keep "no deadline"; the deployed client (no due_at) still inserts.
  assert.deepEqual(await rows(`select due_at from public.room_modules`), [{ due_at: null }]);
  await db.query(`insert into public.room_modules(room_id, module_id, assigned_by) values ($1, $2, $3)`, [ROOM_A, id(51), TEACHER]);
  await db.query(`insert into public.room_modules(room_id, module_id, assigned_by, due_at) values ($1, $2, $3, $4)`,
    [ROOM_B, id(52), TEACHER, '2026-11-09T07:30:00Z']);
  assert.equal((await rows(`select count(*)::int n from public.room_modules where due_at is not null`))[0].n, 1);
  await assert.rejects(db.exec(proposal), /already exists/);
  await db.exec('rollback'); // the failed re-run aborted its own transaction; nothing changed
  await db.exec(rollbackOf(proposal));
  assert.equal((await rows(`select count(*)::int n from information_schema.columns
    where table_name = 'room_modules' and column_name = 'due_at'`))[0].n, 0);
  assert.equal((await rows(`select count(*)::int n from public.room_modules`))[0].n, 3);
});

test('unassign: only the owning approved teacher soft-removes; rows and results are kept', async () => {
  const { db, as, rows } = await database();
  const proposal = sql('m4_unassign_PROPOSED.sql');
  const [activity] = await rows(`insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by, status)
    values ($1, $2, $3, $4, 'completed') returning id`, [ROOM_A, id(60), S1, TEACHER]);
  const [module] = await rows(`insert into public.room_modules(room_id, module_id, assigned_by) values ($1, $2, $3) returning id`,
    [ROOM_A, id(61), TEACHER]);
  await db.exec(proposal);
  const call = (fn, target) => rows(`select public.${fn}($1) ok`, [target]);

  for (const uid of [S1, OTHER_TEACHER, null]) {
    await as(uid);
    await assert.rejects(call('m4_unassign_activity', activity.id), /Only the classroom teacher/);
    await assert.rejects(call('m4_unassign_module', module.id), /Only the classroom teacher/);
  }
  await as(null);
  await db.query(`update public.profiles set approved = false where id = $1`, [TEACHER]);
  await as(TEACHER);
  await assert.rejects(call('m4_unassign_activity', activity.id), /Only the classroom teacher/);
  await as(null);
  await db.query(`update public.profiles set approved = true where id = $1`, [TEACHER]);
  await as(TEACHER);
  assert.deepEqual(await call('m4_unassign_activity', activity.id), [{ ok: true }]);
  assert.deepEqual(await call('m4_unassign_activity', activity.id), [{ ok: false }]); // idempotent
  assert.deepEqual(await call('m4_unassign_module', module.id), [{ ok: true }]);
  await assert.rejects(call('m4_unassign_activity', id(99)), /Only the classroom teacher/);
  await as(null);
  const [saved] = await rows(`select status, removed_by, removed_at is not null removed from public.reading_activity_assignments`);
  assert.deepEqual(saved, { status: 'completed', removed_by: TEACHER, removed: true });
  assert.equal((await rows(`select count(*)::int n from public.room_modules where removed_at is not null`))[0].n, 1);
  // The identity/mode guard still blocks other column changes by signed-in users.
  await as(TEACHER);
  await assert.rejects(db.query(`update public.reading_activity_assignments set due_at = now()`), /cannot be changed/);
  // Restore undoes the removal (also idempotent) and keeps the saved status; others still cannot.
  const restore = (fn, target) => rows(`select public.${fn}($1, true) ok`, [target]);
  await as(OTHER_TEACHER);
  await assert.rejects(restore('m4_unassign_activity', activity.id), /Only the classroom teacher/);
  await as(TEACHER);
  assert.deepEqual(await restore('m4_unassign_activity', activity.id), [{ ok: true }]);
  assert.deepEqual(await restore('m4_unassign_activity', activity.id), [{ ok: false }]);
  assert.deepEqual(await restore('m4_unassign_module', module.id), [{ ok: true }]);
  await as(null);
  assert.deepEqual((await rows(`select status, removed_at, removed_by from public.reading_activity_assignments`))[0],
    { status: 'completed', removed_at: null, removed_by: null });
  // removed_at and removed_by are always set together.
  await assert.rejects(db.query(`update public.room_modules set removed_at = now()`), /removed_check/);
  await db.exec(rollbackOf(proposal));
  assert.equal((await rows(`select count(*)::int n from information_schema.columns where column_name in ('removed_at', 'removed_by')`))[0].n, 0);
  assert.equal((await rows(`select count(*)::int n from public.reading_activity_assignments`))[0].n, 1);
});

test('classroom leaderboard: only that room, only for its members, weekly XP unchanged', async () => {
  const { db, as, rows } = await database();
  const proposal = sql('m8_classroom_leaderboard_PROPOSED.sql');
  await db.query(`insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned, created_at) values
    ($1, 'module', $4, 50, now()), ($2, 'module', $5, 80, now()), ($3, 'module', $6, 60, now()),
    ($1, 'module', $7, 30, now() - interval '30 days')`, [S1, S2, S3, id(70), id(71), id(72), id(73)]);
  await db.exec(proposal);
  const board = async (uid, room) => { await as(uid); return rows(`select display_name, xp::int from public.m8_classroom_leaderboard($1)`, [room]); };
  const reader = sid => 'Reader ' + sid.replace(/-/g, '').slice(0, 6).toUpperCase();
  assert.deepEqual(await board(S1, ROOM_A), [{ display_name: reader(S2), xp: 80 }, { display_name: 'You', xp: 50 }]);
  assert.deepEqual(await board(S1, ROOM_B), [{ display_name: reader(S3), xp: 60 }, { display_name: 'You', xp: 50 }]);
  assert.deepEqual(await board(S3, ROOM_A), []); // not a member of room A
  assert.deepEqual(await board(TEACHER, ROOM_A), []);
  assert.deepEqual(await board(null, ROOM_A), []);
  await as(null);
  await assert.rejects(db.exec(proposal), /already exists/);
  await db.exec('rollback'); // the failed re-run aborted its own transaction; nothing changed
  await db.exec(rollbackOf(proposal));
  assert.equal((await rows(`select count(*)::int n from pg_proc where proname = 'm8_classroom_leaderboard'`))[0].n, 0);
});
