BEGIN;

CREATE TABLE IF NOT EXISTS public.oral_reading_recordings (
  attempt_id uuid PRIMARY KEY
    REFERENCES public.oral_reading_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  segments jsonb NOT NULL CHECK (
    jsonb_typeof(segments) = 'array'
    AND jsonb_array_length(segments) BETWEEN 1 AND 32
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oral_reading_recordings
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.oral_reading_recordings
  FROM anon, authenticated;

GRANT ALL ON public.oral_reading_recordings
  TO service_role;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'oral-reading-recordings',
  'oral-reading-recordings',
  false,
  26214400,
  ARRAY[
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/wav'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;