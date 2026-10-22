# B2 staging review and execution decision

Prepared 2026-10-22 for **ReadFlow-Staging only**, project ref `oudfrdeqwotynihkkmze`. No database
connection was opened and no SQL was executed against any Supabase project. Historical migration files
were not edited.

User-reported baseline: B1 succeeded; V1a–V1g passed (seven core tables, RLS on, 13 indexes).
PostgreSQL is 17.11. V0 found no auth users or storage objects. Live staging has Supabase's default
EXECUTE grants on new public functions for anon and authenticated.

**Decision: run B2 as the hardened bundle `supabase/staging/02_b2_hardened.sql`.** It is B2
(`supabase/m1_onboarding_security_migration.sql`, SHA-256
`f6c8d819081c41e95e96526f66bef66bfa32a209533a08f3b3a68de68f53c29e`, unchanged) with the two B2a
statements from `supabase/staging/02_b2_function_privileges.sql` inserted before B2's `COMMIT`:

```sql
REVOKE EXECUTE ON FUNCTION public.handle_new_user () FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.m1_protect_profile_authorization_fields () FROM PUBLIC, anon, authenticated;
```

Both run in one transaction (one `BEGIN`, one `COMMIT`, 28 statements): either B2 and its privilege fix
both apply, or neither does, and there is never a committed state with client-executable trigger
functions. `assign_own_role(text)` is untouched: B2 itself revokes PUBLIC/anon and grants authenticated.
File hashes are listed under "Hashes" below.

The separate `02_b2_function_privileges.sql` is now a **fallback only**, for the case where B2 was
already applied on its own; then run it immediately, before B3. Do not run both routes.

## When to run each file

1. Confirm the dashboard URL shows `oudfrdeqwotynihkkmze`.
2. Run `supabase/staging/preflight_b2.sql` P2a–P2i one section at a time. Every result must match its
   "Expect" line. Keep the output.
3. Only after approval, run the whole of `supabase/staging/02_b2_hardened.sql` once.
4. Immediately run `supabase/staging/verify_b2.sql` V2a–V2m. Every result must match before B3.
5. Never run B2 or the bundle again, and never after B16 (it would restore the older teacher-selecting
   role RPC and the older protection-trigger body).

## Remaining blockers for B2

None at source level, and the offline dry run passed. B2 stays conditional on the live preflight:
P2a (`can_create_signup_trigger` and ownership of `profiles`), P2c (still 0/0/0), P2d (functions absent),
P2e (no existing auth/profile triggers) and P2f (event triggers as expected). Keep registration closed
until B16 and the later chain are complete (risk 3).

## B2 review

