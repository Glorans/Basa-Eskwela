// Execute the corrected function against synthetic in-memory PostgreSQL tables.
// This does not apply/reapply the correction to any Supabase project.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const sql = file => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const extract = (source, name, delimiter = '$$;') => {
  const start = source.search(new RegExp(`create(?: or replace)? function public\\.${name}\\(`, 'i'));
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf(delimiter, start) + delimiter.length);
};

test('corrected passage-bank SQL generates, reviews and deletes atomically', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table public.modules(id uuid primary key, title text, status text default 'draft', published_at timestamptz,
      collection_revision bigint not null default 0);
    create table public.progress(module_id uuid); create table public.room_modules(module_id uuid);
    create table public.module_passages(id uuid primary key, module_id uuid references public.modules(id));
    create table public.comprehension_questions(id uuid primary key, module_id uuid references public.modules(id),
      passage_id uuid references public.module_passages(id), question_type text, question_text text, options jsonb,
      scaffolding_hint text, display_order integer, generated_by_ai boolean, review_status text);
    create table public.comprehension_question_answers(question_id uuid primary key references public.comprehension_questions(id),
      correct_answer text, answer_explanation text, supporting_evidence text);
    -- Identity helper only is stubbed; locking and save validation use repository SQL.
    create function public.m3_current_role() returns text language sql as $$ select current_setting('test.role') $$;
    select set_config('test.role','admin',false);
    insert into public.modules(id,title) values ('${id(1)}','Draft');
    insert into public.module_passages values ('${id(2)}','${id(1)}'), ('${id(3)}','${id(1)}');
  `);
  const phase2 = sql('supabase/m3_module_passages_phase2.sql');
  await db.exec(extract(phase2, 'm3_lock_collection'));
  await db.exec(extract(phase2, 'm3_collection_revision_trigger'));
  await db.exec('create trigger modules_collection_revision before update on public.modules for each row execute function public.m3_collection_revision_trigger()');
  await db.exec(extract(sql('supabase/proposed/m3_save_passage_bank_fix_PROPOSED.sql'), 'm3_save_passage_bank', '$function$;'));
  const bank = ['literal','literal','inferential','inferential','critical','critical'].map((type, i) => ({
    type, questionText: `Question ${i + 1}`, options: ['A','B','C','D'], correctAnswer: 'A',
    scaffoldingHint: 'Read the passage.', answerExplanation: 'The passage says A.', supportingEvidence: 'A',
  }));
  let revision = 0;
  const save = async (questions, action, expected = revision, passage = id(2)) => {
    const result = await db.query('select public.m3_save_passage_bank($1,$2,$3,$4,$5) revision', [id(1), passage, expected, JSON.stringify(questions), action]);
    revision = Number(result.rows[0].revision);
  };
  const snapshot = async () => (await db.query(`select q.*, a.correct_answer, a.answer_explanation, a.supporting_evidence
    from public.comprehension_questions q join public.comprehension_question_answers a on a.question_id=q.id order by q.display_order`)).rows;
  await t.test('generate and regenerate save six keys without the ambiguous question_id error', async () => {
    await save(bank, 'generate'); assert.equal(revision, 1);
    const first = await snapshot(); assert.equal(first.length, 6);
    assert.ok(first.every(row => row.review_status === 'generated' && row.correct_answer === 'A'));
    await save(bank, 'generate'); assert.equal(revision, 2);
    const second = await snapshot(); assert.equal(second.length, 6);
    assert.ok(second.every(row => !first.some(previous => previous.id === row.id)));
  });
  await t.test('review preserves all six IDs and saves feedback', async () => {
    const before = await snapshot();
    await save(bank.map((q, i) => ({ ...q, id: before[i].id, correctAnswer: 'B' })), 'review');
    const after = await snapshot();
    assert.deepEqual(after.map(row => row.id), before.map(row => row.id));
    assert.ok(after.every(row => row.review_status === 'reviewed' && row.correct_answer === 'B'));
  });
  await t.test('invalid count, category, key, stale revision and foreign passage leave the bank intact', async () => {
    const before = await snapshot();
    await assert.rejects(save(bank.slice(0, 5), 'generate'), /Exactly six/);
    await assert.rejects(save(bank.map(q => ({ ...q, type: 'literal' })), 'generate'), /Exactly two/);
    await assert.rejects(save(bank.map(q => ({ ...q, correctAnswer: 'Invalid' })), 'generate'), /answer key/);
    await assert.rejects(save(bank, 'generate', revision - 1), /changed/);
    await assert.rejects(save(bank, 'generate', revision, id(99)), /another module/);
    assert.deepEqual(await snapshot(), before);
    assert.equal(Number((await db.query('select collection_revision from public.modules')).rows[0].collection_revision), revision);
  });
  await t.test('nonadmin and published-module calls are rejected', async () => {
    await db.exec("select set_config('test.role','teacher',false)");
    await assert.rejects(save(bank, 'generate'), /Admin access/);
    await db.exec("select set_config('test.role','admin',false); update public.modules set status='published'");
    revision++;
    await assert.rejects(save(bank, 'generate'), /never-published drafts/);
    await db.exec("update public.modules set status='draft'"); revision++;
  });
  await t.test('deleting one bank removes its keys and preserves the other passage', async () => {
    await save(bank, 'generate', revision, id(3));
    const other = (await snapshot()).filter(row => row.passage_id === id(3));
    await save([], 'delete');
    assert.deepEqual(await snapshot(), other);
  });
});
