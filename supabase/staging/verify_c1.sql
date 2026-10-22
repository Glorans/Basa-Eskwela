-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP C1 alone (supabase/migrations/20261019_m5_recording_playback.sql: private M5
-- recordings table and bucket). Prerequisite: Stage B passed verify_b25_b26.sql and the Stage B
-- backup has been taken and checked. Run P10* before C1, V10* after it, then
-- audit_stage_b.sql A1-A8. A mismatch means STOP.

-- P10a. First install and capability. Expect recordings_table false, recordings_bucket 0,
-- can_insert_buckets true. If the bucket already exists, STOP and review: C1's ON CONFLICT
-- would overwrite its settings.
select to_regclass('public.oral_reading_recordings') is not null as recordings_table,
       (select count(*) from storage.buckets where id = 'oral-reading-recordings') as recordings_bucket,
       has_table_privilege(current_user, 'storage.buckets', 'INSERT') as can_insert_buckets;

-- V10a. Recordings table is backend-only. Expect present true, rls true,
-- anon_privileges and authenticated_privileges empty, service_role_crud true.
select c.oid is not null as present, c.relrowsecurity as rls,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         where has_table_privilege('anon', c.oid, p)), ',') as anon_privileges,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         where has_table_privilege('authenticated', c.oid, p)), ',') as authenticated_privileges,
       has_table_privilege('service_role', c.oid, 'SELECT')
         and has_table_privilege('service_role', c.oid, 'INSERT')
         and has_table_privilege('service_role', c.oid, 'DELETE') as service_role_crud
from pg_class c where c.oid = to_regclass('public.oral_reading_recordings');

-- V10b. Foreign keys. Expect 2 rows, both ON DELETE CASCADE:
-- attempt_id -> oral_reading_attempts(id), user_id -> auth.users(id).
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = to_regclass('public.oral_reading_recordings') and contype = 'f'
order by 1;

-- V10c. Private recordings bucket. Expect 1 row: public false, file_size_limit 26214400,
-- allowed_mime_types exactly audio/webm, audio/ogg, audio/mp4, audio/wav.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'oral-reading-recordings';

-- V10d. Authorized playback stays server-side. Expect 0 rows: no storage.objects policy
-- mentions the recordings bucket, so browsers cannot list or read recordings directly.
-- The backend checks the owner/approved teacher and issues short-lived signed URLs.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') like '%oral-reading-recordings%'
    or coalesce(with_check, '') like '%oral-reading-recordings%');

-- V10e. Checkpoint totals. Expect public_tables 22, public_policies 65, storage_policies 4.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;
