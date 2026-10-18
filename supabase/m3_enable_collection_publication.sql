-- M3 only. Apply manually AFTER passage phases 1/2 and deployment of both
-- passage-aware learner viewers. No tables/data, grants or RLS are removed.
begin;

-- Refuse out-of-order rollout: ordinary validation must already be active.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.modules'::regclass
      and tgname = 'modules_collection_publish_validation'
      and tgfoid = 'public.m3_validate_collection_publish()'::regprocedure
      and tgenabled = 'O' and not tgisinternal
  ) or pg_catalog.to_regprocedure('public.m3_collection_publish_issues_phase1(uuid)') is null then
    raise exception 'Install M3 passage Phase 2 publication validation first';
  end if;
end;
$$;

create or replace function public.m3_validate_collection_publish() returns trigger
language plpgsql security definer set search_path = '' as $$
declare issues text[];
begin
  if new.status='published' and old.status is distinct from 'published' then
    issues:=public.m3_collection_publish_issues(new.id);
    if cardinality(issues)>0 then raise exception '%',array_to_string(issues,'; '); end if;
    -- Preserve modules_published_passage_check and existing legacy text.
    -- New normalized drafts have no legacy text; copy the validated first
    -- passage only on publication. Learner M3 delivery still uses all passages.
    if nullif(pg_catalog.btrim(new.passage), '') is null then
      select p.passage_text into new.passage from public.module_passages p
        where p.module_id = new.id order by p.display_order limit 1;
    end if;
  end if;
  return new;
end;
$$;

-- Retire only the delivery rollout gate. Keep marker data and helper functions
-- because existing draft writers still reference them; they no longer gate publication.
drop trigger if exists modules_pending_collection_publish on public.modules;
commit;
