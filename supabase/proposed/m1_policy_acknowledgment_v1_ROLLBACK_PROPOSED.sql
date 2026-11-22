-- Rollback for m1_policy_acknowledgment_v1_PROPOSED.sql.                                 PROPOSED - NOT APPLIED TO STAGING
-- WARNING: deletes every stored acknowledgment (user, version, status, time) and the policy-version list. Export both
-- tables first if they must be kept. Deploy the previous frontend first, or keep the new one: without these functions
-- it skips the step (sign-in is never blocked), so the order is not critical.
BEGIN;
DROP FUNCTION IF EXISTS public.m1_acknowledge_policy(text);
DROP FUNCTION IF EXISTS public.m1_my_policy_status();
DROP TABLE IF EXISTS public.m1_policy_acknowledgments;
DROP FUNCTION IF EXISTS public.m1_policy_ack_immutable();
DROP TABLE IF EXISTS public.m1_policy_versions;
COMMIT;
