-- TEMPLATE, DO NOT RUN UNTIL APPROVED: switch leaderboard nicknames on for ONE audience after m8_leaderboard_privacy_v1.
-- Run only after the required privacy approval is recorded (school / adviser; for children, parent or guardian
-- permission). The Terms and Privacy "I Agree" acknowledgment is NOT this approval.
-- classroom:   Students appear under their existing classroom nickname ("Maria S.") unless they chose anonymous or
--              hidden; only active members of the same active classroom see it.
-- independent: only Independent Learners who themselves chose "Display my chosen leaderboard nickname" are named.
-- To switch off again, run the same statement with false.
-- Replace <audience> with classroom or independent, and <note> with where the approval is recorded.

UPDATE public.m8_leaderboard_settings
SET names_enabled = true, approval_note = '<note>', updated_at = now()
WHERE audience = '<audience>';

SELECT audience, names_enabled, approval_note, updated_at FROM public.m8_leaderboard_settings ORDER BY audience;
