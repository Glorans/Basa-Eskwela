-- M1: Terms of Use and Privacy Notice acknowledgment.                                     PROPOSED - NOT APPLIED TO STAGING
--
-- Records that a signed-in user (any of the five roles) pressed "I Agree" for a policy version: the user, the version,
-- whether that version was a DRAFT or an APPROVED one, and the time. Nothing else. It is an acknowledgment only: NOT
-- verified parent or guardian consent, and NOT permission to disclose a child's identity.
--
--   * public.m1_policy_versions: the known policy versions, each 'draft' or 'approved'; at most ONE is active.
--     This migration registers the current draft ('2026-11-draft-1') but activates NOTHING, so after applying it nobody
--     is asked to acknowledge anything. An approved version is activated later, after the institutional approval,
--     with m1_policy_acknowledgment_v1_ACTIVATE_TEMPLATE.sql.
--   * public.m1_policy_acknowledgments(user_id, policy_version, policy_status, acknowledged_at): one row per user and
--     version; the version's status is stored with it, so a draft-review acknowledgment can never be mistaken for
--     acceptance of an approved policy. Rows cannot be changed afterwards (the first time is kept).
--   * public.m1_my_policy_status(): the active version, its status, when the caller acknowledged it (null = not yet)
--     and whether acknowledgment is required (false when no version is active).
--   * public.m1_acknowledge_policy(p_version): records the caller's own acknowledgment of the ACTIVE version only.
-- No row is created for anyone automatically: existing users are asked once, at their next sign-in after a version is
-- activated; returning users who already acknowledged that version are not asked again.
-- Clients read only their own acknowledgments and cannot write directly; versions are not client-readable or writable.
-- Rollback: m1_policy_acknowledgment_v1_ROLLBACK_PROPOSED.sql (deletes the acknowledgment records).
-- Checks: ..._PREFLIGHT_READONLY.sql, ..._VERIFY_READONLY.sql.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.m1_policy_acknowledgments') IS NOT NULL OR to_regclass('public.m1_policy_versions') IS NOT NULL
     OR to_regprocedure('public.m1_acknowledge_policy(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Policy acknowledgment already installed; nothing was changed';
  END IF;
END $guard$;

CREATE TABLE public.m1_policy_versions (
  version text PRIMARY KEY CHECK (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  status text NOT NULL CHECK (status IN ('draft', 'approved')),
  is_active boolean NOT NULL DEFAULT false,
  approval_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  -- An approved version must say where its approval is recorded.
  CHECK (status = 'draft' OR nullif(btrim(approval_note), '') IS NOT NULL)
);
CREATE UNIQUE INDEX m1_policy_versions_one_active ON public.m1_policy_versions (is_active) WHERE is_active;
ALTER TABLE public.m1_policy_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m1_policy_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.m1_policy_versions TO service_role;
INSERT INTO public.m1_policy_versions (version, status) VALUES ('2026-11-draft-1', 'draft');

CREATE TABLE public.m1_policy_acknowledgments (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version text NOT NULL REFERENCES public.m1_policy_versions(version),
  policy_status text NOT NULL CHECK (policy_status IN ('draft', 'approved')),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, policy_version)
);
ALTER TABLE public.m1_policy_acknowledgments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m1_policy_acknowledgments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.m1_policy_acknowledgments TO authenticated;
GRANT ALL ON public.m1_policy_acknowledgments TO service_role;
CREATE POLICY m1_policy_ack_own_read ON public.m1_policy_acknowledgments FOR SELECT TO authenticated USING (user_id = auth.uid());

-- An acknowledgment is a record of what happened: it is never edited afterwards.
CREATE FUNCTION public.m1_policy_ack_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
begin
  raise exception 'Policy acknowledgments cannot be changed' using errcode = '42501';
end $$;
REVOKE ALL ON FUNCTION public.m1_policy_ack_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER m1_policy_ack_immutable BEFORE UPDATE ON public.m1_policy_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION public.m1_policy_ack_immutable();

CREATE FUNCTION public.m1_my_policy_status()
 RETURNS TABLE(policy_version text, policy_status text, acknowledged_at timestamptz, required boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
declare v_me uuid := auth.uid(); v_version text; v_status text; v_at timestamptz;
begin
  if v_me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select p.version, p.status into v_version, v_status from public.m1_policy_versions p where p.is_active;
  if v_version is null then
    return query select null::text, null::text, null::timestamptz, false;
    return;
  end if;
  select a.acknowledged_at into v_at from public.m1_policy_acknowledgments a where a.user_id = v_me and a.policy_version = v_version;
  return query select v_version, v_status, v_at, v_at is null;
end $$;
REVOKE ALL ON FUNCTION public.m1_my_policy_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m1_my_policy_status() TO authenticated;

CREATE FUNCTION public.m1_acknowledge_policy(p_version text)
 RETURNS TABLE(policy_version text, policy_status text, acknowledged_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare v_me uuid := auth.uid(); v_version text; v_status text; v_at timestamptz;
begin
  if v_me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select p.version, p.status into v_version, v_status from public.m1_policy_versions p where p.is_active;
  -- Only the ACTIVE version can be acknowledged; a page showing an older (or no longer active) version must reload.
  if v_version is null or p_version is distinct from v_version then
    raise exception 'The Terms of Use and Privacy Notice changed. Reload the page and read the current version.' using errcode = '22023';
  end if;
  insert into public.m1_policy_acknowledgments (user_id, policy_version, policy_status) values (v_me, v_version, v_status)
  on conflict on constraint m1_policy_acknowledgments_pkey do nothing;
  -- A repeat keeps the first time.
  select a.acknowledged_at into v_at from public.m1_policy_acknowledgments a where a.user_id = v_me and a.policy_version = v_version;
  return query select v_version, v_status, v_at;
end $$;
REVOKE ALL ON FUNCTION public.m1_acknowledge_policy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m1_acknowledge_policy(text) TO authenticated;

COMMIT;
