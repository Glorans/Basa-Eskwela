# C2/C3 staging privilege review

Prepared 2026-10-22 for **ReadFlow-Staging `oudfrdeqwotynihkkmze` only**.
User-confirmed state: B1-B26 and C1 applied and verified; P11a passed (all five M8
tables absent); C2-C8 not applied. No database connection, migration execution,
or database-backed test was performed for this review. Do not replay B1-B26/C1.

## Exact replacement files

| Step | Use this whole staging file instead of the original | Added correction |
|---|---|---|
| C2 | [c2_m8_gamification_hardened.sql](../supabase/staging/c2_m8_gamification_hardened.sql) | Revoke EXECUTE on `m8_sync_diagnostic()` and `m8_oral_completed()` |
| C3 | [c3_m8_completion_integration_hardened.sql](../supabase/staging/c3_m8_completion_integration_hardened.sql) | Revoke EXECUTE on `m8_on_module_xp_granted()` |

Every correction names the zero-argument signature and revokes from **PUBLIC,
anon, authenticated**, inside the original transaction immediately before COMMIT.
No default privileges, role memberships, service-role grants, function bodies,
triggers, policies, XP values, completion rules, badges, or leaderboards were changed.
No file under `readflow/` was modified. C4-C6 need no correction for these three gaps.

C2's only added executable SQL is:

```sql
REVOKE EXECUTE ON FUNCTION public.m8_sync_diagnostic() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.m8_oral_completed() FROM PUBLIC, anon, authenticated;
```

C3's only added executable SQL is:

```sql
REVOKE EXECUTE ON FUNCTION public.m8_on_module_xp_granted() FROM PUBLIC, anon, authenticated;
```

PUBLIC and direct role grants are separate privilege sources. PostgreSQL recommends
creating a SECURITY DEFINER function and restricting its privileges in one transaction
to avoid an exposure window ([PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)).
The original trigger definitions and function owners are preserved. These revocations
restrict direct client EXECUTE; they do not disable the installed triggers. A function
returning `trigger` also cannot be invoked as an ordinary application function; an
EXECUTE grant alone is not proof of a working arbitrary-XP RPC exploit.

## Function inventory

| Function | Created by | Intended authenticated EXECUTE |
|---|---|---|
| `m8_sync_diagnostic()` | C2 | false; corrected here |
| `m8_oral_completed()` | C2 | false; corrected here |
| `m8_grant_xp(uuid,text,uuid,integer)` | C2 | false; original already revokes all three roles |
| `m8_record_reading_day(uuid,date)` | C2; replaced by C3 | false; both originals revoke all three roles |
| `m8_weekly_leaderboard()` | C2; replaced by C3/C4 | true; PUBLIC/anon revoked |
| `m8_on_comprehension_completed()` | C3 | false; original already revokes all three roles |
| `m8_award_graduate(uuid)` | C3 | false; original already revokes all three roles |
| `m8_on_module_xp_granted()` | C3 | false; corrected here |
| `m8_award_consistent_reader()` | C5 | false; original already revokes all three roles |
| `m8_independent_leaderboard(text)` | C6 | true; PUBLIC/anon revoked |

All ten original functions are SECURITY DEFINER with an empty search_path. C2 has
five functions and two triggers; C3 has eight functions and four triggers; after C6
there are ten functions and five triggers. Do not expect the final inventory after C2.

## Tables and policies reviewed

C2 enables RLS, revokes all table privileges from anon/authenticated, then grants
authenticated SELECT on each of the following tables. There are no client write policies.
C3-C6 do not change these table grants or policies.

| Table | Policy | SELECT predicate |
|---|---|---|
| `m8_learner_progress` | `m8_self_progress` | `user_id = auth.uid()` |
| `m8_xp_events` | `m8_self_xp` | `user_id = auth.uid()` |
| `m8_badges` | `m8_all_badges` | `true` (shared catalogue) |
| `m8_earned_badges` | `m8_self_badges` | `user_id = auth.uid()` |
| `m8_reading_days` | `m8_self_days` | `user_id = auth.uid()` |

All five policies must be PERMISSIVE, SELECT, roles `{authenticated}`, with NULL
WITH CHECK. Expect exactly these five policies. The badge catalogue is intentionally
shared; the other four tables are own-row only for ordinary client table access.

The strengthened V11a checks all eight PostgreSQL 17 table privileges, column-level
access, and SELECT grant options. It catches unexpected PUBLIC/inherited privileges
through the effective client-role checks. The two replacement migrations deliberately
do not add speculative table REVOKEs: the originals already remove all direct client
table privileges before granting SELECT. Any live mismatch requires review.

## Verification procedure (for a later manual staging session)

Run each SELECT section separately and save its output. Confirm the dashboard URL
contains `/project/oudfrdeqwotynihkkmze/`; these SQL files cannot enforce project identity.
Never apply them to the team project. No earlier migration needs to be replayed.

1. Retain the already-passed P11a result. Before C2, run **P11b** in
   [verify_c2_c3.sql](../supabase/staging/verify_c2_c3.sql): expect **zero rows**.
   This additionally checks for orphaned M8 functions/triggers that P11a did not cover.
