
-- 1) Track how many submarines the user has claimed in the current VIP "cycle".
--    Resets to 0 every time the user tops up new VIP points (add_vip_points).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vip_subs_claimed integer NOT NULL DEFAULT 0;

-- 2) Helper: compute submarine HP for a given VIP level (5..10 → 60k..350k).
CREATE OR REPLACE FUNCTION public.vip_submarine_hp(_level int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _level IS NULL OR _level < 5 THEN 0
    ELSE LEAST(350000, GREATEST(60000, 60000 + (LEAST(_level, 10) - 5) * 58000))
  END;
$$;

-- 3) Auto-upgrade trigger on profiles: when vip_level changes, recompute HP of
--    all owned submarines so they auto-scale without re-claiming. HP never
--    drops below current; max_hp always set to the new tier; if max_hp grows,
--    the missing HP is added (so a fully-healthy sub stays fully healthy).
CREATE OR REPLACE FUNCTION public.tg_auto_upgrade_submarines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_hp int;
  delta  int;
BEGIN
  IF NEW.vip_level IS DISTINCT FROM OLD.vip_level AND NEW.vip_level >= 5 THEN
    new_hp := public.vip_submarine_hp(NEW.vip_level);
    IF new_hp > 0 THEN
      UPDATE public.ships_owned
         SET max_hp = new_hp,
             hp = LEAST(new_hp, hp + GREATEST(0, new_hp - max_hp))
       WHERE user_id = NEW.id
         AND catalog_code = 'submarine'
         AND max_hp < new_hp;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_upgrade_submarines ON public.profiles;
CREATE TRIGGER trg_auto_upgrade_submarines
AFTER UPDATE OF vip_level ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.tg_auto_upgrade_submarines();

-- 4) Reset claim counter whenever new VIP points are added (a "recharge").
--    This lets the user claim up to 3 fresh submarines per recharge.
CREATE OR REPLACE FUNCTION public.add_vip_points(_user uuid, _pts bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _pts IS NULL OR _pts <= 0 OR _user IS NULL THEN RETURN; END IF;
  UPDATE public.profiles
     SET vip_points       = vip_points + _pts,
         vip_level        = public.compute_vip_level(vip_points + _pts),
         vip_subs_claimed = 0
   WHERE id = _user;
END;
$$;

-- 5) Updated claim function: gate by vip_subs_claimed (not ship count), so
--    selling a claimed submarine does NOT let the user re-claim. They must
--    top up new VIP points to reset the counter.
CREATE OR REPLACE FUNCTION public.claim_vip_submarine()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_level int;
  v_expires timestamptz;
  v_claimed int;
  v_hp int;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT vip_level, vip_expires_at, COALESCE(vip_subs_claimed, 0)
    INTO v_level, v_expires, v_claimed
    FROM public.profiles WHERE id = uid FOR UPDATE;

  IF v_level IS NULL OR v_level < 5 THEN RAISE EXCEPTION 'need_vip_5'; END IF;
  IF v_expires IS NOT NULL AND v_expires < now() THEN RAISE EXCEPTION 'vip_expired'; END IF;
  IF v_claimed >= 3 THEN RAISE EXCEPTION 'already_claimed_recharge_required'; END IF;

  v_hp := public.vip_submarine_hp(v_level);

  INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code)
  VALUES (uid, 32, v_hp, v_hp, false, 'submarine')
  RETURNING id INTO new_id;

  UPDATE public.profiles
     SET vip_subs_claimed = v_claimed + 1
   WHERE id = uid;

  INSERT INTO public.transactions (user_id, kind, amount, currency, meta)
  VALUES (uid, 'claim_vip_submarine', 0, 'coins',
          jsonb_build_object('ship_id', new_id, 'vip_level', v_level, 'hp', v_hp, 'claim_index', v_claimed + 1));

  RETURN new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_vip_submarine() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vip_submarine_hp(int) TO authenticated;
