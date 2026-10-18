-- Module 4 classroom management (formerly numbered Module 6).
-- Legacy m6_ function and M6 policy names are preserved for deployed database compatibility.
-- Review/apply manually; renumbering does not execute this migration.
-- ============================================================
-- M4 - Classroom Management
-- ReadFlow / Basa Skwela
-- ============================================================
-- This migration records the database changes required by M4:
--   • Classroom room-code uniqueness
--   • Duplicate enrollment prevention
--   • Duplicate module assignment prevention
--   • Admin role helper
--   • Student enrollment helper
--   • Secure room joining
--   • M4 Row Level Security policies
-- ============================================================


-- ============================================================
-- 1. DATABASE CONSTRAINTS
-- ============================================================

BEGIN;

-- Keep all deployed UNIQUE constraints, including the equivalent *_key and
-- *_unique pairs. Verify their column sets rather than relying on their names.
-- A missing prerequisite aborts the transaction instead of altering live data.
DO $$
DECLARE
  requirement record;
BEGIN
  FOR requirement IN
    SELECT * FROM (VALUES
      ('public.rooms', ARRAY['room_code']::text[]),
      ('public.enrollments', ARRAY['room_id', 'student_id']::text[]),
      ('public.room_modules', ARRAY['module_id', 'room_id']::text[])
    ) AS required(table_name, columns)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS c
      WHERE c.conrelid = requirement.table_name::pg_catalog.regclass
        AND c.contype = 'u'
        AND NOT c.condeferrable
        AND ARRAY(
          SELECT a.attname::text
          FROM pg_catalog.unnest(c.conkey) AS key(attnum)
          JOIN pg_catalog.pg_attribute AS a
            ON a.attrelid = c.conrelid AND a.attnum = key.attnum
          ORDER BY a.attname::text
        ) = requirement.columns
    ) THEN
      RAISE EXCEPTION 'Missing immediate UNIQUE prerequisite on % (%)',
        requirement.table_name, requirement.columns;
    END IF;
  END LOOP;
END;
$$;

-- No room-code rewrite. Lookup and uniqueness use the same expression.
-- Before live application, recheck normalized duplicates and verify that any
-- index already bearing this name is valid, unique and has this definition.
CREATE UNIQUE INDEX IF NOT EXISTS rooms_room_code_normalized_unique
ON public.rooms (pg_catalog.upper(pg_catalog.btrim(room_code)));


-- ============================================================
-- 2. ADMIN ROLE HELPER
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;


REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Caller-only role lookup avoids profiles -> rooms -> profiles RLS recursion.
-- No caller-supplied user ID and no dependency on another module's helpers.
CREATE OR REPLACE FUNCTION public.m4_current_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT p.role FROM public.profiles AS p WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.m4_current_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m4_current_role() TO authenticated;


-- ============================================================
-- 3. STUDENT ENROLLMENT HELPER
-- ============================================================
-- Used by the rooms SELECT policy.
-- SECURITY DEFINER prevents circular RLS recursion between
-- rooms and enrollments.

CREATE OR REPLACE FUNCTION public.m6_is_enrolled_in_room(
  target_room_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments
    WHERE room_id = target_room_id
      AND student_id = auth.uid()
  );
$$;

