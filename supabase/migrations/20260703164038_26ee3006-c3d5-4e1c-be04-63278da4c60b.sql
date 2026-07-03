-- Remove Golden Fisher shield (protection) behavior.
-- 1) Update activate_golden_fisher to no longer grant protection_until.
-- 2) Clear currently active shields that were granted purely by Golden Fisher
--    (protection_until equals or lies within the golden_fisher_until window).

CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record; _current timestamptz; _new_until timestamptz; _base timestamptz;
  _had_inventory boolean := false; _tick jsonb; _is_admin boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public._require_market_level(10);

  SELECT public.has_role(_uid, 'admin'::public.app_role) INTO _is_admin;
  _is_admin := COALESCE(_is_admin, false);

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row FROM public.inventory
   WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'golden_fisher'
     AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL) AND quantity > 0
   ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NOT NULL THEN
    _had_inventory := true;
    IF _row.quantity <= 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
    ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;
    _base := GREATEST(COALESCE(_current, now()), now());
    _new_until := _base + interval '24 hours';
  ELSE
    IF _is_admin THEN
      _base := GREATEST(COALESCE(_current, now()), now());
      _new_until := _base + interval '24 hours';
    ELSIF _current IS NULL OR _current <= now() THEN
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    ELSE
      _new_until := _current;
    END IF;
  END IF;

  -- No more shield/protection from Golden Fisher.
  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         golden_fisher_no_shield = true
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL,
         stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE stealing_target_user_id = _uid;

  UPDATE public.ships_owned s
     SET at_sea = true, fishing_started_at = now(), last_fishing_reward_at = now()
    FROM public.ship_catalog c
   WHERE c.code = s.catalog_code
     AND s.user_id = _uid AND s.in_storage = false AND s.destroyed_at IS NULL
     AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
     AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL
     AND (COALESCE(s.at_sea, false) = false OR s.fishing_started_at IS NULL);

  UPDATE public.ships_owned
     SET at_sea = true
   WHERE user_id = _uid AND in_storage = false AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= now())
     AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
     AND fishing_started_at IS NOT NULL AND COALESCE(at_sea, false) = false;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'already_active', (_current IS NOT NULL AND _current > now() AND NOT _had_inventory),
    'extended', _had_inventory,
    'admin_test', (_is_admin AND NOT _had_inventory),
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;

-- Clear currently-active shields granted by Golden Fisher.
-- Heuristic: if the user's protection_until equals or is within their golden_fisher_until window,
-- the shield came from Golden Fisher and should be removed.
UPDATE public.profiles
   SET protection_until = NULL,
       golden_fisher_no_shield = true
 WHERE golden_fisher_until IS NOT NULL
   AND golden_fisher_until > now()
   AND protection_until IS NOT NULL
   AND protection_until <= golden_fisher_until + interval '1 minute';

-- Update the store price for Golden Fisher to 1500 gems.
UPDATE public.client_item_prices
   SET price_gems = 1500
 WHERE item_type = 'crew' AND item_id = 'golden_fisher';