| Surface | Finding |
| --- | --- |
| B1 profile schema | All referenced columns exist. `nickname` is the only new column. B1 permits a NULL role and supplies `status='active'` and `created_at=now()`, so the signup INSERT is complete. The primary key supports ON CONFLICT(id), and the auth FK is appropriate for an AFTER INSERT trigger. No tables or indexes are added or dropped. |
| Signup | `on_auth_user_created` is AFTER INSERT on auth.users, invoking `handle_new_user()` as SECURITY DEFINER. It creates one role-neutral profile, ignores user metadata, and preserves an existing profile on conflict. It does not backfill auth users created before the trigger. |
| Protection | `profiles_protect_authorization_fields` is BEFORE UPDATE, invoking the SECURITY INVOKER protection function. For an authenticated JWT it protects id, status, created_at and disallowed role changes. The exception permits an own-profile NULL-to-teacher/student/general_user transition. Column grants still prevent a direct browser role UPDATE. |
| Role RPC | `assign_own_role(text)` is SECURITY DEFINER. It requires auth.uid(), accepts only teacher/student/general_user, and atomically updates the caller's row only while role IS NULL. It rejects admin, NULL/unknown role values and a second assignment. There is no caller-supplied target-user parameter. Concurrent attempts cannot both commit a first assignment to the same row. |
| Function safety | All three functions pin search_path to the empty string; application and auth references are qualified. The two definer functions need a trusted owner with profile access/RLS bypass (normally the same owner as B1, with FORCE RLS off). Do not apply as anon/authenticated. |
| Grants | B2 revokes table privileges from anon/authenticated. It grants authenticated SELECT on six specific profile columns and UPDATE on full_name/nickname only. No client INSERT, DELETE, role/status UPDATE or table-wide SELECT/UPDATE is intended. B1 service_role grants remain. The role RPC revokes PUBLIC/anon EXECUTE and grants authenticated EXECUTE. |
| Policies | Exactly two new permissive policies on profiles: own-row SELECT, and own-row UPDATE with both USING and WITH CHECK id=auth.uid(). No recursive profile query. B1's learning_paths policy remains, giving three public policies total. No profile INSERT/DELETE policy. |
| Role constraint | Replaces the existing four-value role check with the same domain plus NULL, but uses NOT VALID. This still enforces future writes. `convalidated=false` is therefore expected; a separate VALIDATE CONSTRAINT step would be optional hardening, not part of unchanged B2. |
| PostgreSQL 17.11 | ALTER TABLE, column grants, trigger functions, EXECUTE FUNCTION, RLS, ON CONFLICT and CHECK NOT VALID are supported. No extension or version-specific workaround is needed. Statically reviewed and dry-run on PostgreSQL 17.5 (PGlite); not yet executed on 17.11. |
| Storage | No storage schema, bucket, storage function, or storage-policy operation occurs in B2. `can_create_storage_policies=false` does not block it. |

## Risks and outstanding gates

1. **Event trigger evidence:** Supabase's documented ensure_rls runs at
   ddl_command_end only for CREATE TABLE, CREATE TABLE AS and SELECT INTO. B2
   executes none of these commands, so that standard definition cannot fire for
   B2. B2 also does not replace the event trigger or its function. The live name
   alone is insufficient to prove those filters: inspect P2f in the preflight.
   Broader/custom filters require review. Live staging also has six Supabase
   platform event triggers (issue_graphql_placeholder, issue_pg_cron_access,
   issue_pg_graphql_access, issue_pg_net_access, pgrst_ddl_watch, pgrst_drop_watch);
   P2f lists them. Any other event trigger requires review.
   Do not disable ensure_rls or platform triggers to make a migration pass.
2. **Signup availability:** a failed AFTER INSERT profile trigger aborts signup.
   The source has no missing-column/default conflict against B1, but verify the
   migration role's privileges and the resulting function owner. The user did
   not paste the actual can_create_signup_trigger boolean; P1 checks it directly.
   Inspect all existing auth row triggers: B2 drops only the named trigger, not
   every signup trigger. Dropping an existing trigger requires table ownership
   rights, whereas creating one requires TRIGGER plus function EXECUTE.
3. **Keep staging closed through the chain:** B2 allows teacher selection without
   an invite, email confirmation or approval check in this RPC. B16 replaces it
   with learner-only role selection and invite-based teacher registration.
   B16 automatically approves teachers already present. Do not create persistent
   teacher test accounts before B16; do not expose partial migrations to users.
4. **Current app requires later migrations:** `authProfile.ts` selects
   teacher_status and uses the B16 teacher RPC; profile completion writes age
   from B17. The entire current onboarding UI is not expected to work after B2
   alone. Later diagnostic/content migrations are also needed for normal flows.
5. **Default grants:** PUBLIC revocation is not removal of direct grants to
   anon/authenticated. B2's two trigger functions revoke only PUBLIC and may
   retain direct EXECUTE from Supabase defaults. They return trigger and cannot
   be called as ordinary RPCs, so this is not by itself a registration or role
   escalation blocker. Live staging confirmed the defaults exist, so the B2 bundle
   revokes EXECUTE from PUBLIC, anon and authenticated on those two internal helpers
   inside B2's transaction (verify with V2e).
   The role RPC already explicitly revokes anon. Table revocation also does not
   erase pre-existing column grants; fresh B1 avoids that issue, and V2h/V2i inspect
   effective access including PUBLIC/inherited privileges.
