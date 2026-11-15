// Real PostgreSQL in memory (PGlite) only. No credentials, no Supabase connection.
// Covers supabase/proposed/m1_school_admin_learner_scope_{PROPOSED,ROLLBACK_PROPOSED,VERIFY_READONLY}.sql: with the
// CURRENT Staging policies a School Admin can read an Independent Learner's uploads directly; after the proposal it
// cannot, while Teachers, Independent Learners and the School Admin's other material access are unchanged.
const assert = require('node:assert/strict');
const test = require('node:test');
const { as, database, id, sql } = require('./helpers/m1LearnerScopeHarness.cjs');

const PROPOSED = sql('supabase/proposed/m1_school_admin_learner_scope_PROPOSED.sql');
const ROLLBACK = sql('supabase/proposed/m1_school_admin_learner_scope_ROLLBACK_PROPOSED.sql');
async function verify(db, section) {
  const text = sql('supabase/proposed/m1_school_admin_learner_scope_VERIFY_READONLY.sql');
  const part = section === 'pre' ? text.slice(text.indexOf('-- PREFLIGHT'), text.indexOf('-- POST-APPLY')) : text.slice(text.indexOf('-- POST-APPLY'));
  await db.exec('reset role');
  return (await db.query(part.slice(part.indexOf('with expected')))).rows;
}
const failing = (rows) => rows.filter((row) => !row.ok).map((row) => row.check_name);

// What one user can reach directly through Supabase (RLS), by table.
async function reach(db, user) {
  await as(db, user);
  const ids = async (query) => (await db.query(query)).rows.map((row) => row.id ?? row.name).sort();
  const result = {
    materials: await ids('select id from public.uploaded_materials'),
    sets: await ids('select id from public.material_question_sets'),
    questions: await ids('select id from public.comprehension_questions'),
    answers: await ids('select id from public.comprehension_question_answers'),
    files: await ids('select name from storage.objects'),
  };
  await db.exec('reset role');
  return result;
}

test('today (current Staging policies) a School Admin CAN read an Independent Learner upload directly: the gap', async (t) => {
  const db = await database();
  t.after(() => db.close());
  assert.deepEqual(failing(await verify(db, 'pre')), []);
  const admin = await reach(db, 1);
  assert.ok(admin.materials.includes(id(11)), 'School Admin reads the learner material');
  assert.ok(admin.files.includes(`${id(3)}/b.pdf`), 'School Admin reads the learner file');
});

test('after the proposal a School Admin reaches no Independent Learner upload, file, set, question or answer key', async (t) => {
  const db = await database();
  t.after(() => db.close());
  const before = { teacher: await reach(db, 2), learner: await reach(db, 3), student: await reach(db, 4), system: await reach(db, 5) };
  await db.exec(PROPOSED);
  assert.deepEqual(failing(await verify(db, 'post')), []);

  assert.deepEqual(await reach(db, 1), {
    materials: [id(10), id(13)], sets: [id(20)], questions: [id(30), id(32)], answers: [id(40), id(42)], files: [`${id(2)}/a.pdf`],
  }, 'School Admin keeps Teacher material access and module questions, but nothing of an Independent Learner');
  assert.deepEqual(await reach(db, 2), before.teacher, 'Teacher access unchanged');
  assert.deepEqual(await reach(db, 3), before.learner, 'Independent Learner access to their own uploads unchanged');
  assert.deepEqual((await reach(db, 3)).materials, [id(11)]);
  assert.deepEqual(await reach(db, 4), before.student, 'Student access unchanged');
  assert.deepEqual(await reach(db, 5), before.system, 'System Admin gains nothing from these policies');
  assert.deepEqual(await reach(db, 5), { materials: [], sets: [], questions: [], answers: [], files: [] });
});

test('after the proposal a School Admin cannot change or delete Independent Learner content, but still manages the rest', async (t) => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(PROPOSED);
  await as(db, 1);
  const count = async (query) => (await db.query(query)).affectedRows;
  assert.equal(await count(`delete from public.uploaded_materials where id = '${id(12)}'`), 0, 'unused learner material is not deletable');
  assert.equal(await count(`delete from storage.objects where name = '${id(3)}/b.pdf'`), 0);
  assert.equal(await count(`update public.comprehension_questions set review_status = 'draft' where id = '${id(31)}'`), 0);
  assert.equal(await count(`delete from public.comprehension_question_answers where id = '${id(41)}'`), 0);
  await assert.rejects(db.query(`insert into public.comprehension_questions(id, material_id) values ('${id(33)}', '${id(11)}')`), /row-level security/);
  await assert.rejects(db.query(`insert into public.comprehension_question_answers values ('${id(43)}', '${id(31)}')`), /row-level security/);
  assert.equal(await count(`update public.comprehension_questions set review_status = 'reviewed' where id = '${id(30)}'`), 1, 'Teacher-material question still editable');
  assert.equal(await count(`delete from public.uploaded_materials where id = '${id(13)}'`), 1, 'unused Teacher material still deletable');
  assert.equal(await count(`delete from storage.objects where name = '${id(2)}/a.pdf'`), 1);
  // An Independent Learner still deletes their own unused upload.
  await as(db, 6);
  assert.equal(await count(`delete from public.uploaded_materials where id = '${id(12)}'`), 1);
  await db.exec('reset role');
});

test('the helpers answer false to anyone who is not a School Admin and cannot be called anonymously', async (t) => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(PROPOSED);
  for (const user of [2, 3, 4, 5]) {
    await as(db, user);
    const row = (await db.query(`select public.m1_school_admin_sees_owner('${id(2)}') a, public.m1_school_admin_sees_owner('${id(3)}') b,
      public.m1_school_admin_sees_material('${id(10)}') c, public.m1_school_admin_sees_storage_owner('${id(3)}') d`)).rows[0];
    assert.deepEqual(row, { a: false, b: false, c: false, d: false }, `user ${user}`);
  }
  await as(db, null);
  await assert.rejects(db.query(`select public.m1_school_admin_sees_owner('${id(3)}')`), /permission denied/);
  await db.exec('reset role');
});

test('rollback restores the exact current policies and removes the helpers', async (t) => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(PROPOSED);
  await db.exec(ROLLBACK);
  assert.deepEqual(failing(await verify(db, 'pre')), [], 'PREFLIGHT passes again = identical to today');
  assert.ok((await reach(db, 1)).materials.includes(id(11)), 'behaviour back to today');
});