2. For C2, use the **entire** `c2_m8_gamification_hardened.sql`, including its own
   BEGIN and COMMIT. Do not also run the original or just the correction lines.
3. After C2, run **V-C2a, V-C2b, V-C2c, V-C23d** in `verify_c2_c3.sql`.
   Expect five function rows and two trigger rows, every `as_expected = true`;
   inventory **5 functions / 2 triggers**; four trusted-input rows with
   `client_can_write = false` (NULL also fails).
4. Run **V11a, V11b, V11e, V11f** in
   [verify_c2_c6.sql](../supabase/staging/verify_c2_c6.sql).
   Expect five present tables with RLS true, anon privileges empty, authenticated
   privileges exactly SELECT, all three column-level flags false; the five exact
   policies above; eight badge IDs (`bookworm`, `brave_reader`, `consistent_reader`,
   `diamond`, `first_read`, `graduate`, `level_up`, `streak_3`); totals
   **27 public tables / 70 public policies / 4 storage policies**.
   Do **not** run final-group V11c/V11d yet; C3/C5/C6 objects are intentionally absent.
5. Run [audit_stage_b.sql](../supabase/staging/audit_stage_b.sql) **A1-A8**.
   A1-A5 expect zero rows. A6 must retain its existing B-stage expectations.
   A7 may add only `m8_weekly_leaderboard()` for authenticated; none of the M8
   helpers or trigger functions may appear. Preserve other previously verified RPCs.
   A8 must match the policy inventory and totals above. A6 contains two SELECTs;
   run and save both separately.
6. Once C2 checks pass, use the entire **C3 staging replacement**. Run
   **V-C3a, V-C3b, V-C3c, V-C23d**: eight function rows, four trigger rows,
   all `as_expected = true`, inventory **8 / 4**, and no client writes to trusted
   completion tables. Repeat step 4 and A1-A8; table/policy/badge totals are unchanged.
7. Later continue C4, C5, C6 using their originals, one complete file at a time.
   After C6 run **V11a-V11f**, then **A1-A8**. V11c expects ten functions,
   every `as_expected = true`, and authenticated EXECUTE only on the two leaderboard
   RPCs. V11d expects five enabled (`O`) triggers. C7/C8 remain a separate group
   with their existing preflight and verification procedure.

**STOP on any SQL error, false/NULL expected flag, unexpected grant, policy definition,
object, or count.** Do not continue, replay a successful migration, or weaken checks.
C2 is not re-runnable because its policies are created without an existence guard.
Use separate transactions/files; do not wrap several migration files in one outer transaction.

## Remaining risks and limits

- **Diagnostic integrity:** the reviewed B3 grants/policies allow authenticated users
  to INSERT/UPDATE their own diagnostic results, including `reading_level`. C2's
  SECURITY DEFINER trigger trusts that value to set unlocked difficulty and award
  `level_up`. An eligible learner can therefore influence those results through an
  allowed table write even with direct function EXECUTE revoked. This is a concrete
  remaining integrity issue inferred from the source, not a tested live exploit.
  Closing it needs a separate change to diagnostic write authority/validation and
  is outside these behavior-preserving REVOKEs. It does not directly grant XP.
- **Definer trust and inherited grants:** table owners and trusted backend roles remain
  privileged. Unusual live role memberships or PUBLIC grants can defeat intended
  client restrictions; effective privilege checks and A1-A8 must pass. No live grant
  or RLS result has been claimed here.
- **Trigger failures affect saves:** errors in diagnostic sync, oral completion, or
  comprehension completion roll back the originating M2/M5/M6 save. C3 retains its
  future-reading-date rejection and locked-difficulty check. Catalog checks cannot
  demonstrate runtime success. Later synthetic-user behavior tests should cover M2
  saves, M5 save/retry, and M6 completion/retry with unchanged one-time XP behavior.
- **Trusted completion inputs:** M5/M6 direct browser writes must remain disabled.
  M5 counts new oral-attempt rows; its existing submission-ID uniqueness and backend
  retry handling remain responsible for duplicate prevention. These REVOKEs do not
  add broader idempotency or change completion rules.
- **Leaderboard disclosure is intentional existing behavior:** C4 returns classmates'
  UUIDs, pseudonyms, XP and difficulty; C6 returns up to 100 independent learners'
  UUIDs, nicknames/fallback names, XP and difficulty to a signed-in independent learner.
  SECURITY DEFINER RPC access is broader than own-row table SELECT. No leaderboard
  behavior was changed; its privacy implications remain.

Static validation confirmed that removing the added header and correction block
reconstructs each original migration byte-for-byte, and that the corrections lie
before the single original COMMIT. Source SHA-256 values:

```text
C2 b149cc29fb87502b87c58fba9a7a9cf4e3ee3aec22b2925534212004b7a5f3a7
C3 57a80b456f814c0811d8173111947aa0c6c3d24d9425b500ffb01a875ffddd3f
```

Validation is static only. No migrations (including offline migrations), live checks,
or behavioral tests were run in this task.
