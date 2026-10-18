-- Apply after the existing ReadFlow database migrations.
BEGIN;

ALTER TABLE public.comprehension_question_answers
  ADD COLUMN IF NOT EXISTS answer_explanation text,
  ADD COLUMN IF NOT EXISTS supporting_evidence text;

CREATE TABLE IF NOT EXISTS public.m6_comprehension_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  module_id uuid NOT NULL,
  passage_id uuid NOT NULL,
  room_id uuid,
  assignment_id uuid,
  passage_title text NOT NULL,
  passage_text text NOT NULL,
  language text NOT NULL,
  question_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  scoring_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  CONSTRAINT m6_comprehension_attempts_pkey
    PRIMARY KEY (id),

  CONSTRAINT m6_comprehension_attempts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id),

  CONSTRAINT m6_submission_unique
    UNIQUE (user_id, submission_id),

  CONSTRAINT m6_comprehension_attempts_language_check
    CHECK (language IN ('en', 'fil')),

  CONSTRAINT m6_comprehension_attempts_status_check
    CHECK (status IN ('in_progress', 'completed')),

  CONSTRAINT m6_comprehension_attempts_question_snapshot_check
    CHECK (
      jsonb_typeof(question_snapshot) = 'array'
      AND jsonb_array_length(question_snapshot) > 0
    ),

  CONSTRAINT m6_completion_consistent
    CHECK (
      (status = 'in_progress' AND completed_at IS NULL)
      OR
      (status = 'completed' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS m6_attempts_owner_created
  ON public.m6_comprehension_attempts
  (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.m6_comprehension_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL,
  question_id uuid NOT NULL,
  first_option_index integer,
  first_answer_correct boolean,
  answer_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  hint_used boolean NOT NULL DEFAULT false,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT m6_comprehension_responses_pkey
    PRIMARY KEY (id),

  CONSTRAINT m6_comprehension_responses_attempt_id_fkey
    FOREIGN KEY (attempt_id)
    REFERENCES public.m6_comprehension_attempts(id)
    ON DELETE CASCADE,

  CONSTRAINT m6_question_response_unique
    UNIQUE (attempt_id, question_id),

  CONSTRAINT m6_comprehension_responses_first_option_index_check
    CHECK (first_option_index BETWEEN 0 AND 3),

  CONSTRAINT m6_comprehension_responses_answer_history_check
    CHECK (jsonb_typeof(answer_history) = 'array'),

  CONSTRAINT m6_first_answer_consistent
    CHECK (
      (
        first_option_index IS NULL
        AND first_answer_correct IS NULL
      )
      OR
      (
        first_option_index IS NOT NULL
        AND first_answer_correct IS NOT NULL
      )
    )
);

ALTER TABLE public.m6_comprehension_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.m6_comprehension_responses
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.m6_comprehension_attempts,
  public.m6_comprehension_responses
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  public.m6_comprehension_attempts,
  public.m6_comprehension_responses
TO service_role;

COMMIT;