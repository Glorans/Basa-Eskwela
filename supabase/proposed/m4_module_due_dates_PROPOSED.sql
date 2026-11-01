-- PROPOSAL ONLY. Do not execute against Staging, production, or a team database without approval.
-- Team feedback B: optional deadlines for classroom MODULE assignments.
-- Activity assignments already have reading_activity_assignments.due_at (nullable), so they need
-- no database change; this adds the same optional column to room_modules.
-- No default and no backfill: existing module assignments keep "no deadline" (NULL).
-- Deadlines are informational only. Nothing here blocks late work, and no policy, grant,
-- trigger or XP rule changes: the existing teacher INSERT policy already covers the new column.
-- Not re-runnable: a second run fails on the existing column and rolls back unchanged.
-- Deploy order: apply this first, then the frontend that selects/inserts room_modules.due_at
-- (selecting the column before it exists would break module lists).
begin;
set local lock_timeout = '5s';

alter table public.room_modules add column due_at timestamptz null;

comment on column public.room_modules.due_at is
  'Optional teacher deadline shown to students. NULL means no deadline. Late work is still accepted.';

notify pgrst, 'reload schema';
commit;

-- ROLLBACK (drops any deadlines teachers have set; export them first if needed:
--   select id, due_at from public.room_modules where due_at is not null):
--   begin;
--   alter table public.room_modules drop column due_at;
--   notify pgrst, 'reload schema';
--   commit;
