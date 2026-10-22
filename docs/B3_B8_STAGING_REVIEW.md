# B3–B8 staging review: Storage policy route and privilege fixes

Prepared 2026-10-22 for **ReadFlow-Staging only**, project ref `oudfrdeqwotynihkkmze`. No database
connection was opened and no SQL was executed against any Supabase project. No historical migration
file was edited.

User-reported state: B1 and B2 applied and verified. P3a and P3b passed. **P3c failed**:
`storage_objects_owner = supabase_storage_admin`, `can_create_storage_policies = false`,
`is_superuser = false`. B3–B8 have not been executed.

**Decision (pending approval):** P3c stays recorded as FAILED. Continue by a reviewed alternative
route: Supabase's documented policy grant for the SQL editor role, proved first by one rolled-back
probe (P3e). Apply B3, B7 and B8 as hardened bundles that close the known default-privilege gaps in the
same transaction. Do not use the dashboard policy editor unless this route fails and the fallback below
is reviewed separately.

## Why P3c is false, and why that does not decide B8

P3c asks the plain-PostgreSQL question "is the current role the owner of `storage.objects`, or a member
of the owner role?". On Supabase the answer is now always no: `storage.objects` belongs to
`supabase_storage_admin`, and `postgres` is not a superuser. In plain PostgreSQL only the owner may run
`CREATE POLICY`, so P3c was written as a hard gate.

Supabase adds a second path. Its Postgres image loads the `supautils` extension, and the platform
configuration (`supabase/postgres`, `ansible/files/postgresql_config/supautils.conf.j2`) sets
`supautils.policy_grants` so that the `postgres` role may create, alter and drop policies on 24 managed
tables, including `storage.objects` and `storage.buckets`, **without owning them**. That is how the
SQL editor, which runs as `postgres`, still creates Storage policies after Supabase's 2025 restrictions on
the `auth`/`storage` schemas. What remains forbidden is `ALTER TABLE storage.objects` and other
owner-only DDL, and B8 contains none.

P3c cannot see this grant, so it reports false either way. The grant cannot be fully proved by a
catalog query either: `pg_settings` may hide the setting from `postgres`. The definitive test is the
one rolled-back probe P3e.

## B8: every Storage operation

From `supabase/m3_content_rls.sql`:

| Line | Operation | Needs |
|---|---|---|
| 126–143 | `m3_material_file_is_absent(uuid)`, SECURITY DEFINER, **reads** `storage.objects` (bucket `reading-materials`) | its owner (`postgres`) must have SELECT on `storage.objects` (P3d/P4c `postgres_can_read_objects`) |
| 145–166 | `m3_storage_object_is_deletable(text)`, used by the DELETE policy; reads only `public.uploaded_materials` | — |
| 551–565 | `DROP POLICY IF EXISTS` + `CREATE POLICY "M3 uploaders create own reading material objects"` on `storage.objects`, INSERT | the supautils policy grant |
| 567–582 | same for `"M3 owners and admins read reading material objects"`, SELECT | the supautils policy grant; `storage.foldername(text)` executable by authenticated |
| 584–600 | same for `"M3 owners and admins delete reading material objects"`, DELETE | as above |

B8 does **not**: insert or update `storage.buckets` (the bucket is Stage A3, by hand), alter
`storage.objects`, change its RLS setting, or create an UPDATE policy (deliberate: no overwrite/move).

Later groups that touch Storage: B16 adds one RESTRICTIVE `FOR ALL` policy on `storage.objects` (same
grant; checked again by P6a/P4c). C1 inserts the `oral-reading-recordings` row into `storage.buckets`
(data, not a policy; checked by P10a).

The app depends on these policies. The browser uploads and cleans up with the user's own session
(`readflow/src/modules/module3/services/materialUpload.ts:137`, `:165`), so the INSERT and DELETE
policies are on the live path. The server uses its own service-role client for `info` and `remove`
(`server/routes/materials.js:238`, `:264`; `server/services/materialPersistenceService.js:588`), which
is the existing design and is unchanged.

## Dashboard → Storage → Policies

