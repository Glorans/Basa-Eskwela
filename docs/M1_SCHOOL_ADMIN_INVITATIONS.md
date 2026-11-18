# M1 F8 — School Admin authorization record and invitation lifecycle

Status: local implementation in worktree `m1-school-admin-invitations` (branch `feat/m1-school-admin-invitations`), uncommitted. SQL `supabase/proposed/m1_school_admin_invitations_PROPOSED.sql` is **not applied** to ReadFlow-Staging. It requires `m1_account_deactivation`, which is already applied.

## Workflow

1. **Authorize (human, outside the app).** A school representative asks for a School Admin account. The System Admin confirms the request through a channel they look up independently, such as the school's official phone number, rather than a contact given in the request.
2. **Record the decision (System Admin, in the app).** Create School Admin needs:
   - the invitee's name and email;
   - the authorizing person's **position**;
   - **how** the request was confirmed;
   - an **authorization reference**;
   - an optional note.

   The app records **which System Admin** decided and **when**. The record is the System Admin's decision. It is never presented as identity or school verification, and no documents are collected.
3. **Pending.** The Auth account is created **unconfirmed**, and the signup trigger gives it a **role-less** profile. Every backend route, RLS policy, RPC and storage policy decides access from `profiles.role`, so a pending account has **no School Admin access**. A setup email is sent; the invitation is valid for 7 days from the latest send.
4. **Accept (invitee).** The invitee opens the emailed link, which confirms the email, and sets a password on Reset Password. In that same link session the page calls `POST /api/account/school-admin-invitation/accept`. Only then does `m1_accept_school_admin_invitation` set `role = 'admin'`. The database requires:
   - a pending invitation that has not expired;
   - a session created from an emailed link **after the latest send** (the `amr` sign-in method in the access token, not `last_sign_in_at`);
   - a password set;
   - the email confirmed;
   - the same email as invited;
   - an account that is not banned and still role-less.
5. **Active.** A normal School Admin. Deactivate/Reactivate applies as before.
6. **Resend** (pending or expired): renews the 7-day window and sends a new link. Sessions from older links can no longer accept.
7. **Cancel** (pending only, terminal): the Auth user is banned and the profile set inactive. The invitation cannot be reused, Forgot Password cannot revive it, and it cannot be resent or recreated for that email.

**Enforced in the database, not just the app:** the trigger `m1_guard_school_admin_role` refuses any change that makes a profile `admin`, and any role change on an invited account, unless it comes from the acceptance function. That covers self-service role selection, Teacher invite registration, backend code and manual SQL.

**Audit:** `m1_school_admin_invitation_events` records every step: authorized, invitation sent, resent, send failed, accepted, role activated and cancelled. Deactivate/Reactivate stay in `m1_account_status_events`. Both tables are backend-only, with RLS on and no browser grants.

**Existing School Admins:** no records are created for them, and their role and permissions are unchanged. System Admin sees "Authorization record unavailable (created before authorization records)". No approver or date is invented.

## Single-school limitation

There is no school relationship in the database. Every School Admin manages every Teacher and Student, and the current School Admins all share authority over the same population. An invitation does not create or represent a school. Real per-school isolation needs schools and school membership; that is a later, separately approved schema step.

## What can and cannot truthfully be claimed

| Claim | Status |
|---|---|
| Only an active System Admin can create a School Admin invitation | Enforced in the backend and the database |
| The System Admin's authorization decision, its basis and its time are recorded | Yes, for accounts created after this change |
| The invitee controlled the invited mailbox | Yes: the email is confirmed only by opening the link |
| School Admin access starts only after acceptance | Enforced in the database |
| The invitee's identity or school affiliation is verified | **No.** The app records a decision; verification is done by people outside the app |
| School Admins are isolated by school | **No** (single-school prototype) |

## Invitation email mechanism

This uses the existing password-setup email (`resetPasswordForEmail`), which already works with Staging's email setup and the Reset Password page. Verified locally against GoTrue 2.197:
- the account is created unconfirmed;
- the setup email is still sent;
- opening the link confirms the email;
- the link session carries sign-in method `otp`, timestamped after the send;
- a password session carries `password`;
- for a banned account, the link and password sign-in are both refused (`user_banned`).

`inviteUserByEmail` is **not** used. It would need a different email template and invite-type link handling on the frontend, and that full flow hasn't been tested. It isn't required for any of the guarantees above.

