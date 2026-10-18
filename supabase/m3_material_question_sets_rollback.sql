-- REVIEW ONLY. Safe rollback is permitted only before any new set writes.
-- After rollout usage, keep the additive schema and roll forward. Never flatten
-- multiple banks into one or drop saved sets to make old application code work.
begin;
set local lock_timeout = '5s';
lock table public.uploaded_materials, public.material_question_sets,
  public.comprehension_questions, public.comprehension_question_answers in access exclusive mode;
do $$ begin
  if exists(select 1 from public.material_question_sets where sequence_number <> 1 or revision <> 0)
    or exists(select 1 from public.uploaded_materials where next_question_set_number > 2) then
    raise exception 'Question sets have been used. Preserve all sets and roll forward; rollback refused.';
  end if;
end $$;
drop function public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb);
drop trigger comprehension_questions_set_identity on public.comprehension_questions;
drop function public.m3_protect_question_set_identity();
alter table public.comprehension_questions
  drop constraint comprehension_questions_set_material_fkey,
  drop constraint comprehension_questions_set_scope;
drop index public.comprehension_questions_set_order_key;
alter table public.comprehension_questions drop column question_set_id;
create unique index comprehension_questions_material_order_key
  on public.comprehension_questions(material_id, display_order) where material_id is not null;
drop table public.material_question_sets;
alter table public.uploaded_materials drop column next_question_set_number;
commit;
