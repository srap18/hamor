ALTER TABLE public.admin_audit DISABLE TRIGGER USER;

DO $$
DECLARE
  _hacker uuid := 'e382760e-a98c-4806-ba33-f705fee3bece';
  _admin uuid := '7035f6b9-7bb2-41e2-a8b8-050d0e7f41c0';
  _before int;
BEGIN
  SELECT gems INTO _before FROM public.profiles WHERE id = _hacker;
  IF _before IS NULL THEN RAISE NOTICE 'hacker profile not found'; RETURN; END IF;

  UPDATE public.profiles SET gems = 0 WHERE id = _hacker;

  INSERT INTO public.admin_audit(admin_id, target_user_id, action, details)
  VALUES (
    _admin, _hacker, 'reclaim_exploited_gems',
    jsonb_build_object(
      'gems_before', _before,
      'gems_after', 0,
      'reason', 'Reclaimed gems from deduct_gems_for_voice_change exploit',
      'via', 'migration'
    )
  );
END $$;

ALTER TABLE public.admin_audit ENABLE TRIGGER USER;

REVOKE EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_ship_damage(uuid, integer, boolean) FROM authenticated;