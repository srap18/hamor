
-- Retry after transient deadlock. Idempotent.

CREATE OR REPLACE FUNCTION public._enforce_combat_cooldown()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _prev timestamptz;
  _wait int;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  SELECT last_at INTO _prev
    FROM public.user_action_throttle
   WHERE user_id = _uid AND action = 'combat_action'
   FOR UPDATE;

  IF _prev IS NOT NULL AND (now() - _prev) < interval '5 seconds' THEN
    _wait := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (interval '5 seconds' - (now() - _prev))))::int);
    RAISE EXCEPTION 'combat_cooldown انتظر % ثانية بين الهجوم والإصلاح', _wait
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.user_action_throttle(user_id, action, last_at)
  VALUES (_uid, 'combat_action', now())
  ON CONFLICT (user_id, action) DO UPDATE SET last_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public._enforce_combat_cooldown() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._require_ship_at_sea(_uid uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n int;
BEGIN
  SELECT COUNT(*) INTO _n
    FROM public.ships_owned
   WHERE user_id = _uid
     AND COALESCE(at_sea, false) = true
     AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= now());
  IF _n < 1 THEN
    RAISE EXCEPTION 'must_be_sailing يجب أن تكون سفينتك مبحرة قبل الهجوم';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public._require_ship_at_sea(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid,
  _target_ship_id uuid,
  _damage integer,
  _damage_dealt integer,
  _attacker_won boolean,
  _xp_gain integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _def_prot timestamptz;
  _def_gf timestamptz;
  _def_gf_no_shield boolean;
  _mult numeric;
  _req_error text;
  _gf_shields boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  PERFORM public._enforce_combat_cooldown();

  PERFORM public._prep_pvp_checks(_uid);
  PERFORM public._prep_pvp_checks(_defender_id);

  IF NOT public.is_admin(_uid) THEN
    PERFORM public._require_ship_at_sea(_uid);
    _req_error := public.pvp_requirement_error(_uid, 'attacker');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
    _req_error := public.pvp_requirement_error(_defender_id, 'defender');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  END IF;

  SELECT protection_until, golden_fisher_until, COALESCE(golden_fisher_no_shield, false)
    INTO _def_prot, _def_gf, _def_gf_no_shield
    FROM public.profiles WHERE id = _defender_id;

  _gf_shields := (_def_gf IS NOT NULL AND _def_gf > now() AND NOT _def_gf_no_shield);

  IF (_def_prot IS NOT NULL AND _def_prot > now()) OR _gf_shields THEN
    IF _gf_shields THEN
      UPDATE public.profiles
        SET protection_until = GREATEST(COALESCE(protection_until, _def_gf), _def_gf)
        WHERE id = _defender_id;
    END IF;
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _uid
     AND protection_until IS NOT NULL AND protection_until > now();

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END
$$;

CREATE OR REPLACE FUNCTION public._touch_combat_cooldown_on_repair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF (
    (OLD.destroyed_at IS NOT NULL AND NEW.destroyed_at IS NULL)
    OR (OLD.repair_ends_at IS NOT NULL AND NEW.repair_ends_at IS NULL)
    OR (COALESCE(NEW.hp,0) > COALESCE(OLD.hp,0)
        AND COALESCE(NEW.hp,0) >= COALESCE(NEW.max_hp,0)
        AND COALESCE(OLD.hp,0) < COALESCE(NEW.max_hp,0))
  ) THEN
    INSERT INTO public.user_action_throttle(user_id, action, last_at)
    VALUES (NEW.user_id, 'combat_action', now())
    ON CONFLICT (user_id, action) DO UPDATE SET last_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_combat_cooldown_on_repair ON public.ships_owned;
CREATE TRIGGER trg_touch_combat_cooldown_on_repair
AFTER UPDATE ON public.ships_owned
FOR EACH ROW
EXECUTE FUNCTION public._touch_combat_cooldown_on_repair();
