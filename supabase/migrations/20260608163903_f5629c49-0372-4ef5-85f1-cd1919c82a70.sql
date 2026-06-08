
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS golden_fisher_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_golden_fisher_until
  ON public.profiles(golden_fisher_until)
  WHERE golden_fisher_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _new_until timestamptz;
  _current timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _row
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = 'golden_fisher'
    AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
    AND quantity > 0
  ORDER BY acquired_at ASC
  FOR UPDATE
  LIMIT 1;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'no_golden_fisher_in_inventory';
  END IF;

  IF _row.quantity <= 1 THEN
    DELETE FROM public.inventory WHERE id = _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
  END IF;

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid;
  _new_until := GREATEST(COALESCE(_current, now()), now()) + interval '24 hours';

  UPDATE public.profiles
    SET golden_fisher_until = _new_until,
        protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
    WHERE id = _uid;

  RETURN jsonb_build_object('ok', true, 'until', _new_until);
END $$;

GRANT EXECUTE ON FUNCTION public.activate_golden_fisher() TO authenticated;

CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _qty int;
  _cycles int := 0;
  _ships_processed int := 0;
  _now timestamptz := now();
  _elapsed int;
  _full_cycles int;
  _is_active boolean;
BEGIN
  SELECT (golden_fisher_until IS NOT NULL AND golden_fisher_until > _now) INTO _is_active
    FROM public.profiles WHERE id = _user;
  IF NOT COALESCE(_is_active, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  FOR _ship IN
    SELECT * FROM public.ships_owned
    WHERE user_id = _user
      AND in_storage = false
      AND destroyed_at IS NULL
      AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
    FOR UPDATE
  LOOP
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code;
    IF _cat.id IS NULL THEN CONTINUE; END IF;
    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    IF _pool_len = 0 OR _cat.fishing_seconds <= 0 THEN CONTINUE; END IF;

    IF _ship.fishing_started_at IS NULL THEN
      UPDATE public.ships_owned
        SET fishing_started_at = _now, at_sea = true
        WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at))::int);
    _full_cycles := _elapsed / _cat.fishing_seconds;
    IF _full_cycles <= 0 THEN CONTINUE; END IF;
    IF _full_cycles > 20 THEN _full_cycles := 20; END IF;

    FOR i IN 1.._full_cycles LOOP
      _chosen := _pool->>floor(random() * _pool_len)::int;
      _qty := GREATEST(1, (_cat.fishing_power / 100)::int);

      INSERT INTO public.fish_caught (user_id, fish_id, quantity, total_caught, updated_at)
      VALUES (_user, _chosen, _qty, _qty, _now)
      ON CONFLICT (user_id, fish_id) DO UPDATE
        SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
            total_caught = public.fish_caught.total_caught + EXCLUDED.quantity,
            updated_at = _now;

      _cycles := _cycles + 1;
    END LOOP;

    UPDATE public.ships_owned
      SET fishing_started_at = _now,
          at_sea = true
      WHERE id = _ship.id;
    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END $$;

GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO service_role;

-- Patch attack guards
CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid, _target_ship_id uuid, _damage integer,
  _damage_dealt integer, _attacker_won boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _id uuid; _def_prot timestamptz; _def_gf timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf
    FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now())
     OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
    SET protection_until = NULL
    WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now()
      AND (golden_fisher_until IS NULL OR golden_fisher_until <= now());

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid, _target_ship_id uuid, _damage integer,
  _damage_dealt integer, _attacker_won boolean, _xp_gain integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _id uuid; _xp int; _def_prot timestamptz; _def_gf timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf
    FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now())
     OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
    SET protection_until = NULL
    WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now()
      AND (golden_fisher_until IS NULL OR golden_fisher_until <= now());

  _xp := GREATEST(0, COALESCE(_xp_gain, 0));
  IF _xp > 0 THEN
    UPDATE public.profiles SET xp = xp + _xp WHERE id = _uid;
  END IF;

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Patch start_steal_mission: prepend golden_fisher check by wrapping with trigger.
-- Cleanest: add a row-trigger on attacks insert is wrong path. We use a separate guard
-- function and call it from a wrapper; the easiest portable patch is to redefine
-- start_steal_mission preserving body — but body is long. Instead, add an
-- additional CHECK function that steal_fish/start_steal_mission will need.
-- For minimum scope we drop into start_steal_mission by appending early-exit guard
-- via REPLACE — but since recreating the whole long function risks drift, we add
-- a BEFORE INSERT trigger on attacks/stealing-related table instead.
-- Pragmatic approach: add a CHECK at the top of steal lifecycle by using a trigger
-- on ships_owned UPDATE when stealing_target_user_id is being set.
CREATE OR REPLACE FUNCTION public._block_steal_on_golden_fisher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _gf timestamptz;
BEGIN
  IF NEW.stealing_target_user_id IS NOT NULL
     AND (OLD.stealing_target_user_id IS DISTINCT FROM NEW.stealing_target_user_id) THEN
    SELECT golden_fisher_until INTO _gf FROM public.profiles WHERE id = NEW.stealing_target_user_id;
    IF _gf IS NOT NULL AND _gf > now() THEN
      RAISE EXCEPTION 'target protected by golden fisher';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_steal_on_golden_fisher ON public.ships_owned;
CREATE TRIGGER trg_block_steal_on_golden_fisher
BEFORE UPDATE ON public.ships_owned
FOR EACH ROW
EXECUTE FUNCTION public._block_steal_on_golden_fisher();
