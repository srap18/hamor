CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _gems integer;
  _new_id uuid;
  _damage integer := 70000;
  _ships_hit integer := 0;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;

  SELECT gems INTO _gems FROM public.profiles WHERE id = _attacker FOR UPDATE;
  IF _gems IS NULL OR _gems < 500 THEN RAISE EXCEPTION 'insufficient gems'; END IF;

  UPDATE public.profiles SET gems = gems - 500 WHERE id = _attacker;

  -- Damage ALL of the target's live ships by 70,000 (AOE like a nuke).
  -- Destroy ships whose HP drops to <= 0 and free them from any in-progress activity.
  WITH hit AS (
    UPDATE public.ships_owned
    SET
      hp = GREATEST(0, hp - _damage),
      destroyed_at = CASE
        WHEN hp - _damage <= 0 THEN now()
        ELSE destroyed_at
      END,
      at_sea = CASE WHEN hp - _damage <= 0 THEN false ELSE at_sea END,
      fishing_started_at = CASE WHEN hp - _damage <= 0 THEN NULL ELSE fishing_started_at END,
      repair_ends_at = CASE WHEN hp - _damage <= 0 THEN NULL ELSE repair_ends_at END,
      stealing_target_user_id = CASE WHEN hp - _damage <= 0 THEN NULL ELSE stealing_target_user_id END,
      stealing_target_ship_id = CASE WHEN hp - _damage <= 0 THEN NULL ELSE stealing_target_ship_id END,
      stealing_ends_at = CASE WHEN hp - _damage <= 0 THEN NULL ELSE stealing_ends_at END
    WHERE user_id = _target_id
      AND destroyed_at IS NULL
    RETURNING id
  )
  SELECT count(*) INTO _ships_hit FROM hit;

  -- Log a single AOE attack record so both sides see it in their history.
  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, _damage, _damage * COALESCE(_ships_hit, 0), true);

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (
    _target_id,
    '📺💥 قنبلة إعلانية!',
    'تم تفجير قنبلة إعلانية على محيطك! 70,000 ضرر على كل سفنك، والإعلان يستمر ساعة. ادفع 100 جوهرة لإزالته.',
    'attack',
    _attacker
  );

  RETURN _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.launch_ad_bomb(uuid, text) TO authenticated;