-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- M8 F1 Earn Points, v1: per-passage XP, module completion bonus, daily login bonus,
-- and the trusted M5 reading evidence they need.
-- ============================================================================
--
-- ENGLISH FIRST. The new passage and module rewards apply to English activities only.
--   Language comes from the source (uploaded_materials.language, or the module's learning path),
--   never from the page and never from the attempt alone: m8_activity_language.
--   Filipino keeps the rewards it has today, unchanged, through the same trigger: 60 per assigned
--   material; 30/50/80 once per module, capped by the Independent Learner's level. Filipino readings are
--   still verified, but earn no new passage XP and no +50. Each completion takes exactly one path, so
--   old and new rewards cannot both be granted. Activating Filipino later needs its own reviewed
--   migration (m8_performance_language). The daily login applies to every learner, in any language.
--
-- Rewards on the new path (the same for Students and Independent Learners; Admins and Teachers earn none)
--   Passage with required M6:  round(20 + 0.4 x ReadingAccuracy + 0.4 x ComprehensionScore)
--   Read-aloud-only passage:   round(20 + 0.8 x ReadingAccuracy)
--   Whole module completed:    +50, once per module family
--   Daily login:               +10, once per Asia/Manila calendar date
--   Rounding is exact integer arithmetic on the saved counts; halves round up.
--
-- Trusted M5 evidence
--   The browser sends the transcript with the saved reading, so a saved reading alone proves
--   nothing. /api/read-aloud/audio records the SHA-256 of each Azure transcript here
--   (m5_transcript_receipts), bound to the signed-in learner, the language, the source and text
--   the SERVER loaded after checking that learner's access, and the reading's submission ID.
--   The backend then calls m5_verify_reading, which consumes one receipt matching ALL of those,
--   single use, issued before the reading was saved and at most 24 hours old, and checks the saved
--   word metrics against the saved score. Only then does a row exist in m5_verified_readings.
--   Saved readings stay valid without one; they earn no XP. Pronunciation scores and WPM are never read.
--   Limit: this proves Azure heard this learner's upload for this passage, not whose voice it was.
--
-- Trusted M6 evidence
--   The first completed attempt per reward identity, scored here from its protected question
--   snapshot and first_option_index. Later attempts and client values are ignored.
--
-- Reward identity (m8_passage_rewards), each unique per learner
--   (a) source: module_passages.id or uploaded_materials.id. Survives reassignment, another
--       classroom and repeated readings.
--   (b) content fingerprint: SHA-256 of the normalized text. Stops the same text earning twice
--       through another module, a revision copy or an uploaded copy.
--   Attempt and assignment IDs are deliberately not part of either key.
--   Near duplicates (m8_same_passage): passages of 10+ words are the same passage only when they
--   share at least 90% of their words AND at least 75% of their adjacent word pairs. The first test
--   catches small edits; the second keeps word order, so different sentences built from similar
--   vocabulary still earn. Moved sentences stay the same passage. Enforced under the per-learner
--   lock, not by a constraint.
--
-- Module bonus identity: coalesce(modules.revision_root, modules.id), so a revision does not
-- earn a second bonus. Requires every passage to have its M4 completion evidence in ONE context
-- (one room assignment, or independent), matching assignedReadingProgress.deriveModuleProgress,
-- AND a verified reading of its text, with no exception for older passages. A module whose passages
-- all repeat one already-rewarded module is a copy and earns no bonus. Empty modules never qualify.
--
-- Leaderboards: m8_weekly_leaderboard, m8_classroom_leaderboard and m8_independent_leaderboard
-- exclude 'daily_login'. Login XP counts only in m8_learner_progress.total_xp (personal balance).
-- Diamond: 2000 XP from m8_xp_events excluding 'daily_login'. A login never awards or advances it.
-- Diamonds already earned stay earned; no other badge rule depends on login XP.
--
-- Existing rewards
--   No row is inserted, updated or deleted in m8_xp_events, m8_learner_progress, badges or
--   reading days. m8_reward_settings.f1_cutover_at is the apply time: anything completed before
--   it never earns new-rule XP or a bonus, including a re-recording of an old passage.
--   Legacy 'module' and 'assignment' rows stay valid and still count in every total.
--
-- Separation
--   Diagnostic level is not read anywhere here. The 30/50/80 Independent Learner cap is gone.
--   The daily login never records a reading day, so it cannot affect the M8 F5 streak.
--   m8_oral_completed (read-aloud count, reading day, Brave Reader) is unchanged.
--   M7 triggers, m6_apply_action and m6_assert_completion_access are unchanged.
--
-- Interaction with other proposals
--   m8_badge_completions_PROPOSED.sql and its rollback (separate, unfinished work, not committed with
--   this file) replace m8_grant_xp with the old XP values. Both carry a guard that stops them once this
--   migration is installed; rebase that proposal before using it. Applying it first makes this file
--   stop on its m8_grant_xp fingerprint.
--   m6_admin_practice_ROLLBACK and m8_reward_eligibility_ROLLBACK stop on their own fingerprints.
--
-- Fingerprints: read-only from ReadFlow-Staging, 2026-11-07, reproduced by the PGlite replay.
-- BEFORE APPLYING: Staging backup, m8_f1_xp_rewards_v1_VERIFY_READONLY.sql, backend deploy first.
-- Rollback: m8_f1_xp_rewards_v1_ROLLBACK_PROPOSED.sql (refuses once new-rule XP exists).
-- Test: server/tests/m8F1XpRewardsProposal.test.js (PGlite).
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$
declare item record;
begin
  for item in select * from (values
    ('public.m8_grant_xp(uuid,text,uuid,integer)', '3e803b9b0c2543fdfe132060a811c70a'),
    ('public.m8_on_comprehension_completed()', 'a31be79ffcd4e76ea3396a808f4cbd3a'),
    ('public.m8_award_graduate(uuid)', '3516a76d0547cdc64d2d0d9d03555582'),
    ('public.m8_on_module_xp_granted()', 'c63db1f4be03ae32413047cb2844200c'),
    ('public.m8_weekly_leaderboard()', 'e09ba39cdef64cfd31d4eff1500a192c'),
    ('public.m8_classroom_leaderboard(uuid)', '111d438f1ecddd69f37929270f3d0e27'),
    ('public.m8_independent_leaderboard(text)', '0fa0574f46b772474da40a72a35af09a')
  ) as expected(fn, fp) loop
    if pg_catalog.to_regprocedure(item.fn) is null then
      raise exception 'Stop: % is missing.', item.fn;
    end if;
    if md5(replace(pg_get_functiondef(item.fn::regprocedure), chr(13), '')) is distinct from item.fp then
      raise exception 'Stop: % differs from the reviewed definition (already applied?).', item.fn;
    end if;
  end loop;
  if to_regprocedure('public.m6_one_assessment_per_activity()') is null then
    raise exception 'Stop: apply m6_one_assessment_per_activity first.';
  end if;
  if to_regclass('public.m8_reward_settings') is not null then
    raise exception 'Stop: M8 F1 is already installed.';
  end if;
  for item in select * from (values
    ('oral_reading_attempts','language_snapshot'), ('oral_reading_attempts','scoring_version'),
    ('oral_reading_attempts','word_metrics'), ('oral_reading_attempts','material_id'),
    ('oral_reading_attempts','activity_assignment_id'), ('oral_reading_attempts','passage_id'),
    ('modules','revision_root'), ('room_modules','removed_at'),
    ('reading_activity_assignments','read_aloud_only'), ('comprehension_questions','review_status'),
    ('comprehension_questions','passage_id'), ('module_passages','passage_text')
  ) as required(tbl, col) loop
    if not exists (select 1 from pg_catalog.pg_attribute where attrelid = pg_catalog.to_regclass('public.' || item.tbl)
        and attname = item.col and not attisdropped) then
      raise exception 'Stop: missing prerequisite column public.%.%', item.tbl, item.col;
    end if;
  end loop;
  -- Saved readings are evidence only while clients cannot write them.
  if has_table_privilege('authenticated', 'public.oral_reading_attempts', 'INSERT,UPDATE,DELETE')
    or has_any_column_privilege('authenticated', 'public.oral_reading_attempts', 'INSERT,UPDATE') then
    raise exception 'Stop: M5 attempts must remain backend-written.';
  end if;
end $$;

-- ---------------------------------------------------------------------------- tables
create table public.m8_reward_settings (
  singleton boolean primary key default true check (singleton),
  f1_cutover_at timestamptz not null
);
insert into public.m8_reward_settings(f1_cutover_at) values (now());

create table public.m5_transcript_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('en','fil')),
  transcript_sha256 text not null check (transcript_sha256 ~ '^[0-9a-f]{64}$'),
  source_id uuid not null,
  passage_fingerprint text not null,
  submission_id uuid not null,
  issued_at timestamptz not null default now(),
  consumed_attempt_id uuid unique references public.oral_reading_attempts(id) on delete set null
);
create index m5_transcript_receipts_lookup on public.m5_transcript_receipts(user_id, submission_id, transcript_sha256);

