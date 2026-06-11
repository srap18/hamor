-- Make get_my_elite_vip() server-authoritative: it must reflect the
-- effective level AFTER expiry, never the raw stored value. We also
-- lazy-reset the DB row so the truth is the same everywhere.

CREATE OR REPLACE FUNCTION public.get_my_elite_vip()
RETURNS TABLE(elite_vip_level int, elite_vip_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _eff smallint;
  _exp timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RETURN QUERY SELECT 0::int, NULL::timestamptz;
    RETURN;
  END IF;

  -- get_elite_vip_level already auto-resets expired rows and returns 0.
  _eff := public.get_elite_vip_level(_uid);

  SELECT p.elite_vip_expires_at INTO _exp
  FROM public.profiles p
  WHERE p.id = _uid;

  -- If level is 0 (either never-VIP or just expired), hide expiry too.
  IF _eff = 0 THEN
    _exp := NULL;
  END IF;

  RETURN QUERY SELECT _eff::int, _exp;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_elite_vip() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_elite_vip() TO authenticated;

-- Same hardening for admin variant: return the effective level.
CREATE OR REPLACE FUNCTION public.admin_get_elite_vip(_user_id uuid)
RETURNS TABLE(elite_vip_level int, elite_vip_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _eff smallint;
  _exp timestamptz;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  _eff := public.get_elite_vip_level(_user_id);
  SELECT p.elite_vip_expires_at INTO _exp
  FROM public.profiles p
  WHERE p.id = _user_id;
  IF _eff = 0 THEN _exp := NULL; END IF;
  RETURN QUERY SELECT _eff::int, _exp;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_elite_vip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_elite_vip(uuid) TO authenticated;

-- Add a matching server-authoritative read for the regular VIP, so the
-- client never needs to compute vip expiry locally either.
CREATE OR REPLACE FUNCTION public.get_my_vip()
RETURNS TABLE(vip_level int, vip_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _lvl int;
  _exp timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RETURN QUERY SELECT 0::int, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT p.vip_level, p.vip_expires_at INTO _lvl, _exp
  FROM public.profiles p
  WHERE p.id = _uid;

  -- Lazy expire: if stored expiry has passed, zero the row and return 0.
  IF _lvl IS NOT NULL AND _lvl > 0
     AND _exp IS NOT NULL AND _exp <= now() THEN
    UPDATE public.profiles
       SET vip_level = 0, vip_expires_at = NULL
     WHERE id = _uid;
    _lvl := 0;
    _exp := NULL;
  END IF;

  RETURN QUERY SELECT COALESCE(_lvl, 0)::int, _exp;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_vip() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_vip() TO authenticated;