The dashboard policy editor (Storage → Policies → bucket → New policy → "For full customization")
is a supported way to write policies on `storage.objects`. It asks for a name, the allowed operations,
the target roles and one definition expression. It can technically install B8's three policies, but it
is **not** the recommended route here:

- **It is not a separate privilege path, as far as I can tell.** I found no Supabase documentation of
  the role the editor uses. My understanding is that it generates the same `CREATE POLICY` statement and
  sends it through the same database connection as the SQL editor, so it depends on the same supautils
  grant. If P3e fails, expect the dashboard to fail too. Treat this as unverified.
- **It breaks atomicity.** B8 creates the helper functions, grants, 18 table policies and 3 Storage
  policies in one transaction. Moving the Storage part to the dashboard leaves a committed state where
  materials can be inserted without an upload path, and the policies are no longer in a reviewed file.
- **It can alter names.** The editor may append a generated suffix to policy names, which breaks the
  name-based checks (V4c, V4d) and B8's `DROP POLICY IF EXISTS` idempotence.
- **It cannot express B16.** B16's Storage policy is `AS RESTRICTIVE FOR ALL`. The editor creates
  permissive policies, so B16 must stay SQL regardless.

**Reference only (fallback; needs its own review first).** If Supabase support confirms the dashboard
uses a different role and the SQL route is unavailable, these are the exact entries derived from B8.
B8 would then also need a separately reviewed "public part only" file. Never cut the Storage section out
of the bundle by hand.

| # | Policy name | Operation | Target role | USING | WITH CHECK |
|---|---|---|---|---|---|
| 1 | `M3 uploaders create own reading material objects` | INSERT | `authenticated` | — | `bucket_id = 'reading-materials' and public.m3_current_role() in ('teacher', 'general_user') and name ~ ('^' \|\| auth.uid()::text \|\| '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf\|docx\|jpg\|jpeg\|png)$')` |
| 2 | `M3 owners and admins read reading material objects` | SELECT | `authenticated` | `bucket_id = 'reading-materials' and (public.m3_current_role() = 'admin' or (public.m3_current_role() in ('teacher', 'general_user') and (storage.foldername(name))[1] = auth.uid()::text))` | — |
| 3 | `M3 owners and admins delete reading material objects` | DELETE | `authenticated` | `bucket_id = 'reading-materials' and (public.m3_current_role() = 'admin' or (public.m3_current_role() in ('teacher', 'general_user') and (storage.foldername(name))[1] = auth.uid()::text)) and public.m3_storage_object_is_deletable(name)` | — |

Copy the expressions from B8 itself (lines 558–564, 574–581, 591–599), not from this table. Order: 1, 2, 3, and only after the helper
functions exist. One operation per policy, never "all operations", never `anon` or `public`, no UPDATE
policy. V4h checks these by definition, so it works whatever names the editor stores.

## What stays SQL

Everything. The hardened bundles below are the route: B3, B4–B6, B7 and B8 in the SQL editor, each
file whole. B16's RESTRICTIVE Storage policy also stays SQL. The only manual dashboard step is creating
the private `reading-materials` bucket (Stage A3), which no migration does.

## Privilege fixes, closed before installation

Three bundles follow the B2 pattern: the source migration byte for byte, with REVOKE-only statements
added inside its transaction. No definitions, policies or app behaviour change.

| Bundle | Source | Added statements | Closes |
|---|---|---|---|
| `supabase/staging/03_b3_hardened.sql` | `supabase/diagnostic_results.sql`, wrapped in `begin; … commit;` (B3 has none) | `REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.diagnostic_results FROM authenticated;` and `REVOKE EXECUTE ON FUNCTION public.set_diagnostic_updated_at () FROM PUBLIC, anon, authenticated;` | B3 diagnostic gap: authenticated keeps exactly SELECT, INSERT, UPDATE |
| `supabase/staging/07_b7_hardened.sql` | `supabase/m3_content_schema.sql` (working copy) | `REVOKE ALL ON TABLE` the three new content tables `FROM anon, authenticated;` and `REVOKE EXECUTE` on its six trigger functions `FROM PUBLIC, anon, authenticated;` | the B7→B8 window: no client access to the content tables until B8's column-scoped grants |
| `supabase/staging/08_b8_hardened.sql` | `supabase/m3_content_rls.sql` | `REVOKE EXECUTE` on the seven SECURITY DEFINER helpers `FROM anon;` (authenticated keeps EXECUTE) | B8 helpers callable by anon over the API |

