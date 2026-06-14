CREATE OR REPLACE FUNCTION public.notify_attack_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attacker_name text;
  _attacker_emoji text;
  _new_hp int;
  _title text;
  _body text;
  _dealt int;
BEGIN
  IF NEW.defender_id IS NULL OR NEW.attacker_id IS NULL OR NEW.defender_id = NEW.attacker_id THEN
    RETURN NEW;
  END IF;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji
  FROM public.profiles WHERE id = NEW.attacker_id;
  IF _attacker_name IS NULL THEN _attacker_name := 'قرصان'; END IF;
  IF _attacker_emoji IS NULL THEN _attacker_emoji := '🏴‍☠️'; END IF;

  SELECT hp INTO _new_hp
  FROM public.ships_owned WHERE id = NEW.target_ship_id;

  _dealt := GREATEST(0, COALESCE(NEW.damage_dealt, NEW.damage, 0));

  IF NEW.target_ship_id IS NULL THEN
    _title := '💥 تفجير على محيطك!';
    _body := _attacker_emoji || ' ' || _attacker_name || ' فجّر محيطك' || CASE WHEN _dealt > 0 THEN ' (-' || _dealt || ' HP)' ELSE '' END;
  ELSIF COALESCE(NEW.attacker_won, false) OR COALESCE(_new_hp, 1) = 0 THEN
    _title := '💥 سفينتك تدمّرت!';
    _body := _attacker_emoji || ' ' || _attacker_name || ' دمّر سفينتك — لازم تصلحها';
  ELSE
    _title := '⚔️ هجوم!';
    _body := _attacker_emoji || ' ' || _attacker_name || ' هاجم سفينتك (-' || _dealt || ' HP)';
  END IF;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
  SELECT NEW.defender_id, _title, _body, 'attack', NEW.attacker_id,
         jsonb_build_object('attack_id', NEW.id, 'target_ship_id', NEW.target_ship_id, 'damage_dealt', _dealt)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_id = NEW.defender_id
      AND kind = 'attack'
      AND meta->>'attack_id' = NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_attack_received ON public.attacks;
CREATE TRIGGER trg_notify_attack_received
AFTER INSERT ON public.attacks
FOR EACH ROW EXECUTE FUNCTION public.notify_attack_received();

CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _attack_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _xp_award integer;
  _prot timestamptz;
  _attacker_name text;
  _attacker_emoji text;
  _target_name text;
  _total_damage integer := 0;
  _bomb_dmg integer := 70000;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  IF public.is_admin(_target_id) THEN
    RAISE EXCEPTION 'target is a staff account (protected)';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _attacker AND in_storage = false AND destroyed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'attacker has destroyed ship';
  END IF;
  IF NOT public.has_fishing_ship(_attacker) THEN
    RAISE EXCEPTION 'attacker needs fishing ship: send a ship to fish first';
  END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
  WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
    WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  WITH hit AS (
    UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg),
        destroyed_at = CASE
          WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 AND destroyed_at IS NULL
          THEN now() ELSE destroyed_at END,
        repair_ends_at = CASE
          WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 AND repair_ends_at IS NULL
          THEN now() + interval '4 hours' ELSE repair_ends_at END,
        at_sea = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN false ELSE at_sea END,
        fishing_started_at = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE fishing_started_at END,
        stealing_target_user_id = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE stealing_target_user_id END,
        stealing_target_ship_id = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE stealing_target_ship_id END,
        stealing_ends_at = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE stealing_ends_at END
    WHERE user_id = _target_id AND in_storage = false
    RETURNING id, LEAST(_bomb_dmg, COALESCE(max_hp, _bomb_dmg)) AS dealt
  )
  SELECT count(*), COALESCE(SUM(dealt), 0) INTO _ships_hit, _total_damage FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, _bomb_dmg, COALESCE(_total_damage, 0), true)
  RETURNING id INTO _attack_id;

  _xp_award := 250 * GREATEST(_ships_hit, 0);
  IF _xp_award > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp_award WHERE id = _attacker;
  END IF;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  UPDATE public.notifications
     SET title = '📺 قنبلة إعلانية!',
         body = COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' فجّر عليك قنبلة إعلانية',
         kind = 'attack',
         created_by = _attacker,
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('attack_id', _attack_id, 'ad_bomb_id', _new_id, 'event', 'ad_bomb')
   WHERE recipient_id = _target_id
     AND kind = 'attack'
     AND meta->>'attack_id' = _attack_id::text;

  INSERT INTO public.notifications (recipient_id, kind, title, body, created_by, meta)
  SELECT _target_id, 'attack', '📺 قنبلة إعلانية!',
         COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' فجّر عليك قنبلة إعلانية',
         _attacker,
         jsonb_build_object('attack_id', _attack_id, 'ad_bomb_id', _new_id, 'event', 'ad_bomb')
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_id = _target_id
      AND kind = 'attack'
      AND meta->>'attack_id' = _attack_id::text
  );

  PERFORM public.stamp_global_last_attack(
    _attacker, COALESCE(_attacker_name, 'لاعب'),
    _target_id, COALESCE(_target_name, 'لاعب'),
    'ad_bomb'
  );

  RETURN _new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.broadcast_nuke(_target_id uuid, _message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _msg text;
  _recent_nuke_count int;
  _attacker_name text;
  _attacker_emoji text;
  _target_name text;
  _is_ad boolean := false;
  _kind text;
  _emoji text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;
  _msg := btrim(coalesce(_message, ''));
  IF char_length(_msg) < 20 THEN RAISE EXCEPTION 'message must be at least 20 characters'; END IF;
  IF char_length(_msg) > 200 THEN _msg := substring(_msg, 1, 200); END IF;

  SELECT COUNT(*) INTO _recent_nuke_count FROM public.attacks
   WHERE attacker_id = _attacker AND defender_id = _target_id AND created_at > now() - interval '5 minutes';
  IF _recent_nuke_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ad_bombs
     WHERE attacker_id = _attacker AND target_user_id = _target_id
       AND started_at > now() - interval '5 minutes'
  ) INTO _is_ad;

  _kind  := CASE WHEN _is_ad THEN 'ad_bomb' ELSE 'nuke' END;
  _emoji := CASE WHEN _is_ad THEN '📺'     ELSE '☢️'   END;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  UPDATE public.profiles SET last_destroyer_message = _msg WHERE id = _target_id;

  INSERT INTO public.destroyer_messages (defender_id, attacker_id, attacker_name, kind, message)
  VALUES (_target_id, _attacker, _attacker_name, _kind, _msg);

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
  SELECT _target_id,
         CASE WHEN _is_ad THEN '📺 رسالة القنبلة الإعلانية' ELSE '☢️ رسالة التفجير النووي' END,
         COALESCE(_attacker_emoji, '🏴‍☠️') || ' ' || COALESCE(_attacker_name, 'لاعب') || ' فجّرك وكتب: ' || _msg,
         'attack',
         _attacker,
         jsonb_build_object('event', _kind || '_message', 'message', _msg)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_id = _target_id
      AND created_by = _attacker
      AND kind = 'attack'
      AND meta->>'event' = _kind || '_message'
      AND created_at > now() - interval '5 minutes'
  );

  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
  VALUES (_kind, _attacker, COALESCE(_attacker_name, 'لاعب'), _target_id, COALESCE(_target_name, 'لاعب'), _msg, _emoji);
END;
$$;

GRANT EXECUTE ON FUNCTION public.broadcast_nuke(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.launch_ad_bomb(uuid, text) TO authenticated;