-- No foreign key to modules or passages: m3_deletion_has_history treats those as content history.
create table public.m5_verified_readings (
  attempt_id uuid primary key references public.oral_reading_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('en','fil')),
  content_fingerprint text not null,
  words_correct integer not null check (words_correct >= 0),
  words_total integer not null check (words_total > 0 and words_correct <= words_total),
  completed_at timestamptz not null,
  verified_at timestamptz not null default now()
);
create index m5_verified_readings_first on public.m5_verified_readings(user_id, content_fingerprint, completed_at, attempt_id);

create table public.m8_passage_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('passage','material')),
  source_id uuid not null,
  content_fingerprint text not null,
  content_text text not null,
  module_id uuid,
  reading_attempt_id uuid,
  comprehension_attempt_id uuid,
  words_correct integer,
  words_total integer,
  questions_correct integer,
  questions_total integer,
  xp_awarded integer not null check (xp_awarded between 20 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, source_kind, source_id),
  unique (user_id, content_fingerprint),
  check (reading_attempt_id is not null or comprehension_attempt_id is not null)
);

create table public.m8_daily_logins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  login_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, login_date)
);

do $$
declare t text;
begin
  foreach t in array array['m8_reward_settings','m5_transcript_receipts','m5_verified_readings','m8_passage_rewards','m8_daily_logins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- New source types and amounts. Legacy rows keep their exact legacy values.
alter table public.m8_xp_events drop constraint m8_xp_events_source_type_check;
alter table public.m8_xp_events drop constraint m8_xp_events_xp_earned_check;
alter table public.m8_xp_events add constraint m8_xp_events_source_type_check
  check (source_type in ('module','assignment','passage','module_bonus','daily_login'));
alter table public.m8_xp_events add constraint m8_xp_events_xp_earned_check check (
  case source_type
    when 'module' then xp_earned in (30,50,60,80)
    when 'assignment' then xp_earned in (30,50,60,80)
    when 'passage' then xp_earned between 20 and 100
    when 'module_bonus' then xp_earned = 50
    when 'daily_login' then xp_earned = 10
    else false end);

-- ---------------------------------------------------------------------------- calculation
-- Exact: 20 + 40*(words/total) + 40*(questions/total), plus 1/2, floored. NULL counts mean
-- "not a component of this passage". At least one component is required.
create function public.m8_calculate_passage_xp(p_words_correct bigint, p_words_total bigint,
  p_questions_correct bigint, p_questions_total bigint)
returns integer language plpgsql immutable security invoker set search_path = '' as $$
begin
  if (p_words_total is not null and (p_words_total <= 0 or p_words_correct not between 0 and p_words_total))
     or (p_questions_total is not null and (p_questions_total <= 0 or p_questions_correct not between 0 and p_questions_total)) then
    raise exception 'Invalid passage score' using errcode = '22023';
  end if;
  if p_words_total is not null and p_questions_total is not null then
    return ((41 * p_words_total * p_questions_total + 80 * p_words_correct * p_questions_total
      + 80 * p_questions_correct * p_words_total) / (2 * p_words_total * p_questions_total))::integer;
  elsif p_words_total is not null then
    return ((41 * p_words_total + 160 * p_words_correct) / (2 * p_words_total))::integer;
  elsif p_questions_total is not null then
    return ((41 * p_questions_total + 160 * p_questions_correct) / (2 * p_questions_total))::integer;
  end if;
  raise exception 'A passage reward needs a verified score' using errcode = '22023';
end $$;

create function public.m8_normalized_text(p_text text)
returns text language sql stable security invoker set search_path = '' as $$
  select btrim(regexp_replace(lower(normalize(p_text, NFKC)), '[^[:alnum:]]+', ' ', 'g'))
$$;

create function public.m8_content_fingerprint(p_text text)
returns text language sql stable security invoker set search_path = '' as $$
  select encode(sha256(convert_to(public.m8_normalized_text(p_text), 'UTF8')), 'hex')
$$;

-- The same text, or a trivial edit of it. Both tests use Dice (2 x shared / (a + b), counting repeats):
--   words: at least 90% shared, so changing about 1 word in 10 still matches;
--   adjacent word pairs: at least 75% shared. Each changed word breaks at most two pairs, so 10%
--   scattered edits leave about 80%, and moving a whole sentence breaks only the pairs at its edges.
--   Shuffled or rewritten text with the same vocabulary shares few pairs and counts as new.
-- Under 10 words the text must match exactly, since one word is a real change there.
create function public.m8_same_passage(p_a text, p_b text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare a text[]; b text[]; v_shared bigint; v_pairs bigint;
begin
  a := string_to_array(public.m8_normalized_text(p_a), ' ');
  b := string_to_array(public.m8_normalized_text(p_b), ' ');
  if a is null or b is null then return false; end if;
  if a = b then return true; end if;
  if cardinality(a) < 10 or cardinality(b) < 10 then return false; end if;
  select coalesce(sum(least(x.n, y.n)), 0) into v_shared
  from (select w, count(*) n from unnest(a) as w group by w) x
  join (select w, count(*) n from unnest(b) as w group by w) y using (w);
  if 20 * v_shared < 9 * (cardinality(a) + cardinality(b)) then return false; end if;
  select coalesce(sum(least(x.n, y.n)), 0) into v_pairs
  from (select a[i] || ' ' || a[i + 1] as w, count(*) n from generate_series(1, cardinality(a) - 1) as i group by 1) x
  join (select b[i] || ' ' || b[i + 1] as w, count(*) n from generate_series(1, cardinality(b) - 1) as i group by 1) y using (w);
  return 8 * v_pairs >= 3 * (cardinality(a) + cardinality(b) - 2);
end $$;

-- The language of an activity, from its source only. Null when the source has no known language.
create function public.m8_activity_language(p_material uuid, p_module uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when p_material is not null then (select public.m8_normalize_language(m.language)
      from public.uploaded_materials m where m.id = p_material)
    when p_module is not null then (select public.m8_normalize_language(l.language)
      from public.modules m join public.learning_paths l on l.id = m.path_id where m.id = p_module)
  end
$$;

-- Which languages use the new performance rewards. The single switch: English only for now.
create function public.m8_performance_language(p_language text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(p_language = 'en', false)
$$;

create function public.m8_manila_date(p_at timestamptz)
returns date language sql immutable security invoker set search_path = '' as $$
  select (p_at at time zone 'Asia/Manila')::date
$$;

-- ---------------------------------------------------------------------------- grants of XP
-- Same atomic shape as before. The fixed amounts remain for the languages still on the old rules.
-- completed_modules counts one module once, even if it already earned a legacy 'module' event.
create or replace function public.m8_grant_xp(p_user uuid, p_type text, p_source uuid, p_xp integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted_count integer; v_new_module integer := 0;
begin
  if not ((p_type = 'passage' and p_xp between 20 and 100)
      or (p_type = 'module_bonus' and p_xp = 50)
      or (p_type = 'daily_login' and p_xp = 10)
      or (p_type in ('module', 'assignment') and p_xp in (30, 50, 60, 80))) then
    raise exception 'Invalid XP grant';
  end if;
  insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned)
  values (p_user, p_type, p_source, p_xp) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return false; end if;
  if p_type = 'module' or (p_type = 'module_bonus' and not exists (
    select 1 from public.m8_xp_events x join public.modules m on m.id = x.source_id
    where x.user_id = p_user and x.source_type = 'module' and coalesce(m.revision_root, m.id) = p_source
  )) then
    v_new_module := 1;
  end if;
  insert into public.m8_learner_progress(user_id, total_xp, completed_modules)
  values (p_user, p_xp, v_new_module)
  on conflict (user_id) do update set total_xp = public.m8_learner_progress.total_xp + excluded.total_xp,
    completed_modules = public.m8_learner_progress.completed_modules + excluded.completed_modules, updated_at = now();
  if p_type in ('module', 'module_bonus') then
    insert into public.m8_earned_badges(user_id, badge_id) select p_user, 'first_read' on conflict do nothing;
    insert into public.m8_earned_badges(user_id, badge_id)
    select p_user, 'bookworm' where (select completed_modules from public.m8_learner_progress where user_id = p_user) >= 5
    on conflict do nothing;
  end if;
  -- Diamond counts reading and comprehension XP, including legacy rows, never login XP.
  insert into public.m8_earned_badges(user_id, badge_id)
  select p_user, 'diamond' where p_type <> 'daily_login' and (select coalesce(sum(x.xp_earned), 0)
    from public.m8_xp_events x where x.user_id = p_user and x.source_type <> 'daily_login') >= 2000
  on conflict do nothing;
  return true;
end $$;
revoke all on function public.m8_grant_xp(uuid,text,uuid,integer) from public, anon, authenticated;

-- Graduate keeps its rule (every published module); a whole-module bonus now also counts.
create or replace function public.m8_award_graduate(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.modules where status = 'published')
  and not exists (
    select 1 from public.modules m where m.status = 'published'
    and not exists (select 1 from public.m8_xp_events x where x.user_id = p_user
      and ((x.source_type = 'module' and x.source_id = m.id)
        or (x.source_type = 'module_bonus' and x.source_id = coalesce(m.revision_root, m.id))))
  ) then
    insert into public.m8_earned_badges(user_id, badge_id) values (p_user, 'graduate') on conflict do nothing;
  end if;
end $$;
revoke all on function public.m8_award_graduate(uuid) from public, anon, authenticated;

create or replace function public.m8_on_module_xp_granted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_type in ('module','module_bonus') then perform public.m8_award_graduate(new.user_id); end if;
  return new;
end $$;
revoke all on function public.m8_on_module_xp_granted() from public, anon, authenticated;

-- ---------------------------------------------------------------------------- passage reward
-- Requirements follow M4: a material needs M6 unless read_aloud_only; a module passage needs M6
-- when it has reviewed questions (assignedReadingProgress.withAssessmentRequirement).
-- A missing required score returns false: it is never treated as 0%.
create function public.m8_award_passage(p_user uuid, p_material uuid, p_activity uuid, p_module uuid,
  p_passage uuid, p_text text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_cutover timestamptz;
  v_kind text;
  v_source uuid;
  v_requires boolean;
  v_fp text;
  v_text text;
  v_language text := public.m8_activity_language(p_material, p_module);
  v_attempt public.m6_comprehension_attempts%rowtype;
  v_reading public.m5_verified_readings%rowtype;
  v_total integer;
  v_answered integer;
  v_correct integer;
  v_valid integer;
  v_xp integer;
  v_reward uuid;
begin
  select f1_cutover_at into strict v_cutover from public.m8_reward_settings;

  if p_material is not null then
    v_kind := 'material'; v_source := p_material;
    select not ra.read_aloud_only into v_requires from public.reading_activity_assignments ra
    where ra.id = p_activity and ra.student_id = p_user and ra.material_id = p_material;
    if not found then return false; end if;
  elsif p_passage is not null and exists (select 1 from public.module_passages where id = p_passage and module_id = p_module) then
    v_kind := 'passage'; v_source := p_passage;
    v_requires := exists (select 1 from public.comprehension_questions q where q.passage_id = p_passage and q.review_status = 'reviewed');
  else
    return false; -- a legacy module with no passage rows has no reward identity
  end if;

  if exists (select 1 from public.m8_passage_rewards where user_id = p_user and source_kind = v_kind and source_id = v_source) then
    return false;
  end if;

  if v_requires then
    -- The canonical attempt: first completed for this source, in any classroom.
    select a.* into v_attempt from public.m6_comprehension_attempts a
    where a.user_id = p_user and a.status = 'completed' and a.completed_at is not null
      and ((v_kind = 'material' and a.material_id = v_source) or (v_kind = 'passage' and a.passage_id = v_source))
    order by a.completed_at, a.id limit 1;
    if not found or v_attempt.completed_at < v_cutover then return false; end if;
    v_text := v_attempt.passage_text;
  else
    v_text := p_text;
  end if;
  v_fp := public.m8_content_fingerprint(v_text);

  -- Already rewarded under another source: the same text or a trivial edit of it.
  if exists (select 1 from public.m8_passage_rewards pr where pr.user_id = p_user
      and (pr.content_fingerprint = v_fp or public.m8_same_passage(pr.content_text, v_text))) then
    return false;
  end if;

  -- The same text already finished in a language still on the old rules: that activity's reward stands.
  if exists (select 1 from public.m6_comprehension_attempts a
      where a.user_id = p_user and a.status = 'completed' and a.language is distinct from v_language
        and public.m8_same_passage(a.passage_text, v_text)) then
    return false;
  end if;

  -- Completed before the cutover, by source or by content: no retroactive reward.
  if exists (select 1 from public.m6_comprehension_attempts a
      where a.user_id = p_user and a.status = 'completed' and a.completed_at < v_cutover
        and public.m8_same_passage(a.passage_text, v_text))
    or (not v_requires and exists (select 1 from public.oral_reading_attempts r
      where r.user_id = p_user and r.completed_at < v_cutover
        and public.m8_same_passage(r.passage_snapshot, v_text)))
    or (v_kind = 'material' and exists (select 1 from public.m8_xp_events x
      join public.reading_activity_assignments ra on ra.id = x.source_id
      where x.user_id = p_user and x.source_type = 'assignment' and ra.material_id = v_source))
    or (v_kind = 'passage' and exists (select 1 from public.m8_xp_events x
      where x.user_id = p_user and x.source_type = 'module' and x.source_id = p_module)
      and (select count(*) from public.module_passages where module_id = p_module) <= 1) then
    return false;
  end if;

  -- The first verified reading of this text decides; repeated recordings cannot raise it.
  select r.* into v_reading from public.m5_verified_readings r
  where r.user_id = p_user and r.content_fingerprint = v_fp and r.language = v_language
  order by r.completed_at, r.attempt_id limit 1;
  if not found then return false; end if;

  if v_requires then
    select count(*), count(r.first_option_index),
      count(*) filter (where r.first_option_index = (q.value->>'correctOptionIndex')::integer),
      count(*) filter (where (q.value->>'correctOptionIndex')::integer between 0 and 3)
    into v_total, v_answered, v_correct, v_valid
    from jsonb_array_elements(v_attempt.question_snapshot) as q(value)
    left join public.m6_comprehension_responses r
      on r.attempt_id = v_attempt.id and r.question_id = (q.value->>'id')::uuid;
    if v_total = 0 or v_answered <> v_total or v_valid <> v_total then return false; end if;
    v_xp := public.m8_calculate_passage_xp(v_reading.words_correct, v_reading.words_total, v_correct, v_total);
  else
    v_xp := public.m8_calculate_passage_xp(v_reading.words_correct, v_reading.words_total, null, null);
  end if;

  insert into public.m8_passage_rewards(user_id, source_kind, source_id, content_fingerprint, content_text, module_id,
    reading_attempt_id, comprehension_attempt_id, words_correct, words_total, questions_correct, questions_total, xp_awarded)
  values (p_user, v_kind, v_source, v_fp, public.m8_normalized_text(v_text), p_module, v_reading.attempt_id,
    case when v_requires then v_attempt.id end, v_reading.words_correct, v_reading.words_total,
    case when v_requires then v_correct end, case when v_requires then v_total end, v_xp)
  on conflict do nothing
  returning id into v_reward;
  if v_reward is null then return false; end if;
  return public.m8_grant_xp(p_user, 'passage', v_reward, v_xp);
end $$;

-- ---------------------------------------------------------------------------- module bonus
create function public.m8_try_module_bonus(p_user uuid, p_module uuid, p_room uuid, p_assignment uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_cutover timestamptz;
  v_root uuid;
  v_latest timestamptz;
  v_time timestamptz;
  v_text text;
  v_any boolean := false;
  p record;
begin
  select f1_cutover_at into strict v_cutover from public.m8_reward_settings;
  select coalesce(m.revision_root, m.id) into v_root from public.modules m
  where m.id = p_module and m.status = 'published' and m.deleted_at is null;
  if not found then return false; end if;
  -- A removed classroom assignment is not owed work and cannot complete (M4 progress rule).
  if p_assignment is not null and not exists (select 1 from public.room_modules rm
      where rm.id = p_assignment and rm.room_id = p_room and rm.module_id = p_module and rm.removed_at is null) then
    return false;
  end if;

  for p in select mp.id, mp.passage_text, exists (select 1 from public.comprehension_questions q
        where q.passage_id = mp.id and q.review_status = 'reviewed') as requires
      from public.module_passages mp where mp.module_id = p_module order by mp.display_order, mp.id loop
    v_any := true;
    v_time := null;
    if p.requires then
      select a.completed_at, a.passage_text into v_time, v_text from public.m6_comprehension_attempts a
      where a.user_id = p_user and a.status = 'completed' and a.module_id = p_module and a.passage_id = p.id
        and a.room_id is not distinct from p_room and a.assignment_id is not distinct from p_assignment
      order by a.completed_at, a.id limit 1;
    else
      select r.completed_at, r.passage_snapshot into v_time, v_text from public.oral_reading_attempts r
      where r.user_id = p_user and r.module_id = p_module and r.passage_id = p.id
        and r.room_id is not distinct from p_room and r.assignment_id is not distinct from p_assignment
      order by r.completed_at, r.id limit 1;
    end if;
    if v_time is null then return false; end if;
    -- Every passage needs verified evidence (approved decision), including one finished earlier.
    -- Re-recording an old passage earns it no XP but can satisfy this.
    if not exists (select 1 from public.m5_verified_readings vr
        where vr.user_id = p_user and vr.content_fingerprint = public.m8_content_fingerprint(v_text)) then
      return false;
    end if;
    v_latest := greatest(v_latest, v_time);
  end loop;

  -- No retroactive bonus: the module must have become complete after the cutover.
  if not v_any or v_latest < v_cutover then return false; end if;
  -- A copy is not a new module: every passage here repeats one module that already paid a bonus.
  if exists (select 1 from public.m8_xp_events x
      where x.user_id = p_user and x.source_type = 'module_bonus' and x.source_id <> v_root
        and not exists (select 1 from public.module_passages here where here.module_id = p_module
          and not exists (select 1 from public.module_passages earlier
            join public.modules em on em.id = earlier.module_id
            where coalesce(em.revision_root, em.id) = x.source_id
              and public.m8_same_passage(here.passage_text, earlier.passage_text)))) then
    return false;
  end if;
  return public.m8_grant_xp(p_user, 'module_bonus', v_root, 50);
end $$;

-- ---------------------------------------------------------------------------- evaluation
-- One transaction per learner at a time, so concurrent completions cannot both pass the checks;
-- the unique constraints remain the final guard. A failed reward never rejects a saved reading
-- or a completed assessment.
create function public.m8_evaluate_rewards(p_user uuid, p_material uuid, p_activity uuid, p_module uuid,
  p_passage uuid, p_room uuid, p_assignment uuid, p_text text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_role text; v_passage boolean := false; v_bonus boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('m8-rewards|' || p_user::text, 0));
  -- English first: every other language stays on its existing rewards.
  if not public.m8_performance_language(public.m8_activity_language(p_material, p_module)) then
    return false;
  end if;
  select role into v_role from public.profiles where id = p_user;
  if v_role = 'student' then
    if p_room is null then return false; end if;
  elsif v_role = 'general_user' then
    if p_room is not null or p_assignment is not null or p_material is not null then return false; end if;
  else
    return false;
  end if;
  v_passage := public.m8_award_passage(p_user, p_material, p_activity, p_module, p_passage, p_text);
  if p_material is null and p_module is not null then
    v_bonus := public.m8_try_module_bonus(p_user, p_module, p_room, p_assignment);
  end if;
  return v_passage or v_bonus;
exception when others then
  raise warning 'M8 reward evaluation failed: %', sqlstate;
  return false;
end $$;

-- Same trigger, same timing; access is still checked first and Admin practice still returns.
-- Exactly one reward path per completion, chosen by the activity's source language. The old-rules
-- branch is the deployed logic, unchanged, plus one check: text already rewarded on the new path.
create or replace function public.m8_on_comprehension_completed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tier integer;
  v_allowed integer;
  v_granted boolean := false;
begin
  if new.status <> 'completed' or new.completed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
  perform public.m6_assert_completion_access(new.id);
  -- Admin practice is valid but is not learner progress: no XP, reading day or badge.
  if not exists (select 1 from public.profiles where id = new.user_id and role in ('student','general_user')) then
    return new;
  end if;
  if public.m8_performance_language(public.m8_activity_language(new.material_id, new.module_id)) then
    v_granted := public.m8_evaluate_rewards(new.user_id, new.material_id, new.activity_assignment_id, new.module_id,
      new.passage_id, new.room_id, new.assignment_id, new.passage_text);
  elsif exists (select 1 from public.m8_passage_rewards pr where pr.user_id = new.user_id
      and public.m8_same_passage(pr.content_text, new.passage_text)) then
    return new;
  elsif new.activity_assignment_id is not null then
    v_granted := public.m8_grant_xp(new.user_id, 'assignment', new.activity_assignment_id, 60);
  else
    select case lower(m.difficulty) when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 0 end
      into v_tier from public.modules m where m.id = new.module_id;
    if v_tier is null or v_tier = 0 then raise exception 'Unknown module difficulty'; end if;
    if new.room_id is not null then
      v_allowed := v_tier;
    else
      v_allowed := case public.m2_trusted_reading_level(new.user_id, new.language)
        when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end;
      if v_allowed is null then return new; end if;
    end if;
    v_granted := public.m8_grant_xp(new.user_id, 'module', new.module_id,
      case least(v_tier, v_allowed) when 1 then 30 when 2 then 50 else 80 end);
  end if;

  -- Only new verified XP records a reading day; duplicates never farm streaks.
  if v_granted then
    perform public.m8_record_reading_day(new.user_id, (new.completed_at at time zone 'Asia/Manila')::date);
  end if;
  return new;
end $$;
revoke all on function public.m8_on_comprehension_completed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------- M5 evidence
-- Called by /api/read-aloud/audio with the hash of the transcript Azure just returned, and the
-- source and text the backend loaded after checking this learner's access.
create function public.m5_record_transcript_receipt(p_user uuid, p_language text, p_sha256 text,
  p_source uuid, p_passage_text text, p_submission uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_source is null or p_submission is null or nullif(btrim(p_passage_text), '') is null then
    return null;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('student','general_user')) then
    return null;
  end if;
  delete from public.m5_transcript_receipts
  where user_id = p_user and consumed_attempt_id is null and issued_at < now() - interval '24 hours';
  insert into public.m5_transcript_receipts(user_id, language, transcript_sha256, source_id, passage_fingerprint, submission_id)
  values (p_user, p_language, p_sha256, p_source, public.m8_content_fingerprint(p_passage_text), p_submission)
  returning id into v_id;
  return v_id;
end $$;

-- Called by the backend right after it saves a reading. Idempotent for retries. Consumes one
-- receipt, checks the saved metrics, then evaluates rewards. p_sha256 is computed by the backend
-- from the transcript it saved; the browser cannot supply it.
create function public.m5_verify_reading(p_attempt uuid, p_user uuid, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.oral_reading_attempts%rowtype;
  v_total integer;
  v_errors integer;
  v_correct integer;
  v_receipt uuid;
begin
  select * into a from public.oral_reading_attempts where id = p_attempt and user_id = p_user for update;
  if not found then raise exception 'Reading not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.m5_verified_readings where attempt_id = p_attempt) then
    return jsonb_build_object('verified', true, 'repeat', true);
  end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('student','general_user')) then
    return jsonb_build_object('verified', false, 'reason', 'not_learner');
  end if;
  if a.language_snapshot not in ('en','fil') or a.scoring_version < 2 or jsonb_typeof(a.word_metrics) <> 'array' then
    return jsonb_build_object('verified', false, 'reason', 'unsupported');
  end if;
  -- The saved language must agree with the source, so a reading cannot be filed under another language.
  if (a.material_id is not null or a.module_id is not null)
     and public.m8_activity_language(a.material_id, a.module_id) is distinct from a.language_snapshot then
    return jsonb_build_object('verified', false, 'reason', 'language_mismatch');
  end if;
  select count(*) filter (where m.value->>'expected' is not null), count(*) filter (where m.value->>'type' <> 'match')
    into v_total, v_errors from jsonb_array_elements(a.word_metrics) as m(value);
  v_correct := greatest(a.expected_word_count - a.detected_error_count, 0);
  if v_total <> a.expected_word_count or v_errors <> a.detected_error_count or a.expected_word_count <= 0
     or abs(a.pronunciation_accuracy - (100.0 * v_correct / a.expected_word_count)) > 0.001 then
    return jsonb_build_object('verified', false, 'reason', 'inconsistent_score');
  end if;
  select r.id into v_receipt from public.m5_transcript_receipts r
  where r.user_id = p_user and r.language = a.language_snapshot and r.transcript_sha256 = p_sha256
    and r.source_id = coalesce(a.material_id, a.passage_id, a.module_id)
    and r.passage_fingerprint = public.m8_content_fingerprint(a.passage_snapshot)
    and r.submission_id = a.submission_id
    and r.consumed_attempt_id is null
    and r.issued_at <= a.created_at and r.issued_at >= now() - interval '24 hours'
  order by r.issued_at, r.id limit 1 for update skip locked;
  if v_receipt is null then
    return jsonb_build_object('verified', false, 'reason', 'no_receipt');
  end if;
  update public.m5_transcript_receipts set consumed_attempt_id = p_attempt where id = v_receipt;
  insert into public.m5_verified_readings(attempt_id, user_id, language, content_fingerprint, words_correct, words_total, completed_at)
  values (p_attempt, p_user, a.language_snapshot, public.m8_content_fingerprint(a.passage_snapshot), v_correct, a.expected_word_count, a.completed_at);
  perform public.m8_evaluate_rewards(p_user, a.material_id, a.activity_assignment_id, a.module_id,
    a.passage_id, a.room_id, a.assignment_id, a.passage_snapshot);
  return jsonb_build_object('verified', true);
end $$;

-- ---------------------------------------------------------------------------- leaderboards
-- Rankings count reading and comprehension XP. The only change to each is the source_type filter.
create or replace function public.m8_weekly_leaderboard()
returns table(user_id uuid, display_name text, xp bigint, difficulty text)
language sql stable security definer set search_path = '' as $$
 with me as (select auth.uid() id),
 classmates as (
   select distinct e2.student_id id
   from public.enrollments e1
   join public.enrollments e2 on e1.room_id=e2.room_id
   join public.rooms r on r.id=e1.room_id
   where e1.student_id=(select id from me)
   -- Only valid classroom members; no all-users ranking.
 ), visible as (
   select id from classmates
   union select id from me where id is not null
 ), weekly as (
   select x.user_id, sum(x.xp_earned)::bigint xp
   from public.m8_xp_events x
   where x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
     and x.source_type <> 'daily_login'
   group by x.user_id
 )
 select v.id,
   case when v.id=(select id from me) then 'You'
        else 'Reader ' || upper(substr(replace(v.id::text,'-',''),1,6)) end,
   coalesce(w.xp,0), coalesce(p.unlocked_difficulty,'Easy')
 from visible v
 left join weekly w on w.user_id=v.id
 left join public.m8_learner_progress p on p.user_id=v.id
 order by coalesce(w.xp,0) desc, v.id
 limit 100;
$$;
revoke all on function public.m8_weekly_leaderboard() from public, anon;
grant execute on function public.m8_weekly_leaderboard() to authenticated;

create or replace function public.m8_classroom_leaderboard(p_room_id uuid)
returns table(user_id uuid, display_name text, xp bigint, difficulty text)
language sql stable security definer set search_path = '' as $$
 with me as (select auth.uid() id),
 members as (
   -- Only members of a room the caller is enrolled in; anyone else gets no rows.
   select e.student_id id from public.enrollments e
   where e.room_id = p_room_id
     and exists (select 1 from public.enrollments mine
                 where mine.room_id = p_room_id and mine.student_id = (select id from me))
 ), weekly as (
   select x.user_id, sum(x.xp_earned)::bigint xp
   from public.m8_xp_events x
   where x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
     and x.user_id in (select id from members)
     and x.source_type <> 'daily_login'
   group by x.user_id
 )
 select m.id,
   case when m.id = (select id from me) then 'You'
        else 'Reader ' || upper(substr(replace(m.id::text, '-', ''), 1, 6)) end,
   coalesce(w.xp, 0), coalesce(p.unlocked_difficulty, 'Easy')
 from members m
 left join weekly w on w.user_id = m.id
 left join public.m8_learner_progress p on p.user_id = m.id
 order by coalesce(w.xp, 0) desc, m.id
 limit 100;
$$;
revoke all on function public.m8_classroom_leaderboard(uuid) from public, anon;
grant execute on function public.m8_classroom_leaderboard(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.m8_independent_leaderboard(p_period text DEFAULT 'weekly')
RETURNS TABLE(user_id uuid, display_name text, xp bigint, difficulty text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='general_user'
 ) THEN RAISE EXCEPTION 'Independent learner access required' USING ERRCODE='42501'; END IF;
 IF p_period NOT IN ('weekly','all_time') THEN RAISE EXCEPTION 'Invalid period'; END IF;
 RETURN QUERY
 WITH scores AS (
  SELECT x.user_id, SUM(x.xp_earned)::bigint AS points
  FROM public.m8_xp_events x
  WHERE x.source_type <> 'daily_login'
   AND (p_period='all_time' OR x.created_at >=
   (date_trunc('week', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'))
  GROUP BY x.user_id
 )
 SELECT p.id, COALESCE(NULLIF(p.nickname,''), 'Reader ' || LEFT(p.id::text,6))::text,
        COALESCE(s.points,0)::bigint,
        COALESCE(g.unlocked_difficulty,'Easy')::text
 FROM public.profiles p
 LEFT JOIN scores s ON s.user_id=p.id
 LEFT JOIN public.m8_learner_progress g ON g.user_id=p.id
 WHERE p.role='general_user'
 ORDER BY COALESCE(s.points,0) DESC, p.id
 LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.m8_independent_leaderboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m8_independent_leaderboard(text) TO authenticated;

-- ---------------------------------------------------------------------------- daily login
create function public.m8_claim_daily_login_at(p_user uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_date date := public.m8_manila_date(p_at); v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user and role in ('student','general_user')) then
    return jsonb_build_object('eligible', false, 'awarded', false);
  end if;
  insert into public.m8_daily_logins(user_id, login_date) values (p_user, v_date)
  on conflict (user_id, login_date) do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('eligible', true, 'awarded', false, 'date', v_date);
  end if;
  perform public.m8_grant_xp(p_user, 'daily_login', v_id, 10);
  return jsonb_build_object('eligible', true, 'awarded', true, 'xp', 10, 'date', v_date);
end $$;

-- The date comes from the database clock, never from the caller.
create function public.m8_claim_daily_login(p_user uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.m8_claim_daily_login_at(p_user, now())
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.m8_calculate_passage_xp(bigint,bigint,bigint,bigint)', 'public.m8_content_fingerprint(text)',
    'public.m8_normalized_text(text)', 'public.m8_same_passage(text,text)',
    'public.m8_activity_language(uuid,uuid)', 'public.m8_performance_language(text)',
    'public.m8_manila_date(timestamptz)', 'public.m8_award_passage(uuid,uuid,uuid,uuid,uuid,text)',
    'public.m8_try_module_bonus(uuid,uuid,uuid,uuid)', 'public.m8_evaluate_rewards(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)',
    'public.m8_claim_daily_login_at(uuid,timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
  foreach fn in array array[
    'public.m5_record_transcript_receipt(uuid,text,text,uuid,text,uuid)', 'public.m5_verify_reading(uuid,uuid,text)',
    'public.m8_claim_daily_login(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- Postconditions: fail closed inside this transaction.
do $$
declare fn text; t text;
begin
  foreach fn in array array['public.m8_grant_xp(uuid,text,uuid,integer)', 'public.m5_verify_reading(uuid,uuid,text)',
    'public.m5_record_transcript_receipt(uuid,text,text,uuid,text,uuid)', 'public.m8_claim_daily_login(uuid)',
    'public.m8_claim_daily_login_at(uuid,timestamptz)', 'public.m8_evaluate_rewards(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)'] loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'Postcondition: % is callable by clients', fn;
    end if;
  end loop;
  foreach t in array array['m8_reward_settings','m5_transcript_receipts','m5_verified_readings','m8_passage_rewards','m8_daily_logins'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'Postcondition: % is reachable by clients', t;
    end if;
  end loop;
  if not public.m8_performance_language('en') or public.m8_performance_language('fil') or public.m8_performance_language(null) then
    raise exception 'Postcondition: new rewards must be active for English only';
  end if;
  foreach fn in array array['public.m8_weekly_leaderboard()', 'public.m8_classroom_leaderboard(uuid)', 'public.m8_independent_leaderboard(text)'] loop
    if position('daily_login' in pg_get_functiondef(fn::regprocedure)) = 0 then
      raise exception 'Postcondition: % still ranks daily login XP', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'Postcondition: % has the wrong grants', fn;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'm8_m6_completed' and tgenabled = 'O'
      and tgrelid = 'public.m6_comprehension_attempts'::regclass and not tgisinternal)
    or not exists (select 1 from pg_trigger where tgname = 'm8_graduate_check' and tgenabled = 'O'
      and tgrelid = 'public.m8_xp_events'::regclass and not tgisinternal) then
    raise exception 'Postcondition: an M8 reward trigger is missing or disabled';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
