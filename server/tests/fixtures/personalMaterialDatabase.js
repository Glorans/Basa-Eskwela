const { createSecurityDatabase, sqlFile, id, asUser } = require('./m5M6SecurityDatabase');
const installed = require('./personalMaterialInstalledFunctions.json');
const ONE = 'supabase/proposed/personal_material_1_sources_PROPOSED.sql';
const TWO = 'supabase/proposed/personal_material_2_questions_PROPOSED.sql';
const owner = id(2), other = id(1);
const story = 'Ana reads a book. She shares the book with her friend.';
function bank() { return Array.from({length:9}, (_, i) => ({ id:id(900+i), type:['literal','inferential','critical'][Math.floor(i/3)],
  questionText:`Question ${i}?`, options:['A','B','C','D'], correctOptionIndex:0, scaffoldingHint:'Read the story.',
  answerExplanation:'Ana reads.', supportingEvidence:'Ana reads a book.' })); }
async function fixture() {
  const db = await createSecurityDatabase();
  await db.exec(sqlFile('supabase/migrations/20261012_m5_m6_uploaded_reading.sql'));
  await db.exec(`alter table public.uploaded_materials add column title text, add column content_text text, add column language text, add column extraction_status text;
    alter table public.modules add column source_material_id uuid;
    create table public.m7_risk_queue(id uuid primary key,generation bigint,updated_at timestamptz);
    create sequence public.m7_risk_generation;`);
  for (const row of installed) await db.exec(row[2]);
  await db.exec(`create trigger m7_completed_quiz after insert or update of status on public.m6_comprehension_attempts for each row execute function public.m7_enqueue_completion();
    create trigger m8_m6_completed after insert or update of status on public.m6_comprehension_attempts for each row execute function public.m8_on_comprehension_completed();`);
  await db.exec(sqlFile(ONE));
  await db.exec(sqlFile(TWO));
  return db;
}
async function add(db, n=500, lang='en') {
  await db.query(`insert into public.uploaded_materials(id,uploaded_by,title,content_text,language,extraction_status) values($1,$2,'Private',$3,$4,'completed')`,[id(n),owner,story,lang]);
  const state = (await db.query(`select public.personal_material_access($1,$2,'status') s`,[owner,id(n)])).rows[0].s;
  await db.query(`select public.personal_material_access($1,$2,'confirm',$3)`,[owner,id(n),state.revision]);
  return id(n);
}
async function generate(db, mat) {
  const r=(await db.query(`select public.personal_material_generation($1,$2,'begin') s`,[owner,mat])).rows[0].s;
  return (await db.query(`select public.personal_material_generation($1,$2,'finish',$3,$4) s`,[owner,mat,r.token,JSON.stringify(bank())])).rows[0].s;
}

module.exports={fixture,add,generate,bank,owner,story};
