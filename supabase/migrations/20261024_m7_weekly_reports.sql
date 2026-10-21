-- Optional prerequisite: run if weekly_reports is absent. Existing data is preserved.
BEGIN;
CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  report_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weekly_reports_teacher_created ON public.weekly_reports(teacher_id,created_at DESC);
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
-- Backend service-role access only; report routes already verify approved teacher ownership.
REVOKE ALL ON public.weekly_reports FROM anon, authenticated;
GRANT ALL ON public.weekly_reports TO service_role;
COMMIT;
