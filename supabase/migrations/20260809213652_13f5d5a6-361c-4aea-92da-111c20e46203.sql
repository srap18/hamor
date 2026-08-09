CREATE OR REPLACE FUNCTION public.launch_kraken_impl(_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _attacker uuid := auth.uid();
  _attack_id uuid;
  _ships_hit integer := 0;
  _ships_destroyed integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
  _dmg constant integer := 70000;
  _err text;
  _used int;
  _last timestamptz;
  _cap_left bigint := 0;
  _cap_before bigint := 0;
  _victim_total bigint := 0;
  _looted bigint := 0;
  _value bigint := 0;
  _take bigint;
  _r record;
  _details jsonb := '[]'::jsonb;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  PERFORM public._enforce_rate_limit('kraken', 3000);

  _err := public.pvp_attacker_requirement_error(_attacker);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  _err := public.pvp_defender_requirement_error(_target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _err; END IF;
  _err := public.pvp_pair_block_error(_attacker, _target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;

  SELECT COUNT(*)::int INTO _used FROM public.kraken_launches
   WHERE attacker_id = _attacker AND created_at > now() - interval '24 hours';
  IF _used >= 3 THEN RAISE EXCEPTION 'kraken_daily_limit'; END IF;

  SELECT MAX(created_at) INTO _last FROM public.kraken_launches
   WHERE attacker_id = _attacker AND target_id = _target_id
     AND created_at > now() - interval '6 hours';
  IF _last IS NOT NULL THEN RAISE EXCEPTION 'kraken_target_cooldown'; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL;

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'kraken_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no kraken_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'kraken_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
     WHERE user_id = _attacker AND item_id = 'kraken_bomb' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  _blocked := public._try_anti_block(_target_id, 'anti_kraken', 70);

  WITH targets AS (
    SELECT id, template_id,
           LEAST(_dmg, GREATEST(COALESCE(hp, max_hp, 100), 0)) AS applied_dmg,
           GREATEST(COALESCE(hp, max_hp, 100) - _dmg, 0) AS new_hp
      FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND destroyed_at IS NULL
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = t.new_hp,
           destroyed_at = CASE WHEN t.new_hp <= 0 THEN now() ELSE s.destroyed_at END,
           repair_ends_at = CASE WHEN t.new_hp <= 0
                                 THEN now() + make_interval(secs => public._ship_repair_seconds(t.template_id))
                                 ELSE s.repair_ends_at END,
           at_sea = CASE WHEN t.new_hp <= 0 THEN false ELSE s.at_sea END,
           fishing_started_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.fishing_started_at END,
           stealing_target_user_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_user_id END,
           stealing_target_ship_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_ship_id END,
           stealing_ends_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_ends_at END
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING t.applied_dmg AS applied, t.new_hp AS new_hp
  )
  SELECT COUNT(*)::int,
         COALESCE(SUM(applied),0)::bigint,
         COUNT(*) FILTER (WHERE new_hp <= 0)::int
    INTO _ships_hit, _total_damage, _ships_destroyed
    FROM upd;

  SELECT COALESCE(SUM(GREATEST(quantity,0)),0)::bigint INTO _victim_total
    FROM public.fish_stock WHERE user_id = _target_id;

  _cap_before := public.user_market_remaining(_attacker);
  _cap_left := _cap_before;

  IF NOT _blocked THEN
    FOR _r IN
      SELECT id, fish_id, base_value, quantity, caught_at
        FROM public.fish_stock
       WHERE user_id = _target_id AND quantity > 0
       ORDER BY base_value DESC, caught_at ASC
       FOR UPDATE
    LOOP
      EXIT WHEN _cap_left <= 0;
      _take := LEAST(_r.quantity, _cap_left);
      IF _take <= 0 THEN CONTINUE; END IF;

      IF _take >= _r.quantity THEN
        DELETE FROM public.fish_stock WHERE id = _r.id;
      ELSE
        UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _r.id;
      END IF;

      -- keep the ORIGINAL caught_at so looted fish cannot dodge the rot timer
      INSERT INTO public.fish_stock(user_id, fish_id, caught_at, base_value, quantity)
      VALUES (_attacker, _r.fish_id, _r.caught_at, _r.base_value, _take);

      _cap_left := _cap_left - _take;
      _looted := _looted + _take;
      _value := _value + (_take * COALESCE(_r.base_value, 0));
      _details := _details || jsonb_build_object(
        'fish_id', _r.fish_id, 'qty', _take, 'value', _take * COALESCE(_r.base_value,0));
    END LOOP;
  END IF;

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage::int, _total_damage::int, _ships_hit > 0, 0)
  RETURNING id INTO _attack_id;

  INSERT INTO public.kraken_launches(attacker_id, target_id, looted_qty, looted_value, blocked)
  VALUES (_attacker, _target_id, _looted, _value, _blocked);

  PERFORM public.add_xp(_attacker, 700);
  PERFORM public.stamp_global_last_attack(_attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'), 'kraken');

  IF _blocked THEN
    PERFORM public._upsert_anti_block_notif(_target_id, 'anti_block',          _attacker, _attacker_name, 'قنبلة الكراكن', 'anti_kraken');
    PERFORM public._upsert_anti_block_notif(_attacker,  'anti_block_attacker', _target_id, _target_name,  'قنبلة الكراكن', 'anti_kraken');
    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('anti_block', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
            'قنبلة الكراكن', '🐙');
  ELSIF _looted > 0 THEN
    INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
    VALUES (_target_id, _attacker, 'kraken_looted',
      '🐙 نُهب مخزن سمكك!',
      COALESCE(_attacker_name,'لاعب') || ' ضرب محيطك بقنبلة الكراكن وسحب ' || _looted || ' سمكة من مخزنك.',
      jsonb_build_object('attacker_id', _attacker, 'qty', _looted, 'value', _value, 'details', _details));

    INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
    VALUES (_attacker, _attacker, 'kraken_loot_attacker',
      '🐙 الكراكن ابتلع مخزنه!',
      'سحبت ' || _looted || ' سمكة من مخزن ' || COALESCE(_target_name,'لاعب') || '.',
      jsonb_build_object('target_id', _target_id, 'qty', _looted, 'value', _value, 'details', _details));

    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('kraken', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
            'ابتلع ' || _looted || ' سمكة من مخزنه', '🐙');
  ELSE
    INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
    VALUES (_attacker, _attacker, 'kraken_loot_attacker',
      '🐙 انفجر الكراكن بدون نهب',
      CASE WHEN _cap_before <= 0
           THEN 'مخزن سمكك ممتلئ — ما قدر الكراكن يسحب شي من ' || COALESCE(_target_name,'لاعب') || '.'
           ELSE 'مخزن ' || COALESCE(_target_name,'لاعب') || ' فاضي — ما فيه سمك للنهب.' END,
      jsonb_build_object('target_id', _target_id, 'qty', 0, 'free_space', _cap_before, 'victim_stock', _victim_total));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'attack_id', _attack_id,
    'blocked', _blocked,
    'ships_hit', _ships_hit,
    'ships_destroyed', _ships_destroyed,
    'total_damage', _total_damage,
    'looted_qty', _looted,
    'looted_value', _value,
    'loot_details', _details,
    'free_space_before', _cap_before,
    'free_space_after', _cap_left,
    'victim_stock_before', _victim_total,
    'target_name', COALESCE(_target_name,'لاعب')
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.launch_kraken_impl(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launch_kraken(uuid) TO authenticated;