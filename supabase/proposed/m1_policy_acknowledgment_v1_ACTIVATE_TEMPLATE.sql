-- TEMPLATE, DO NOT RUN UNTIL APPROVED: activate an APPROVED Terms of Use / Privacy Notice version.
-- Run only after the exact wording, the privacy contact, the effective date and the retention rules are approved by
-- the school, the adviser and the personal-information controller, AND the frontend showing that wording is deployed.
-- Effect: every user (all five roles) is asked once, at their next sign-in, to read and acknowledge this version.
-- Nobody is marked as agreed. Earlier draft-review acknowledgments do not count (they belong to another version).
-- Replace <version> (for example 2026-12-v1) and <note> (where the approval is recorded).
BEGIN;
UPDATE public.m1_policy_versions SET is_active = false WHERE is_active;
INSERT INTO public.m1_policy_versions (version, status, is_active, approval_note, activated_at)
VALUES ('<version>', 'approved', true, '<note>', now());
COMMIT;
SELECT version, status, is_active, approval_note, activated_at FROM public.m1_policy_versions ORDER BY created_at;