6. **Scope of protection:** B2 does not implement account-status suspension or
   require confirmed email in assign_own_role. The protection trigger keys off
   auth.role(), so it is not an independent barrier for arbitrary SQL sessions
   with missing/forged claims. Normal clients rely on trusted JWTs, column grants,
   RLS and the controlled RPC. Test using actual client roles/claims, not only the
   SQL editor's privileged role.
7. **Never replay B2 after B16:** it would restore the older teacher-selecting RPC
   and replace the stronger authorization trigger body. Migration order matters
   even where CREATE OR REPLACE or IF EXISTS makes a file look rerunnable.

## Offline validation

- Static: every statement in `preflight_b2.sql` and `verify_b2.sql` parses as a SELECT. The bundle,
  minus its header comments and the two REVOKE lines, is identical to B2; the REVOKEs precede its single
  `COMMIT`.
- Dry run: in an in-memory PostgreSQL 17.5 (PGlite) with Supabase-like roles, default privileges and
  `auth`/`storage` stand-ins, B1 then the bundle applied cleanly; P2a–P2i and V2a–V2m ran without errors
  and matched every expected result.
- Behaviour (same dry run): a non-superuser Auth-like role inserting into `auth.users` still fires the
  signup trigger, creating one profile with an empty name and NULL role (forged `role: admin` metadata
  ignored); anon and authenticated cannot call either trigger function; anon cannot call
  `assign_own_role`; authenticated can assign `student` once, cannot choose `admin`, cannot reassign;
  direct role/status updates are denied; own nickname/full name updates work; other profiles are invisible.
  14 of 14 checks passed.
- Not proven: the managed platform itself (Supabase Auth's real role, `ensure_rls`'s real body, platform
  event triggers). The live preflight and verification remain required.

After application, a controlled live behaviour test should repeat the behaviour checks with real
synthetic accounts and client sessions (never service_role). Before B16, any teacher test must be isolated
and rolled back; after B16, test invitation, email verification and pending/approved/rejected behaviour.

## Later groups

The full B3–C8 checklist, its verification files and the known default-privilege gaps found offline are in
[STAGING_DATABASE_SETUP_PLAN.md](STAGING_DATABASE_SETUP_PLAN.md). Those gaps do not affect B2.

## Hashes

| File | SHA-256 |
|---|---|
| `supabase/m1_onboarding_security_migration.sql` | `f6c8d819081c41e95e96526f66bef66bfa32a209533a08f3b3a68de68f53c29e` |
| `supabase/staging/02_b2_hardened.sql` | `1ca110f97b5aaacf9576fd2ba595a73405882bd397ce17c43e3bdd33f3179826` |
| `supabase/staging/02_b2_function_privileges.sql` | `9ad5f99b0bd9377bd6ac99b8c04ce593f7f60cffa17a45a410198f8af9ac793e` |

Re-check these before running a file; a different hash means the file changed after review.

## Documentation checked


- [PostgreSQL 17 CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html)
  and [DROP TRIGGER](https://www.postgresql.org/docs/17/sql-droptrigger.html): syntax
  and distinct creation/removal privilege requirements.
- [PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html):
  ownership, definer security and function grants.
- [PostgreSQL 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html):
  CHECK NOT VALID still enforces new writes.
- [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
  and [REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html): RLS limits and
  effective versus direct grants.
- [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data):
  signup-trigger pattern and signup failure risk.
- [Supabase event triggers](https://supabase.com/docs/guides/database/postgres/event-triggers):
  standard ensure_rls tag filters and rls_auto_enable definition.
