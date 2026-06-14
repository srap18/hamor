CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone, damage_applied integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _base_damage integer;
  _mult numeric;
  _final_damage integer;
  _result record;
  _defender uuid;
BEGIN
  IF _attacker IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT damage INTO _base_damage FROM public.weapons_catalog WHERE id = _weapon_id;
  IF _base_damage IS NULL THEN
    RAISE EXCEPTION 'Unknown weapon: %', _weapon_id;
  END IF;

  _mult := public.get_combat_multiplier(_attacker);
  _final_damage := GREATEST(0, FLOOR(_base_damage * _mult))::integer;

  SELECT user_id INTO _defender FROM public.ships_owned WHERE id = _ship_id;

  SELECT * INTO _result
  FROM public.apply_ship_damage(_ship_id, _final_damage, _skip_fishing_check);

  -- Always log the attack so we never lose attribution
  IF _defender IS NOT NULL AND _defender <> _attacker THEN
    BEGIN
      INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
      VALUES (
        _attacker,
        _defender,
        _ship_id,
        _final_damage,
        _final_damage,
        COALESCE(_result.destroyed, false),
        0
      );
    EXCEPTION WHEN OTHERS THEN
      -- never block damage on logging failure, but the log SHOULD succeed
      NULL;
    END;
  END IF;

  RETURN QUERY SELECT _result.new_hp, _result.destroyed, _result.repair_ends_at, _final_damage;
END;
$function$;