**Staging email limits.** Supabase's built-in email service is rate-limited; the local default is 2 emails per hour. Confirm Staging's custom SMTP and its email rate limit before relying on Resend.

## Deployment order (each step needs approval)

1. Backend. Before the SQL, Create School Admin answers 503 and leaves no account behind.
2. `..._PREFLIGHT_READONLY.sql`, then `..._PROPOSED.sql`, then `..._VERIFY_READONLY.sql`.
3. Frontend.
4. A live test with a test mailbox.

The old backend's create path (which set the role directly) is refused by the new database guard, which cleans up automatically. So applying the SQL before deploying the backend fails safely.

## MFA recommendation for System Admin (not implemented)

Supabase Auth supports TOTP MFA (`auth.mfa.enroll`, `challenge`, `verify`), and sessions report `aal1` or `aal2`.

**UI**
- Settings → Two-factor authentication: enroll by QR code, verify a code, show factor status.
- Login: after the password, a code prompt whenever the account has a verified factor.

**Backend enforcement** (later, behind a flag)
- System Admin-only endpoints require the token's `aal` claim to be `aal2`: Create School Admin, Resend, Cancel, Deactivate/Reactivate, and M3/M7 System Admin.
- Optionally, a database-side check of `auth.jwt()->>'aal'` for System Admin RPCs.

**Avoiding lockout of the only System Admin**
- Enroll **two** factors (two authenticator apps or devices) before enforcement is switched on.
- Keep the enforcement flag off until both are verified.
- Recovery path: a documented break-glass procedure that removes a factor through the Supabase dashboard. It must be done by the project owner, logged, and followed by re-enrolment.
- Better still, create a **second System Admin** account, held separately, so recovery doesn't depend on one person.

**Testing**
- Enroll, sign in with a code, and a wrong code is refused.
- `aal1` tokens are refused on privileged endpoints once enforcement is on.
- Removing a factor through the recovery path works.
- Other roles are unaffected.
- The rehearsal stack supports TOTP with no SMS needed.

**Rollout**
1. Ship the enrollment UI with enforcement off.
2. Enroll the factors.
3. Rehearse recovery.
4. Turn enforcement on.

## Release hardening (after the pre-release review)

**R1 — no waiting for ordinary users.**
- Create School Admin marks the new Auth user with `app_metadata.school_admin_invitation = true`. Only the service role can write `app_metadata`.
- Role Selection and Reset Password read that marker from the signed-in session. Ordinary accounts make **no** invitation request; Student, Teacher and Independent Learner signup and password recovery behave exactly as before.
- Invited accounts see the invitation screen immediately. Backend calls happen only on explicit actions, each bounded: accept (30 s, allowing a cold start) and "Check invitation status" (8 s).
- The marker is a display hint only. A missing marker, or a failed or timed-out lookup, never grants anything and is never treated as proof that there is no invitation. The database guard still refuses any self-selected role on an invited account.
- If an unmarked account is refused by that guard, Role Selection asks the backend once (bounded) to explain why. Other failures, such as an invalid Teacher code, make no backend request.

**R2 — two expiries, stated separately.**
- The *invitation* stays open for 7 days after the latest send (shown as "Invitation open until").
- Each *emailed link* can expire sooner, according to the Supabase Auth email-link setting. The UI does not state a fixed link duration. Its guidance: Resend, or Forgot password while the invitation is open.

**R3 — rollback safety.**
- The rollback refuses while any invitation is `pending`, including one past its window. Without the guard, a pending invitee could otherwise choose a Student or Independent Learner role.
- Resolve pending invitations first: cancel them, or let them be accepted.
- The rollback keeps the records and their history protection.

**Database privileges.**

| Who | Tables | Functions |
|---|---|---|
| anon / authenticated | no access (RLS on, no policies, no grants) | none |
| service_role (backend) | **SELECT only**: direct INSERT, UPDATE and DELETE revoked (they would otherwise come from Supabase's default privileges) | create / record email / cancel / accept (all `SECURITY DEFINER`, `search_path = ''`) |
| owner (postgres, SQL Editor) | full: trusted; can alter these objects | all |

- Events are append-only, and authorization records cannot be deleted or truncated (triggers enforce this, even for the owner unless the triggers are dropped).
- The internal helper `m1_is_active_system_admin`, the guard function and the history-protection function cannot be called by any API role.
