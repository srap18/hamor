-- 1) Launch ledger (daily cap + per-target cooldown)
CREATE TABLE public.kraken_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id uuid NOT NULL,
  target_id uuid NOT NULL,
  looted_qty bigint NOT NULL DEFAULT 0,
  looted_value bigint NOT NULL DEFAULT 0,
  blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.kraken_launches TO authenticated;
GRANT ALL ON public.kraken_launches TO service_role;
ALTER TABLE public.kraken_launches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kraken_launches_read_own" ON public.kraken_launches
  FOR SELECT TO authenticated
  USING (auth.uid() = attacker_id OR auth.uid() = target_id OR public.is_admin(auth.uid()));

CREATE INDEX idx_kraken_attacker_at ON public.kraken_launches(attacker_id, created_at DESC);
CREATE INDEX idx_kraken_pair_at ON public.kraken_launches(attacker_id, target_id, created_at DESC);

-- 2) Anti / disabler catalog additions
CREATE OR REPLACE FUNCTION public.buy_anti_to_inventory(_item_id text, _qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _unit_gems int;
  _total_gems int;
  _cur_gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty < 1 OR _qty > 50 THEN RAISE EXCEPTION 'bad qty'; END IF;

  _unit_gems := CASE _item_id
    WHEN 'anti_rocket'   THEN 50
    WHEN 'anti_nuke'     THEN 120
    WHEN 'anti_ad_bomb'  THEN 210
    WHEN 'anti_kraken'   THEN 600
    ELSE 0 END;
  IF _unit_gems = 0 THEN RAISE EXCEPTION 'invalid_anti'; END IF;

  _total_gems := _unit_gems * _qty;

  SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_gems IS NULL OR _cur_gems < _total_gems THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_total_gems, 0, 0);

  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_uid, 'anti', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'qty', _qty, 'gems_spent', _total_gems);
END;
$function$;

CREATE OR REPLACE FUNCTION public.buy_disabler_to_inventory(_item_id text, _qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user UUID := auth.uid();
  _price int;
  _total bigint;
  _cur_gems bigint;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _qty IS NULL OR _qty < 1 OR _qty > 50 THEN RAISE EXCEPTION 'bad_qty'; END IF;

  _price := CASE _item_id
    WHEN 'disabler_rocket'   THEN 100
    WHEN 'disabler_nuke'     THEN 300
    WHEN 'disabler_ad_bomb'  THEN 500
    WHEN 'disabler_kraken'   THEN 1000
    ELSE NULL
  END;
  IF _price IS NULL THEN RAISE EXCEPTION 'unknown_disabler'; END IF;

  _total := _price::bigint * _qty::bigint;

  SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _user FOR UPDATE;
  IF COALESCE(_cur_gems, 0) < _total THEN RAISE EXCEPTION 'insufficient gems'; END IF;

  PERFORM public._mutate_currency(_user, 0, (-_total)::int, 0, 0);

  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_user, 'disabler', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id) WHERE (meta IS NULL OR (meta ->> 'assigned_ship_id') IS NULL)
  DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'qty', _qty, 'gems_spent', _total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fire_disabler(_target_id uuid, _disabler_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker UUID := auth.uid();
  _qty int;
  _anti_id text;
  _name text;
  _attacker_name text;
  _target_name text;
  _until TIMESTAMPTZ;
  _cur TIMESTAMPTZ;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'bad_target'; END IF;

  CASE _disabler_id
    WHEN 'disabler_rocket'  THEN _anti_id := 'anti_rocket';   _name := 'مضاد الصواريخ';
    WHEN 'disabler_nuke'    THEN _anti_id := 'anti_nuke';     _name := 'مضاد القنبلة الذرية';
    WHEN 'disabler_ad_bomb' THEN _anti_id := 'anti_ad_bomb';  _name := 'مضاد القنبلة الإعلانية';
    WHEN 'disabler_kraken'  THEN _anti_id := 'anti_kraken';   _name := 'مضاد قنبلة الكراكن';
    ELSE RAISE EXCEPTION 'unknown_disabler';
  END CASE;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target_id) THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id
    FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'not_enough'; END IF;

  IF _qty = 1 THEN
    DELETE FROM public.inventory
      WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
      WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id;
  END IF;

  SELECT disabled_until INTO _cur FROM public.anti_disabled_state
    WHERE user_id = _target_id AND anti_id = _anti_id FOR UPDATE;
  _until := GREATEST(COALESCE(_cur, now()), now()) + interval '10 minutes';

  INSERT INTO public.anti_disabled_state(user_id, anti_id, disabled_until)
  VALUES (_target_id, _anti_id, _until)
  ON CONFLICT (user_id, anti_id) DO UPDATE SET disabled_until = EXCLUDED.disabled_until;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
  VALUES (_target_id, _attacker, 'anti_disabled',
    '⚡ تم تعطيل ' || _name,
    'اللاعب ' || COALESCE(_attacker_name,'لاعب') || ' عطّل ' || _name || ' لمدة 10 دقائق.',
    jsonb_build_object('anti_id', _anti_id, 'attacker_id', _attacker, 'disabled_until', _until));

  INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
  VALUES (_attacker, _attacker, 'anti_disabled_attacker',
    '⚡ ' || _name || ' معطّل',
    'عطّلت ' || _name || ' لدى ' || COALESCE(_target_name,'لاعب') || ' لمدة 10 دقائق.',
    jsonb_build_object('anti_id', _anti_id, 'defender_id', _target_id, 'disabled_until', _until));

  RETURN jsonb_build_object('ok', true, 'disabled_until', _until);