REVOKE ALL
ON FUNCTION public.m6_is_enrolled_in_room(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.m6_is_enrolled_in_room(uuid)
TO authenticated;


-- ============================================================
-- 4. SECURE STUDENT JOIN FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.join_room_by_code(
  p_room_code text
)
RETURNS public.enrollments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_room_id uuid;
  v_code text;
  v_enrollment public.enrollments;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be logged in.';
  END IF;

  IF public.m4_current_role() IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Only students can join a classroom.' USING ERRCODE = '42501';
  END IF;

  v_code := pg_catalog.upper(pg_catalog.btrim(p_room_code));
  IF v_code IS NULL OR v_code = '' OR v_code ~ '^[[:space:]]*$' THEN
    RAISE EXCEPTION 'Please enter a room code.' USING ERRCODE = '22023';
  END IF;

  SELECT id
  INTO v_room_id
  FROM public.rooms
  WHERE pg_catalog.upper(pg_catalog.btrim(room_code)) = v_code;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Invalid room code.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.enrollments (
    student_id,
    room_id
  )
  VALUES (
    auth.uid(),
    v_room_id
  )
  ON CONFLICT (student_id, room_id) DO NOTHING
  RETURNING * INTO v_enrollment;

  IF NOT FOUND THEN
    -- Separate statement sees a concurrent committed join at READ COMMITTED.
    -- Do not perform a dummy UPDATE (which would fire enrollment triggers).
    SELECT * INTO v_enrollment
    FROM public.enrollments
    WHERE student_id = auth.uid() AND room_id = v_room_id;

    IF NOT FOUND THEN
      -- A concurrent teacher removal may have removed the conflicting row.
      RAISE EXCEPTION 'Unable to join classroom. Please try again.';
    END IF;
  END IF;

  RETURN v_enrollment;
END;
$$;

REVOKE ALL
ON FUNCTION public.join_room_by_code(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.join_room_by_code(text)
TO authenticated;


-- ============================================================
-- 5. ROOMS RLS POLICIES
-- ============================================================

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;


-- Teacher can create their own learning rooms.

-- Remove the live alias as well as the historical replacement name.
DROP POLICY IF EXISTS
"M6 Teachers can create their own rooms"
ON public.rooms;

DROP POLICY IF EXISTS
"M6 Teachers can create learning rooms"
ON public.rooms;

CREATE POLICY
"M6 Teachers can create learning rooms"
ON public.rooms
FOR INSERT
TO authenticated
WITH CHECK (
  public.m4_current_role() = 'teacher'
  AND auth.uid() = teacher_id
);


-- Teacher can view their own learning rooms.

-- Remove the live alias as well as the historical replacement name.
DROP POLICY IF EXISTS
"M6 Teachers can view their own rooms"
ON public.rooms;

DROP POLICY IF EXISTS
"M6 Teachers can view own learning rooms"
ON public.rooms;

CREATE POLICY
"M6 Teachers can view own learning rooms"
ON public.rooms
FOR SELECT
TO authenticated
USING (
  public.m4_current_role() = 'teacher'
  AND auth.uid() = teacher_id
);


-- Teacher can update their own learning rooms.

-- Remove the live alias as well as the historical replacement name.
DROP POLICY IF EXISTS
"M6 Teachers can edit their own rooms"
ON public.rooms;

DROP POLICY IF EXISTS
"M6 Teachers can update own learning rooms"
ON public.rooms;

CREATE POLICY
"M6 Teachers can update own learning rooms"
ON public.rooms
FOR UPDATE
TO authenticated
USING (
  public.m4_current_role() = 'teacher'
  AND auth.uid() = teacher_id
)
WITH CHECK (
  public.m4_current_role() = 'teacher'
  AND auth.uid() = teacher_id
);


-- Student can view rooms they are enrolled in.

DROP POLICY IF EXISTS
"M6 Students can view enrolled rooms"
ON public.rooms;

CREATE POLICY
"M6 Students can view enrolled rooms"
ON public.rooms
FOR SELECT
TO authenticated
USING (
  public.m6_is_enrolled_in_room(id)
);


-- Admin can view all learning rooms.

DROP POLICY IF EXISTS
"M6 Admin can view learning rooms"
ON public.rooms;

CREATE POLICY
"M6 Admin can view learning rooms"
ON public.rooms
FOR SELECT
TO authenticated
USING (
  public.is_admin()
);


-- ============================================================
-- 6. ENROLLMENTS RLS POLICIES
-- ============================================================

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;


-- Joining is RPC-only; the service never inserts enrollments directly.

DROP POLICY IF EXISTS
"M6 Students can join classrooms"
ON public.enrollments;

-- Student can view their enrollment.
-- Teacher can view enrollments belonging to their rooms.

DROP POLICY IF EXISTS
"M6 Students and teachers can view enrollments"
ON public.enrollments;

CREATE POLICY
"M6 Students and teachers can view enrollments"
ON public.enrollments
FOR SELECT
TO authenticated
USING (
  auth.uid() = student_id
  OR (public.m4_current_role() = 'teacher' AND EXISTS (
    SELECT 1
    FROM public.rooms
    WHERE rooms.id = enrollments.room_id
      AND rooms.teacher_id = auth.uid()
  ))
);


-- Teacher can remove students from their own room.

DROP POLICY IF EXISTS
"M6 Teachers can remove enrolled students"
ON public.enrollments;

CREATE POLICY
"M6 Teachers can remove enrolled students"
ON public.enrollments
FOR DELETE
TO authenticated
USING (
  public.m4_current_role() = 'teacher'
  AND EXISTS (
    SELECT 1
    FROM public.rooms
    WHERE rooms.id = enrollments.room_id
      AND rooms.teacher_id = auth.uid()
  )
);


-- Admin can view classroom enrollments.

DROP POLICY IF EXISTS
"M6 Admin can view classroom enrollments"
ON public.enrollments;

CREATE POLICY
"M6 Admin can view classroom enrollments"
ON public.enrollments
FOR SELECT
TO authenticated
USING (
  public.is_admin()
);


-- ============================================================
-- 7. ROOM MODULES RLS POLICIES
-- ============================================================

ALTER TABLE public.room_modules ENABLE ROW LEVEL SECURITY;


-- Teacher can assign modules to their own classroom.

-- Remove the live alias as well as the historical replacement name.
DROP POLICY IF EXISTS
"M6 Teachers can assign modules to their own rooms"
ON public.room_modules;

DROP POLICY IF EXISTS
"M6 Teachers can assign classroom modules"
ON public.room_modules;

CREATE POLICY
"M6 Teachers can assign classroom modules"
ON public.room_modules
FOR INSERT
TO authenticated
WITH CHECK (
  public.m4_current_role() = 'teacher'
  AND auth.uid() = assigned_by
  AND EXISTS (
    SELECT 1
    FROM public.rooms
    WHERE rooms.id = room_modules.room_id
      AND rooms.teacher_id = auth.uid()
  )
);


-- Teacher can view modules assigned to their own rooms.

-- Remove the live alias as well as the historical replacement name.
DROP POLICY IF EXISTS
"M6 Teachers can view modules assigned to their rooms"
ON public.room_modules;

DROP POLICY IF EXISTS
"M6 Teachers can view assigned classroom modules"
ON public.room_modules;

CREATE POLICY
"M6 Teachers can view assigned classroom modules"
ON public.room_modules
FOR SELECT
TO authenticated
USING (
  public.m4_current_role() = 'teacher'
  AND EXISTS (
    SELECT 1
    FROM public.rooms
    WHERE rooms.id = room_modules.room_id
      AND rooms.teacher_id = auth.uid()
  )
);


-- Student can view modules assigned to rooms they joined.

-- Remove the live alias as well as the historical replacement name.
DROP POLICY IF EXISTS
"M6 Students can view assigned modules in joined rooms"
ON public.room_modules;

DROP POLICY IF EXISTS
"M6 Students can view assigned classroom modules"
ON public.room_modules;

CREATE POLICY
"M6 Students can view assigned classroom modules"
ON public.room_modules
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.enrollments
    WHERE enrollments.room_id = room_modules.room_id
      AND enrollments.student_id = auth.uid()
  )
);


