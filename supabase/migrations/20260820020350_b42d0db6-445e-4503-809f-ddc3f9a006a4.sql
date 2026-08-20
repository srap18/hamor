CREATE OR REPLACE FUNCTION public.launch_doom_annihilator_impl(_target_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _attack_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _err text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.attacks
     WHERE attacker_id = _attacker AND defender_id = _target_id
       AND target_ship_id IS NULL
       AND created_at > now() - interval '8 seconds'
  ) THEN
    RAISE EXCEPTION 'انتظر 8 ثوانٍ قبل إطلاق قنبلة أخرى على نفس اللاعب';
  END IF;

  _err := public.pvp_attacker_requirement_error(_attacker);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  _err := public.pvp_defender_requirement_error(_target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _err; END IF;
  _err := public.pvp_pair_block_error(_attacker, _target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL;

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'doom_annihilator' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no doom_annihilator in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'doom_annihilator' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
     WHERE user_id = _attacker AND item_id = 'doom_annihilator' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  -- Unlimited destruction: no anti-block can stop it, HP is irrelevant.
  WITH targets AS (
    SELECT id, template_id, COALESCE(hp, max_hp, 100) AS old_hp
      FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND destroyed_at IS NULL
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = 0,
           destroyed_at = now(),
           repair_ends_at = now() + make_interval(secs => public._ship_repair_seconds(t.template_id)),
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING t.old_hp AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.ad_bombs(attacker_id, target_user_id, video_key, started_at, expires_at, active)
  VALUES (_attacker, _target_id, 'doom_annihilator', now(), now() + interval '1 hour', true);

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, LEAST(_total_damage, 2000000000)::int, LEAST(_total_damage, 2000000000)::int, _ships_hit > 0, 0)
  RETURNING id INTO _attack_id;

  PERFORM public.stamp_global_last_attack(_attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'), 'nuke');

  RETURN _attack_id;
END $function$;