END;
$function$;

-- 3) Global feed accepts the new kind
CREATE OR REPLACE FUNCTION public.stamp_global_last_attack(_attacker_id uuid, _attacker_name text, _target_id uuid, _target_name text, _kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.global_last_attack(id, attacker_id, attacker_name, target_id, target_name, kind, at)
  VALUES (true, _attacker_id, _attacker_name, _target_id, _target_name, _kind, now())
  ON CONFLICT (id) DO UPDATE
    SET attacker_id = EXCLUDED.attacker_id,
        attacker_name = EXCLUDED.attacker_name,
        target_id = EXCLUDED.target_id,
        target_name = EXCLUDED.target_name,
        kind = EXCLUDED.kind,
        at = EXCLUDED.at;

  IF _kind IN ('nuke','ad_bomb','kraken') THEN
    INSERT INTO public.global_attack_feed(attacker_id, attacker_name, target_id, target_name, kind)
    VALUES (_attacker_id, _attacker_name, _target_id, _target_name, _kind);

    DELETE FROM public.global_attack_feed
     WHERE id IN (
       SELECT id FROM public.global_attack_feed ORDER BY at DESC OFFSET 20
     );
  END IF;
END;
$function$;

-- 4) The Kraken bomb itself
CREATE OR REPLACE FUNCTION public.launch_kraken_impl(_target_id uuid)
 RETURNS jsonb
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
  _blocked boolean := false;
  _dmg constant integer := 70000;
  _err text;
  _used int;
  _last timestamptz;
  _cap_left bigint := 0;
  _looted bigint := 0;
  _value bigint := 0;
  _take bigint;
  _r record;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  _err := public.pvp_attacker_requirement_error(_attacker);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  _err := public.pvp_defender_requirement_error(_target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _err; END IF;
  _err := public.pvp_pair_block_error(_attacker, _target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;

  -- daily cap (3 / 24h) and per-target cooldown (6h)
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

  -- Anti-kraken blocks the LOOT only; the blast still lands.
  _blocked := public._try_anti_block(_target_id, 'anti_kraken', 70);

  -- Blast: 70k to every ship at sea
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
     RETURNING t.applied_dmg AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  -- Loot the target's fish-market storage (capped by the attacker's free space)
  IF NOT _blocked THEN
    _cap_left := public.user_market_remaining(_attacker);
    FOR _r IN
      SELECT id, fish_id, base_value, quantity
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

      INSERT INTO public.fish_stock(user_id, fish_id, caught_at, base_value, quantity)
      VALUES (_attacker, _r.fish_id, now(), _r.base_value, _take);

      _cap_left := _cap_left - _take;
      _looted := _looted + _take;
      _value := _value + (_take * COALESCE(_r.base_value, 0));
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
      jsonb_build_object('attacker_id', _attacker, 'qty', _looted, 'value', _value));

    INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
    VALUES (_attacker, _attacker, 'kraken_loot_attacker',
      '🐙 الكراكن ابتلع مخزنه!',
      'سحبت ' || _looted || ' سمكة من مخزن ' || COALESCE(_target_name,'لاعب') || '.',
      jsonb_build_object('target_id', _target_id, 'qty', _looted, 'value', _value));

    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('kraken', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
            'ابتلع ' || _looted || ' سمكة من مخزنه', '🐙');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'attack_id', _attack_id,
    'blocked', _blocked,
    'ships_hit', _ships_hit,
    'looted_qty', _looted,
    'looted_value', _value
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.launch_kraken(_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_email_verified();
  RETURN public.launch_kraken_impl(_target_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.launch_kraken(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.launch_kraken_impl(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launch_kraken(uuid) TO authenticated;