Why these are safe:

- PostgreSQL checks EXECUTE on a trigger function only when the trigger is created, not when it fires.
  The dry run confirmed that the `updated_at` trigger still fires for an authenticated session after the
  REVOKE.
- Nothing in the app deletes or truncates `diagnostic_results`, and no later migration grants on it
  (repository search).
- With B7a, B8 no longer has to follow B7 immediately for security. A gap between them leaves M3 not
  working, but nothing exposed.
- B9 later re-grants `m3_can_read_module` to authenticated only. It does not restore anon.

`service_role` grants are untouched in all three bundles.

## Checkpoint changes (no result is relabelled)

- **P3c**: unchanged query. Its comment now records the 2026-10-22 FAIL and says not to rerun it for a
  different answer.
- **P3d** (new, read-only): `current_user` is `postgres`; RLS is on for `storage.objects`; `postgres`
  can read it; `storage.foldername` is executable; the supautils setting (true, or NULL if hidden); 0
  existing Storage policies; the bucket is private with a 25 MiB limit.
- **P3e** (new, `supabase/staging/probe_p3e_storage_policy.sql`, not read-only): `begin;` one
  RESTRICTIVE `USING (false)` probe policy, then `rollback;`. It can only deny access, and it is discarded.
- **P3f** (new, read-only): 0 Storage policies after the probe.
- **P4a / P6a**: still run, still expected false on live staging, and documented as not a pass. The
  gate is P3e (recorded) plus **P4c** (new, P3d rerun before B8) and, for B16, V4h having passed.
- **V3e / V3g / V4a**: the expectations now assume the bundles (no client EXECUTE on trigger functions,
  no client privileges on the three content tables after B7, no anon EXECUTE on the helpers).
- **V4h** (new): the three Storage policies matched by operation, role and definition text.
- **V4i** (new): `storage.objects` and `storage.buckets` are still owned by `supabase_storage_admin`
  with RLS on, which proves the route changed no managed ownership.

## Manual steps in Supabase (after approval, in this order)

