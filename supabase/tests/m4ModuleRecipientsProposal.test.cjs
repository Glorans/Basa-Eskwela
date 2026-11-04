// The feature gate is enabled only in this disposable PostgreSQL WASM fixture.
const { PGlite }=require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync }=require('node:fs');const { resolve }=require('node:path');
const test=require('node:test');const assert=require('node:assert/strict');
const sql=file=>readFileSync(resolve(__dirname,'../..',file),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('selected module proposal is gated, atomic and scoped to enrolled recipients',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('test.role',true) $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
  `);
  await db.exec(sql('supabase/staging/00_core_baseline.sql'));
  await db.exec(sql('readflow/supabase/migrations/20261005_m4_classroom_management.sql'));
  await db.exec(`alter table public.profiles add column teacher_status text;
    alter table public.modules add column deleted_at timestamptz;
    alter table public.room_modules add column due_at timestamptz, add column removed_at timestamptz, add column removed_by uuid;
    create table public.uploaded_materials(id uuid primary key,language text);
    create table public.reading_activity_assignments(id uuid,room_id uuid,material_id uuid);
    create table public.oral_reading_attempts(id uuid primary key default gen_random_uuid(),user_id uuid,assignment_id uuid);
    create table public.m6_comprehension_attempts(id uuid primary key default gen_random_uuid(),user_id uuid,assignment_id uuid);
  `);
  const teacher=sql('supabase/m1_teacher_verification.sql');const pos=teacher.indexOf('create function public.m1_teacher_access_allowed()');
  await db.exec(teacher.slice(pos,teacher.indexOf('$$;',pos)+3));
  await db.exec(sql('supabase/proposed/m4_room_subject_phase1_PROPOSED.sql'));
  await db.exec(sql('supabase/proposed/m4_module_recipients_PROPOSED.sql'));
  const unassign=sql('supabase/proposed/m4_unassign_PROPOSED.sql');const start=unassign.indexOf('create function public.m4_unassign_module(');
  await db.exec(unassign.slice(start,unassign.indexOf('end; $$;',start)+8));
  await db.exec(`
    insert into auth.users values ('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}'),('${id(5)}'),('${id(6)}');
    insert into public.profiles(id,role,teacher_status) values ('${id(1)}','teacher','approved'),('${id(2)}','teacher','approved'),('${id(3)}','student',null),('${id(4)}','student',null),('${id(5)}','student',null),('${id(6)}','admin',null);
    insert into public.learning_paths values ('${id(10)}','English','English','Instructional','Medium',null),('${id(11)}','Filipino','Filipino','Instructional','Medium',null);
    insert into public.modules(id,path_id,title,difficulty,status,created_by) values
      ('${id(20)}','${id(10)}','Selected','Medium','published','${id(6)}'),
      ('${id(21)}','${id(10)}','Whole','Medium','published','${id(6)}'),
      ('${id(22)}','${id(11)}','Filipino','Medium','published','${id(6)}'),
      ('${id(23)}','${id(10)}','Draft','Medium','draft','${id(6)}');
    insert into public.rooms(id,teacher_id,room_name,room_code,subject) values ('${id(30)}','${id(1)}','English','EN','en');
    insert into public.enrollments(room_id,student_id) values ('${id(30)}','${id(3)}'),('${id(30)}','${id(4)}');
  `);
  const as=async user=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.role','authenticated',false)",[id(user)]);await db.exec('set role authenticated');};
  const assign=async(module,mode='selected_students',students=[id(3)])=>(await db.query('select public.m4_assign_module($1,$2,$3,$4,null) id',[id(30),id(module),mode,students])).rows[0].id;
  const allowed=async(assignment,student)=>(await db.query('select public.m4_module_assigned_to($1,$2) allowed',[assignment,id(student)])).rows[0].allowed;
  let selected,whole;
  await t.test('selected assignments cannot be created before coordinated rollout',async()=>{
    await as(1);await assert.rejects(assign(20),/not enabled/);
    whole=await assign(21,'whole_class',[]);
    await db.exec('reset role;update public.m4_targeting_rollout set enabled=true');
  });
  await t.test('owner/approval, enrollment, subject, published state and nonempty selection are checked',async()=>{
    for(const user of [2,3,6]){await as(user);await assert.rejects(assign(20),{code:'42501'});}
    await as(1);
    await assert.rejects(assign(20,'selected_students',[]),/distinct enrolled/);
    await assert.rejects(assign(20,'selected_students',[id(3),id(3)]),/distinct enrolled/);
    await assert.rejects(assign(20,'selected_students',[id(5)]),/currently be enrolled/);
    await assert.rejects(assign(22),/language/);await assert.rejects(assign(23),/published/);
    await db.exec(`reset role;update public.profiles set teacher_status='pending' where id='${id(1)}'`);
    await as(1);await assert.rejects(assign(20),{code:'42501'});
    await db.exec(`reset role;update public.profiles set teacher_status='approved' where id='${id(1)}'`);
    await as(1);selected=await assign(20);
  });
  await t.test('recipient gets access; other enrolled Student cannot see or forge the assignment',async()=>{
    await as(3);assert.equal(await allowed(selected,3),true);
    await as(4);assert.equal(await allowed(selected,4),false);assert.equal(await allowed(selected,3),false,'no other-student probing');
    assert.deepEqual((await db.query('select id from public.room_modules where id=$1',[selected])).rows,[]);
    await assert.rejects(db.query('insert into public.room_module_recipients values ($1,$2)',[selected,id(4)]),{code:'42501'});
    await as(1);assert.deepEqual((await db.query(`update public.room_modules set targeting_mode='whole_class' where id=$1 returning id`,[selected])).rows,[]);
    await db.exec('reset role');
    assert.equal((await db.query('select targeting_mode from public.room_modules where id=$1',[selected])).rows[0].targeting_mode,'selected_students');
  });
  await t.test('future enrollment inherits Whole Class only; removal/rejoin retain selected IDs',async()=>{
    await db.exec(`reset role;insert into public.enrollments(room_id,student_id) values ('${id(30)}','${id(5)}')`);
    await as(5);assert.equal(await allowed(whole,5),true);assert.equal(await allowed(selected,5),false);
    await db.exec(`reset role;delete from public.enrollments where room_id='${id(30)}' and student_id='${id(3)}'`);
    await as(3);assert.equal(await allowed(selected,3),false);
    await db.exec(`reset role;insert into public.enrollments(room_id,student_id) values ('${id(30)}','${id(3)}')`);
    await as(3);assert.equal(await allowed(selected,3),true);
  });
  await t.test('existing Remove/Restore preserves assignment and recipient identity',async()=>{
    await as(1);await db.query('select public.m4_unassign_module($1,false)',[selected]);
    await as(3);assert.equal(await allowed(selected,3),false);
    await as(1);await db.query('select public.m4_unassign_module($1,true)',[selected]);
    await as(3);assert.equal(await allowed(selected,3),true);
    assert.deepEqual((await db.query('select * from public.room_module_recipients')).rows,[{room_module_id:selected,student_id:id(3)}]);
  });
});