-- Admin can view all classroom module assignments.

DROP POLICY IF EXISTS
"M6 Admin can view assigned classroom modules"
ON public.room_modules;

CREATE POLICY
"M6 Admin can view assigned classroom modules"
ON public.room_modules
FOR SELECT
TO authenticated
USING (
  public.is_admin()
);


-- ============================================================
-- 8. PROFILE ACCESS FOR M4
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- Teachers need student profile information for students
-- enrolled in their classrooms.

DROP POLICY IF EXISTS
"M6 Teachers can view enrolled student profiles"
ON public.profiles;

CREATE POLICY
"M6 Teachers can view enrolled student profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  profiles.role = 'student'
  AND public.m4_current_role() = 'teacher'
  AND EXISTS (
    SELECT 1
    FROM public.enrollments
    JOIN public.rooms
      ON rooms.id = enrollments.room_id
    WHERE enrollments.student_id = profiles.id
      AND rooms.teacher_id = auth.uid()
  )
);


-- Admin can view student/profile information used by
-- classroom management.

DROP POLICY IF EXISTS
"M6 Admin can view student profiles"
ON public.profiles;

CREATE POLICY
"M6 Admin can view student profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  AND profiles.role = 'student'
  AND EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE enrollments.student_id = profiles.id
  )
);


-- ============================================================
-- END OF M4 CLASSROOM MANAGEMENT MIGRATION
-- ============================================================
-- No room DELETE, student leave, or room_modules DELETE/UPDATE policy:
-- these operations are not implemented by the current M4 service/pages.
-- M1 own-profile policies, column grants and authorization trigger are untouched.
-- Before applying, inspect ALL live policies/grants: permissive policies combine
-- with OR, so unrelated legacy policies can bypass these M4 restrictions.
-- Apply as a trusted function owner able to bypass table RLS; verify existing
-- function owners/ACLs, including any nonstandard explicit EXECUTE grants.
COMMIT;
