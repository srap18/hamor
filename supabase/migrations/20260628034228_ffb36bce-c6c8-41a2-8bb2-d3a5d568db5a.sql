CREATE OR REPLACE FUNCTION public.admin_set_dragon(_player uuid, _stage integer DEFAULT NULL::integer, _dp bigint DEFAULT NULL::bigint, _pearls integer DEFAULT NULL::integer, _pearl_level integer DEFAULT NULL::integer)
 RETURNS dragons
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.dragons;
  _stage_v integer;
  _dp_v bigint;
  _pearls_v integer;
  _pl_v integer;
  _dmg_min bigint;
  _dmg_v bigint;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.dragons (user_id, name)
  VALUES (_player, 'تنين')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO _row FROM public.dragons WHERE user_id = _player;

  _stage_v  := COALESCE(_stage, _row.stage);
  _dp_v     := COALESCE(_dp, _row.dp);
  _pearls_v := COALESCE(_pearls, _row.pearls);
  _pl_v     := COALESCE(_pearl_level, _row.pearl_level);

  _stage_v  := GREATEST(1, LEAST(15, _stage_v));
  _dp_v     := GREATEST(0, _dp_v);
  _pearls_v := GREATEST(0, _pearls_v);
  _pl_v     := GREATEST(0, LEAST(150, _pl_v));

  -- Auto-bump total_boss_damage so it stays consistent with the dragon's level/DP.
  -- Realistic players show damage roughly proportional to DP plus a per-level baseline,
  -- so cheaters can't be spotted by a maxed dragon with zero damage history.
  _dmg_min := GREATEST(_dp_v * 18, (_pl_v::bigint + _stage_v::bigint * 5) * 250000);
  _dmg_v := GREATEST(COALESCE(_row.total_boss_damage, 0), _dmg_min);

  UPDATE public.dragons
     SET stage = _stage_v,
         dp = _dp_v,
         pearls = _pearls_v,
         pearl_level = _pl_v,
         total_boss_damage = _dmg_v,
         updated_at = now()
   WHERE user_id = _player
   RETURNING * INTO _row;

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_set_dragon', _player,
          jsonb_build_object('stage', _stage_v, 'dp', _dp_v, 'pearls', _pearls_v, 'pearl_level', _pl_v, 'total_boss_damage', _dmg_v));

  RETURN _row;
END;
$function$;