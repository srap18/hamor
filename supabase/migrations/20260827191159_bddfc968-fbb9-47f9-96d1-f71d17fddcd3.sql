CREATE OR REPLACE FUNCTION public.admin_hard_delete_user(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  pass int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;
  IF auth.uid() IS NOT NULL AND _uid = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_DELETE_SELF';
  END IF;

  SET LOCAL session_replication_role = 'replica';

  -- Generic sweep: every public-schema column that references auth.users or
  -- public.profiles gets cleared for this user. Two passes so that rows removed
  -- in the first pass expose any second-level references.
  FOR pass IN 1..2 LOOP
    FOR r IN
      SELECT c.conrelid::regclass::text AS tbl,
             a.attname                  AS col,
             a.attnotnull               AS notnull
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f'
        AND n.nspname = 'public'
        AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
        AND array_length(c.conkey, 1) = 1
    LOOP
      IF r.tbl = 'profiles' THEN
        CONTINUE; -- handled last
      END IF;
      IF r.notnull THEN
        EXECUTE format('DELETE FROM %s WHERE %I = $1', r.tbl, r.col) USING _uid;
      ELSE
        EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING _uid;
      END IF;
    END LOOP;
  END LOOP;

  -- Self-references on profiles (e.g. referred_by) then the profile itself.
  FOR r IN
    SELECT a.attname AS col
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.profiles'::regclass
      AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
      AND NOT a.attnotnull
  LOOP
    EXECUTE format('UPDATE public.profiles SET %I = NULL WHERE %I = $1', r.col, r.col) USING _uid;
  END LOOP;

  DELETE FROM public.profiles WHERE id = _uid;
END;
$function$;