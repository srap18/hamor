-- 1) Root cause: destroyed / under-repair ships were allowed to sail when repair
--    progress ratio >= 0.30, producing "destroyed but fishing/attacking" ships.
CREATE OR REPLACE FUNCTION public.set_ship_at_sea(_ship_id uuid, _at_sea boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _ratio numeric;
  _broken boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  PERFORM public._detect_bot_and_ban(_uid, CASE WHEN _at_sea THEN 'ship_start' ELSE 'ship_stop' END);
  IF EXISTS (
    SELECT 1 FROM public.bans
    WHERE user_id = _uid
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'banned_bot_detected';
  END IF;

  SELECT user_id, at_sea, fishing_started_at, destroyed_at, repair_ends_at, hp, max_hp
    INTO _row
    FROM public.ships_owned
   WHERE id = _ship_id
   FOR UPDATE;

  IF _row.user_id IS NULL OR _row.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  _ratio := CASE
    WHEN COALESCE(_row.max_hp, 0) > 0
      THEN COALESCE(_row.hp, 0)::numeric / _row.max_hp::numeric
    ELSE 1
  END;

  _broken := (_row.destroyed_at IS NOT NULL)
          OR (_row.repair_ends_at IS NOT NULL AND _row.repair_ends_at > now());

  IF _at_sea THEN
    -- A destroyed / under-repair ship can never sail, regardless of repair progress.
    IF _broken OR _ratio < 0.30 THEN
      UPDATE public.ships_owned
         SET at_sea = false,
             fishing_started_at = NULL
       WHERE id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;

    IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
      RETURN;
    END IF;

    UPDATE public.ships_owned
       SET at_sea = true,
           fishing_started_at = now()
     WHERE id = _ship_id;
    RETURN;
  END IF;

  -- Docking: a destroyed ship cannot harvest, dock it directly.
  IF _broken OR _ratio < 0.30 THEN
    UPDATE public.ships_owned
       SET at_sea = false,
           fishing_started_at = NULL
     WHERE id = _ship_id;
    RETURN;
  END IF;

  IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
    PERFORM 1 FROM public.collect_fishing_reward(_ship_id, NULL::text, NULL::integer);
    RETURN;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL
   WHERE id = _ship_id;
END;
$function$;

-- 2) Single canonical attack gate: also requires that the attacker has no
--    destroyed / under-repair ship outside storage. Every attack entry point
--    (rockets, nuke, ad bomb, kraken, record_attack) funnels through this.
CREATE OR REPLACE FUNCTION public.pvp_attack_ready_error(_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _m int; _n int;
BEGIN
  IF _user_id IS NULL THEN RETURN 'not authenticated'; END IF;
  IF public.is_admin(_user_id) THEN RETURN NULL; END IF;

  _m := public.effective_market_level(_user_id);
  IF _m < 15 THEN
    RETURN '🛡️ أنت داخل الحصانة: تحتاج سوق سفن مستوى 15 أو أعلى للهجوم (الحالي: ' || _m::text || ').';
  END IF;

  IF public.attacker_has_destroyed_ship(_user_id) THEN
    RETURN '🚫 لا يمكنك الهجوم: لديك سفينة مدمّرة أو تحت الإصلاح — أصلح أسطولك أولاً.';
  END IF;

  _n := public.pvp_eligible_ship_count(_user_id, 15);
  IF _n < 3 THEN
    RETURN '🚫 لا يمكنك الهجوم: تحتاج 3 سفن مستوى 15 أو أعلى مبحرة وفي وضع الصيد وغير مدمّرة (' || _n::text || '/3).';
  END IF;

  RETURN NULL;
END $function$;

-- 3) Repair the inconsistent live rows: destroyed / under-repair ships that are
--    currently flagged as sailing get docked.
UPDATE public.ships_owned
   SET at_sea = false,
       fishing_started_at = NULL
 WHERE COALESCE(in_storage, false) = false
   AND COALESCE(at_sea, false) = true
   AND (destroyed_at IS NOT NULL OR (repair_ends_at IS NOT NULL AND repair_ends_at > now()));