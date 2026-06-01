-- Cap & clamp abyss_titan price between 20 and 30 (no fluctuation beyond range).
UPDATE public.fish_market_prices
   SET current_price = 25,
       min_price     = 20,
       max_price     = 30,
       trend         = 0,
       forecast      = '[]'::jsonb,
       last_updated  = now()
 WHERE fish_id = 'abyss_titan';

INSERT INTO public.fish_market_prices (fish_id, current_price, min_price, max_price, trend, forecast)
SELECT 'abyss_titan', 25, 20, 30, 0, '[]'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.fish_market_prices WHERE fish_id = 'abyss_titan');

-- Updated: VIP 5+ can claim UP TO 3 submarines. HP/storage scales with VIP level
-- at claim time. All validation is server-side (SECURITY DEFINER) — clients
-- cannot fake their vip_level or bypass the 3-sub cap.
CREATE OR REPLACE FUNCTION public.claim_vip_submarine()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_level int;
  v_expires timestamptz;
  v_count int;
  v_hp int;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  -- Lock the profile row so concurrent claims can't race past the 3-sub cap.
  SELECT vip_level, vip_expires_at INTO v_level, v_expires
    FROM public.profiles WHERE id = uid FOR UPDATE;

  IF v_level IS NULL OR v_level < 5 THEN
    RAISE EXCEPTION 'need_vip_5';
  END IF;
  IF v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'vip_expired';
  END IF;

  -- HP & storage tiers, clamped server-side:
  --   L5 = 60,000   L6 = 118,000   L7 = 176,000
  --   L8 = 234,000  L9 = 292,000   L10+ = 350,000
  v_hp := LEAST(350000, GREATEST(60000, 60000 + (LEAST(v_level, 10) - 5) * 58000));

  SELECT count(*) INTO v_count
    FROM public.ships_owned
   WHERE user_id = uid AND catalog_code = 'submarine';

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'already_claimed';
  END IF;

  INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code)
  VALUES (uid, 32, v_hp, v_hp, false, 'submarine')
  RETURNING id INTO new_id;

  INSERT INTO public.transactions (user_id, kind, amount, currency, meta)
  VALUES (uid, 'claim_vip_submarine', 0, 'coins',
          jsonb_build_object('ship_id', new_id, 'vip_level', v_level, 'hp', v_hp, 'index', v_count + 1));

  RETURN new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_vip_submarine() TO authenticated;