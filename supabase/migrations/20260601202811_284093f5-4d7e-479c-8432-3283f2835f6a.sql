
-- Seed market price for new exclusive fish
INSERT INTO public.fish_market_prices (fish_id, current_price, min_price, max_price, trend, forecast)
VALUES ('abyss_titan', 60, 40, 90, 0, '[]'::jsonb)
ON CONFLICT (fish_id) DO NOTHING;

-- VIP exclusive submarine: granted once per user, requires VIP level >= 5.
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
  already uuid;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT vip_level, vip_expires_at INTO v_level, v_expires
    FROM public.profiles WHERE id = uid FOR UPDATE;
  IF v_level IS NULL OR v_level < 5 THEN
    RAISE EXCEPTION 'need_vip_5';
  END IF;
  IF v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'vip_expired';
  END IF;

  -- Only one submarine per user, ever.
  SELECT id INTO already
    FROM public.ships_owned
   WHERE user_id = uid AND catalog_code = 'submarine'
   LIMIT 1;
  IF already IS NOT NULL THEN
    RAISE EXCEPTION 'already_claimed';
  END IF;

  INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code)
  VALUES (uid, 32, 60000, 60000, false, 'submarine')
  RETURNING id INTO new_id;

  INSERT INTO public.transactions (user_id, kind, amount, currency, meta)
  VALUES (uid, 'claim_vip_submarine', 0, 'coins', jsonb_build_object('ship_id', new_id));

  RETURN new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_vip_submarine() TO authenticated;
