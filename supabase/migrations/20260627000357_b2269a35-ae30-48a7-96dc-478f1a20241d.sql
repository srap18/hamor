
CREATE OR REPLACE FUNCTION public.admin_set_dragon(
  _player uuid,
  _stage integer DEFAULT NULL,
  _dp bigint DEFAULT NULL,
  _pearls integer DEFAULT NULL,
  _pearl_level integer DEFAULT NULL
)
RETURNS public.dragons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.dragons;
  _stage_v integer;
  _dp_v bigint;
  _pearls_v integer;
  _pl_v integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Ensure a dragon row exists
  INSERT INTO public.dragons (user_id, name)
  VALUES (_player, 'تنين')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO _row FROM public.dragons WHERE user_id = _player;

  _stage_v  := COALESCE(_stage, _row.stage);
  _dp_v     := COALESCE(_dp, _row.dp);
  _pearls_v := COALESCE(_pearls, _row.pearls);
  _pl_v     := COALESCE(_pearl_level, _row.pearl_level);

  -- Clamp ranges
  _stage_v  := GREATEST(1, LEAST(15, _stage_v));
  _dp_v     := GREATEST(0, _dp_v);
  _pearls_v := GREATEST(0, _pearls_v);
  _pl_v     := GREATEST(0, LEAST(150, _pl_v));

  UPDATE public.dragons
     SET stage = _stage_v,
         dp = _dp_v,
         pearls = _pearls_v,
         pearl_level = _pl_v,
         updated_at = now()
   WHERE user_id = _player
   RETURNING * INTO _row;

  INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_set_dragon', _player,
          jsonb_build_object('stage', _stage_v, 'dp', _dp_v, 'pearls', _pearls_v, 'pearl_level', _pl_v));

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_dragon(uuid, integer, bigint, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_dragon(uuid, integer, bigint, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_max_dragon(_player uuid)
RETURNS public.dragons
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.admin_set_dragon(_player, 15, 30600000::bigint, 999999, 150);
$$;

REVOKE ALL ON FUNCTION public.admin_max_dragon(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_max_dragon(uuid) TO authenticated;
