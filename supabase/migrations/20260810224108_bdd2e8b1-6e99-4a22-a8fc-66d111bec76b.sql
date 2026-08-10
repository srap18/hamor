CREATE OR REPLACE FUNCTION public.admin_list_elite_vips()
RETURNS TABLE(
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  avatar_emoji text,
  elite_vip_level int,
  elite_vip_expires_at timestamptz,
  days_left numeric,
  source text,
  last_purchase_at timestamptz,
  last_code_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH v AS (
    SELECT p.id, p.display_name, p.username, p.avatar_url, p.avatar_emoji,
           p.elite_vip_level::int AS lvl, p.elite_vip_expires_at AS exp
    FROM public.profiles p
    WHERE COALESCE(p.elite_vip_level,0) > 0
      AND p.elite_vip_expires_at IS NOT NULL
      AND p.elite_vip_expires_at > now()
  ),
  pur AS (
    SELECT pp.user_id, max(pp.created_at) AS last_at
    FROM public.paddle_purchases pp
    WHERE pp.pack_id LIKE 'elite_vip%' AND pp.granted = true
    GROUP BY pp.user_id
  ),
  cod AS (
    SELECT cr.user_id, max(cr.redeemed_at) AS last_at
    FROM public.code_redemptions cr
    JOIN public.redemption_codes rc ON rc.id = cr.code_id
    WHERE COALESCE(rc.reward_elite_vip_level,0) > 0 OR COALESCE(rc.reward_elite_vip_days,0) > 0
    GROUP BY cr.user_id
  )
  SELECT v.id, v.display_name, v.username, v.avatar_url, v.avatar_emoji,
         v.lvl, v.exp,
         round(EXTRACT(EPOCH FROM (v.exp - now())) / 86400.0, 2) AS days_left,
         CASE
           WHEN pur.last_at IS NOT NULL AND (cod.last_at IS NULL OR pur.last_at >= cod.last_at) THEN 'purchase'
           WHEN cod.last_at IS NOT NULL THEN 'code'
           ELSE 'admin'
         END AS source,
         pur.last_at, cod.last_at
  FROM v
  LEFT JOIN pur ON pur.user_id = v.id
  LEFT JOIN cod ON cod.user_id = v.id
  ORDER BY v.exp ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_elite_vips() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_elite_vips() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_elite_vip(_user_id uuid, _level int, _days numeric)
RETURNS TABLE(elite_vip_level int, elite_vip_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cur_exp timestamptz;
  _base timestamptz;
  _new_exp timestamptz;
  _new_lvl int;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _level IS NULL OR _level < 0 OR _level > 6 THEN
    RAISE EXCEPTION 'invalid level';
  END IF;

  SELECT p.elite_vip_expires_at INTO _cur_exp FROM public.profiles p WHERE p.id = _user_id;

  IF _level = 0 THEN
    UPDATE public.profiles
       SET elite_vip_level = 0, elite_vip_expires_at = NULL
     WHERE id = _user_id;
    _new_lvl := 0; _new_exp := NULL;
  ELSE
    _base := GREATEST(COALESCE(_cur_exp, now()), now());
    _new_exp := _base + make_interval(secs => COALESCE(_days,0) * 86400);
    IF _new_exp <= now() THEN
      _new_lvl := 0; _new_exp := NULL;
      UPDATE public.profiles SET elite_vip_level = 0, elite_vip_expires_at = NULL WHERE id = _user_id;
    ELSE
      _new_lvl := _level;
      UPDATE public.profiles
         SET elite_vip_level = _level, elite_vip_expires_at = _new_exp
       WHERE id = _user_id;
    END IF;
  END IF;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'elite_vip_set', _user_id,
          jsonb_build_object('level', _level, 'days', _days, 'new_expires_at', _new_exp));

  RETURN QUERY SELECT _new_lvl, _new_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_elite_vip(uuid, int, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_elite_vip(uuid, int, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_elite_vip(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles
     SET elite_vip_level = 0, elite_vip_expires_at = NULL
   WHERE id = _user_id;
  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'elite_vip_revoke', _user_id, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_elite_vip(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_revoke_elite_vip(uuid) TO authenticated;
