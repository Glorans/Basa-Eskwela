// Proposal verification only: PostgreSQL WASM in memory, never staging.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const sql = file => readFileSync(resolve(__dirname,'../..',file),'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fn = (source,name) => {
  const start=source.indexOf(`create function public.${name}(`);
  assert.ok(start>=0);return source.slice(start,source.indexOf('$$;',start)+3);
};
test('proposed variable banks preserve six and enforce 9/12 review/publication rules',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create table public.learning_paths(id uuid primary key);
    create table public.modules(id uuid primary key,title text,path_id uuid,difficulty text,status text default 'draft',published_at timestamptz,collection_revision bigint default 0);
    create table public.progress(module_id uuid);create table public.room_modules(module_id uuid);
    create table public.module_passages(id uuid primary key,module_id uuid references public.modules(id),title text,passage_text text,display_order integer);
    create table public.comprehension_questions(id uuid primary key,module_id uuid,passage_id uuid references public.module_passages(id),question_type text,question_text text,options jsonb,scaffolding_hint text,display_order integer,generated_by_ai boolean,review_status text);
    create table public.comprehension_question_answers(question_id uuid primary key references public.comprehension_questions(id),correct_answer text,answer_explanation text,supporting_evidence text);
    create function public.m3_current_role() returns text language sql as $$ select current_setting('test.role') $$;
    select set_config('test.role','admin',false);
    insert into public.learning_paths values ('${id(10)}');
    insert into public.modules(id,title,path_id,difficulty) values ('${id(1)}','Collection','${id(10)}','Easy');
    insert into public.module_passages values ('${id(2)}','${id(1)}','Passage','A story.',1);
  `);
  const phase2=sql('supabase/m3_module_passages_phase2.sql');
  await db.exec(fn(phase2,'m3_lock_collection'));
  await db.exec(fn(phase2,'m3_collection_revision_trigger'));
  await db.exec('create trigger revisions before update on public.modules for each row execute function public.m3_collection_revision_trigger()');
  await db.exec(fn(sql('supabase/m3_module_passages_phase1.sql'),'m3_collection_publish_issues').replace('public.m3_collection_publish_issues(', 'public.m3_collection_publish_issues_phase1('));
  // The fingerprint guard needs the real installed definitions; it is exercised by
  // supabase/tests/full-schema/m3_variable_banks_full_schema_test.sql on a staging restore.
  const proposal=sql('supabase/proposed/m3_variable_passage_banks_PROPOSED.sql');
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(proposal.slice(0,proposal.indexOf('do $guard$'))+proposal.slice(proposal.indexOf('end $guard$;')+'end $guard$;'.length));
  assert.deepEqual((await db.query('select public.m3_passage_bank_sizes() s')).rows[0].s,[6,9,12]);
  const bank=count=>Array.from({length:count},(_,i)=>({type:['literal','inferential','critical'][Math.floor(i/(count/3))],questionText:`Question ${i}`,options:['A','B','C','D'],correctAnswer:'A',scaffoldingHint:'Remember the story.',answerExplanation:'A is supported.',supportingEvidence:'A'}));
  const revision=async()=>Number((await db.query('select collection_revision from public.modules')).rows[0].collection_revision);
  const save=async(questions,action,rev)=>db.query('select public.m3_save_passage_bank($1,$2,$3,$4,$5)',[id(1),id(2),rev ?? await revision(),JSON.stringify(questions),action]);
  const questions=async()=>(await db.query('select * from public.comprehension_questions order by display_order')).rows;
  const issues=async()=>(await db.query('select public.m3_collection_publish_issues($1) issues',[id(1)])).rows[0].issues;
  for(const count of [6,9,12]) await t.test(`${count} questions: balanced generate, ID-preserving review, readiness`,async()=>{
    await save(bank(count),'generate');assert.equal((await questions()).length,count);
    assert.ok((await issues()).some(issue=>issue.includes('need review')));
    const before=await questions();
    const review=bank(count).map((q,i)=>({...q,id:before[i].id}));
    await save(review,'review');assert.deepEqual((await questions()).map(q=>q.id),before.map(q=>q.id));
    assert.deepEqual(await issues(),[]);
    if(count!==6) await assert.rejects(save(bank(6).map((q,i)=>({...q,id:before[i].id})),'review'),/preserve/);
  });
  await t.test('invalid totals, unequal categories, stale revision and published content are refused atomically',async()=>{
    const before=await questions(),rev=await revision();
    for(const count of [0,3,7,15])await assert.rejects(save(bank(count),'generate'),/6, 9 or 12/);
    await assert.rejects(save(bank(9).map(q=>({...q,type:'literal'})),'generate'),/Exactly 3/);
    await assert.rejects(save(bank(6),'generate',rev-1),/changed/);
    assert.deepEqual(await questions(),before);assert.equal(await revision(),rev);
    await db.exec("update public.modules set status='published'");
    await assert.rejects(save(bank(6),'generate'),/never-published/);
    assert.deepEqual(await questions(),before);
  });
  await t.test('base readiness still rejects missing answer keys and nonadmins',async()=>{
    await db.exec('delete from public.comprehension_question_answers');
    assert.ok((await issues()).some(issue=>issue.includes('answer keys')));
    await db.exec("select set_config('test.role','student',false)");
    await assert.rejects(issues(),/Admin access/);
  });
});
