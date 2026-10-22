-- P3e. NOT READ ONLY, BUT LEAVES NOTHING BEHIND. Requires approval. ReadFlow-Staging
-- oudfrdeqwotynihkkmze ONLY. Run AFTER verify_b3_b7.sql P3d, as one run of the whole file.
-- Proves that the SQL editor's role can create a policy on storage.objects (through Supabase's
-- supautils policy grant, not ownership) before B3 starts, so B8 cannot be blocked later.
-- The probe policy is RESTRICTIVE and USING (false): even if it ever persisted it could only
-- deny access, never grant it. ROLLBACK discards it. Then run P3f (expect 0 storage policies).
-- Expect: "Success. No rows returned".
-- "must be owner of table objects" (42501) = STOP before B3. Do not change any owner, grant
-- supabase_storage_admin, or move the policy to another route; report the error for review.

begin;

create policy "P3e probe - rolled back"
on storage.objects
as restrictive
for select
to authenticated
using (false);

rollback;
