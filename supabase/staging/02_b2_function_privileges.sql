-- STAGING ONLY (B2a). Not yet executed. ReadFlow-Staging oudfrdeqwotynihkkmze.
-- FALLBACK ONLY. The normal route is supabase/staging/02_b2_hardened.sql, which already
-- contains these two statements inside B2's transaction. Run this file only if B2 was applied
-- on its own; then run it immediately, before B3, and verify with verify_b2.sql V2e.
--
-- Supabase default privileges grant EXECUTE on new public functions directly to
-- anon and authenticated. B2 revokes only PUBLIC from its two internal trigger
-- functions, so those direct grants survive. Neither role needs to call them:
-- PostgreSQL checks trigger-function EXECUTE only when CREATE TRIGGER runs, not
-- when the trigger fires, so signup (on_auth_user_created) and the profile
-- protection trigger keep working.
--
-- assign_own_role(text) is deliberately untouched: B2 already revokes PUBLIC/anon
-- and grants authenticated, which the role-selection RPC requires.
-- Idempotent; safe to re-run. Changes no definitions, triggers, tables or defaults.
begin;

revoke execute on function public.handle_new_user()
from public, anon, authenticated;

revoke execute on function public.m1_protect_profile_authorization_fields()
from public, anon, authenticated;

commit;
