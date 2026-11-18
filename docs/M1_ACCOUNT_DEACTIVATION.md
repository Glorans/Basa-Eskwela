# M1 F7 — Deactivate / Reactivate User Account

Status: application code in `feat/m3-system-admin` (uncommitted). SQL `supabase/proposed/m1_account_deactivation_PROPOSED.sql` is **not applied** to ReadFlow-Staging. Until it is, the endpoint answers 503 and changes nothing.

## Rules (enforced on the server and again in the database)

| Administrator | May deactivate / reactivate | Never |
|---|---|---|
| System Admin | School Admins, Independent Learners | own account, any System Admin, Teachers, Students |
| School Admin | Teachers, Students | own account, System Admins, School Admins, Independent Learners |

The last active System Admin can never be deactivated: no scope allows a System Admin target, and the database function re-checks it.

### Single-school limitation

The database has **no school relationship** (no schools table and no `profiles.school_id`). Basa Eskwela is a single-school prototype, so a School Admin manages **every** Teacher and Student account. Cross-school isolation is **not** enforced and is not claimed. Real multi-school isolation needs a schema change that has not been approved (see `docs/M1_SCHOOL_ISOLATION_PROPOSAL.md`).

## What happens

**Deactivate:**
1. The Supabase Auth user is banned. Sign-in and token refresh then stop.
2. `m1_set_account_status` sets `profiles.status = 'inactive'` and writes an audit row, in one transaction.
3. If step 2 fails, the ban is removed again and the administrator sees "No change was made".

**Reactivate:**
1. The status is saved first.
2. The ban is lifted last. If that fails, the account stays blocked, never half-open.

**Retry and reconcile:**
- User Management shows **Active (sign-in still blocked)** or **Deactivated (sign-in not blocked)** when the two steps disagree.
- **Restore sign-in** or **Block sign-in** re-applies the stored status.
- Every action, including retries, is audited, with `status_changed` recording whether the status actually changed.

**Kept:** the Auth user, its ID, email and password, the profile, role, Teacher verification, and every learning record.

**Permanent deletion:**
- `DELETE /api/admin/users/:id` answers **410** to every caller and never reaches `auth.admin.deleteUser()`. That call would cascade-delete diagnostic, oral reading, comprehension and achievement records.
- `deleteManagedUser` remains only for a future, separately approved data-deletion process, and refuses to run without an approved request ID.

## Access by an account that is already signed in

Verified 2026-11-18 on an isolated Supabase CLI stack: GoTrue 2.197, PostgREST 16.5, Storage 1.84, and Postgres 17.11 with supautils, restored from the 2026-11-18 Staging backup.

| Surface | Ban only (no SQL) | With the migration |
|---|---|---|
| Express backend (all routes, incl. speech WebSocket start) | refused, 401 | refused, 401 "deactivated" |
| Supabase Auth `/user` (password/email change) | refused, 403 `user_banned` | refused |
| Token refresh, new sign-in | refused | refused |
| Data API tables | **still allowed** until the token expires (≤ 1 h) | refused, 403 `PT403` |
| RPCs, including SECURITY DEFINER | **still allowed** | refused, 403 `PT403` |
| Storage | **still allowed** | no objects returned; writes refused |
| Realtime | not used by the app; Staging publishes 0 tables and has no Realtime policies | unchanged |
| Speech WebSocket already streaming | continues until it ends (≤ about 5 minutes of audio) | same; results cannot be saved, because saving uses refused backend routes |

## Known limitations

- **Account disclosure.** Supabase Auth answers `user_banned` to a banned account even when the password is wrong, so someone who knows an email can learn that it is deactivated. This is Auth behaviour, not app code. The alternative is a Custom Access Token hook instead of a ban, which needs an Auth configuration change and has not been approved.
- **Open speech sessions.** One that is already open is not cut off.
- **Direct database edits.** Editing `profiles.status` directly, outside the app, skips the Auth ban. Only the backend endpoint keeps the two in step.
