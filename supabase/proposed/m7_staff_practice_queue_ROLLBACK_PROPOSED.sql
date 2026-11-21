-- ROLLBACK for m7_staff_practice_queue_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Restores public.m7_enqueue_completion() byte-for-byte (md5 563885607c852a10581f83699c7efd74 on ReadFlow-Staging).
begin;
set local lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.m7_enqueue_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.material_id is not null and new.activity_assignment_id is null and new.room_id is null then return new; end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and not exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'admin') then
    insert into public.m7_risk_queue(id) values (new.user_id)
    on conflict(id) do update set generation = nextval('public.m7_risk_generation'), updated_at = now();
  end if;
  return new;
end; $function$;
commit;
