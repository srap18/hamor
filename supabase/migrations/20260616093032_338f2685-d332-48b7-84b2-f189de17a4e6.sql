CREATE OR REPLACE FUNCTION public.attack_grant_tribe_gems()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _att_lvl int; _def_lvl int; _today date := (now() AT TIME ZONE 'UTC')::date;
  _cur_wins int; _cur_kills int; _ship_lvl int := 0;
  _gain int := 0; _kill_gain int := 0;
  _pair_wins int; _pair_kills int;
BEGIN
  IF NEW.attacker_won IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT level INTO _att_lvl FROM public.profiles WHERE id = NEW.attacker_id;
  SELECT level INTO _def_lvl FROM public.profiles WHERE id = NEW.defender_id;

  IF _def_lvl IS NULL OR _att_lvl IS NULL OR _def_lvl < _att_lvl - 5 THEN
    RETURN NEW;
  END IF;

  -- Anti-farming: cap rewards per (attacker, defender) pair per day
  -- Prevents farming defenders whose ships auto-heal
  SELECT COUNT(*) FILTER (WHERE attacker_won IS TRUE),
         COUNT(*) FILTER (WHERE attacker_won IS TRUE
                          AND target_ship_id IS NOT NULL
                          AND damage_dealt > 0)
    INTO _pair_wins, _pair_kills
    FROM public.attacks
    WHERE attacker_id = NEW.attacker_id
      AND defender_id = NEW.defender_id
      AND created_at >= _today::timestamptz
      AND id <> NEW.id;

  IF NEW.target_ship_id IS NOT NULL THEN
    SELECT template_id INTO _ship_lvl FROM public.ships_owned WHERE id = NEW.target_ship_id;
    _ship_lvl := COALESCE(_ship_lvl, 0);
  END IF;

  INSERT INTO public.tribe_gem_daily(user_id, day)
    VALUES (NEW.attacker_id, _today)
    ON CONFLICT (user_id, day) DO NOTHING;
  SELECT pvp_wins, ship_kills INTO _cur_wins, _cur_kills
    FROM public.tribe_gem_daily WHERE user_id = NEW.attacker_id AND day = _today;

  -- Only 1 win-gem per defender per day
  IF COALESCE(_cur_wins, 0) < 5 AND COALESCE(_pair_wins, 0) = 0 THEN
    _gain := 1;
  END IF;

  -- Only 1 ship-kill-gem per defender per day
  IF _ship_lvl >= 15 AND NEW.damage_dealt > 0
     AND COALESCE(_cur_kills, 0) < 3
     AND COALESCE(_pair_kills, 0) = 0
     AND EXISTS(SELECT 1 FROM public.ships_owned WHERE id = NEW.target_ship_id AND hp <= 0) THEN
    _kill_gain := 2;
  END IF;

  IF _gain + _kill_gain > 0 THEN
    UPDATE public.profiles SET tribe_gems = tribe_gems + _gain + _kill_gain WHERE id = NEW.attacker_id;
    UPDATE public.tribe_gem_daily
      SET pvp_wins = pvp_wins + (CASE WHEN _gain > 0 THEN 1 ELSE 0 END),
          ship_kills = ship_kills + (CASE WHEN _kill_gain > 0 THEN 1 ELSE 0 END)
      WHERE user_id = NEW.attacker_id AND day = _today;
  END IF;
  RETURN NEW;
END $function$;