1. Open the SQL editor and confirm the URL contains `/project/oudfrdeqwotynihkkmze/`.
2. If it doesn't exist yet, create the bucket (Storage → New bucket): `reading-materials`, **private**,
   25 MiB, MIME types `application/pdf`,
   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/jpeg`, `image/png`.
   Do not add any policy in the dashboard.
3. Run `verify_b3_b7.sql` **P3d** and save the output. Every value must match its expected result.
4. Run the whole of `probe_p3e_storage_policy.sql` once. Expect "Success. No rows returned". An error
   means STOP: send me the exact message.
5. Run **P3f**. Expect 0. Record P3c as FAIL (ownership) and P3d–P3f as the alternative-route pass.
6. Check the hashes below, then run, one file per run, stopping at the first error:
   `03_b3_hardened.sql` → `diagnostic_results_language.sql` → `diagnostic_results_bilingual.sql` →
   `diagnostic_results_sentence_versions.sql` → `07_b7_hardened.sql`.
7. Run V3a–V3h, then `audit_stage_b.sql` A1–A8, one section at a time. Stop on any mismatch.
8. Run `verify_b8.sql` P4a (expect the same FAIL as P3c, record it), P4b (0 rows) and P4c.
9. Run `08_b8_hardened.sql` whole. If it errors, it has rolled back entirely: STOP and report. Do not
   rerun parts of it.
10. Run V4a–V4i, then A1–A8. Expect 24 public and 3 Storage policies, and V4i unchanged ownership.

Never use the service-role key for any of this, never change an owner, and never add a placeholder or
permissive policy.

## Offline validation

- Static: each bundle, minus its header comments and the added REVOKE lines, is byte-identical to its
  source (checked with `cmp`/`diff`). Each has exactly one `BEGIN` and one `COMMIT`.
- Dry run (in-memory PostgreSQL via PGlite 0.5.8, stand-ins for Supabase roles, default privileges and
  the `auth`/`storage` schemas, with `storage.objects` owned by a separate `supabase_storage_admin`
  role): B1 → B2 bundle → B3 bundle → B4–B6 → B7 bundle → B8 bundle applied cleanly. P3a–P3f, V3a–V3h,
  P4a–P4c, V4a–V4i and A1–A8 ran without SQL errors and matched every expectation. In particular, V3e
  and V3g are now clean, V4a anon is false, V4h is 3/3 true and V4i shows unchanged ownership.
- Probe: as a non-owner role without supautils, P3e failed with `must be owner of table objects`,
  exactly the live failure mode. As a role that may create the policy it succeeded, and P3f returned 0.
- Behaviour: an authenticated session could insert and update its own diagnostic row (trigger fired),
  and was denied DELETE, TRUNCATE and a direct call to the trigger function.
- Not proven offline: supautils itself (PGlite has none), whether `pg_settings` shows the setting to
  `postgres` on the platform, and the dashboard editor's database role. P3d/P3e answer the first two
  live.

## Hashes

| File | SHA-256 |
|---|---|
| `supabase/diagnostic_results.sql` | `2977eed5c008a80b8b92f4d947e315733181c018702dff3de9be551c1aebfffd` |
| `supabase/diagnostic_results_language.sql` | `939f7bd3b9f62a3d568305941e5b398562b5626824b0c197c213fcbd0be178c8` |
| `supabase/diagnostic_results_bilingual.sql` | `74eca35e9aa2fe6dbf17a1529c07402544d8baa952c04722757ac8a6d021f137` |
| `supabase/diagnostic_results_sentence_versions.sql` | `ef642d583f3647400abd65473bd88d798fa490d35fdc22a4a40597e911ed6898` |
| `supabase/m3_content_schema.sql` (working copy) | `85eecaf6e0e3b0c8f056178d26fda09364a4e2c87fd7e4fe04280eb64dd627e7` |
| `supabase/m3_content_rls.sql` | `674f9f6860e48572f280d2fb6d9569d9b2c7e5258b6db6e6800a031de16fe165` |
| `supabase/staging/03_b3_hardened.sql` | `ab9697bba91136aaa6bb95d3d384eda85464116ae72dc0937bfbbcb605d9d4e0` |
| `supabase/staging/07_b7_hardened.sql` | `961dad4bcf91cd720cba56541b648ad5f9f62e76459176a858bf05e8b29d7451` |
| `supabase/staging/08_b8_hardened.sql` | `bd4da62109f64a800981a4ec3396ebfdb7bcc52ff98e4cc3f3ea56cba0486150` |
| `supabase/staging/probe_p3e_storage_policy.sql` | `bea33c1c1e0f2a6ba427d9e5d1991293e2983ce61fa85bada87b657b2f68bd19` |

Re-check these before running a file. A different hash means the file changed after review.

## Documentation checked

- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control):
  policies on `storage.objects`, upload needs INSERT only, upsert also needs SELECT and UPDATE.
- [supabase/supautils](https://github.com/supabase/supautils): `policy_grants` lets a role manage
  policies on tables it does not own.
- [supabase/postgres `supautils.conf.j2`](https://github.com/supabase/postgres/blob/develop/ansible/files/postgresql_config/supautils.conf.j2):
  `policy_grants` for `postgres` includes `storage.objects` and `storage.buckets`.
- [GuardLayer: "must be owner of table objects"](https://www.guardlayer.io/blog/supabase-42501-must-be-owner-of-table-objects)
  (third party): `ALTER TABLE storage.objects` fails, `CREATE POLICY` remains allowed.
- [PostgreSQL 17 CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html) and
  [CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html): owner requirement;
  EXECUTE checked when the trigger is created.
