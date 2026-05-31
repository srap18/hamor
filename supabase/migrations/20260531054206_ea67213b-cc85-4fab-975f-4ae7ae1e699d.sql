
-- 1. Add VIP fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vip_level integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vip_points bigint NOT NULL DEFAULT 0;

-- 2. New player starter resources: 1000 gold + 1000 gems
ALTER TABLE public.profiles ALTER COLUMN coins SET DEFAULT 1000;
ALTER TABLE public.profiles ALTER COLUMN gems  SET DEFAULT 1000;

-- 3. Helper: compute VIP level from accumulated points
CREATE OR REPLACE FUNCTION public.compute_vip_level(_points bigint)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _points >= 1500000 THEN 10
    WHEN _points >=  600000 THEN 9
    WHEN _points >=  250000 THEN 8
    WHEN _points >=  100000 THEN 7
    WHEN _points >=   40000 THEN 6
    WHEN _points >=   15000 THEN 5
    WHEN _points >=    5000 THEN 4
    WHEN _points >=    2000 THEN 3
    WHEN _points >=     500 THEN 2
    ELSE 1
  END;
$$;

-- 4. Helper: add VIP points & recompute level
CREATE OR REPLACE FUNCTION public.add_vip_points(_user uuid, _pts bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _pts IS NULL OR _pts <= 0 OR _user IS NULL THEN RETURN; END IF;
  UPDATE public.profiles
     SET vip_points = vip_points + _pts,
         vip_level  = public.compute_vip_level(vip_points + _pts)
   WHERE id = _user;
END;
$$;

-- 5. Update redeem_code to award VIP points
-- Points formula: 1 gem = 10 pts, 100 coins = 1 pt, 100 xp = 1 pt
-- For item/ship rewards: lookup catalog price (gems*10 + coins/100)
CREATE OR REPLACE FUNCTION public.redeem_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_row  public.redemption_codes%ROWTYPE;
  v_template_id INTEGER;
  v_vip_pts bigint := 0;
  v_price_coins bigint := 0;
  v_price_gems integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_row FROM public.redemption_codes
   WHERE code = upper(trim(p_code)) FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_code'; END IF;
  IF NOT v_row.active THEN RAISE EXCEPTION 'code_disabled'; END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN RAISE EXCEPTION 'code_expired'; END IF;
  IF v_row.uses_count >= v_row.max_uses THEN RAISE EXCEPTION 'code_exhausted'; END IF;
  IF EXISTS (SELECT 1 FROM public.code_redemptions WHERE code_id = v_row.id AND user_id = v_user) THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

  IF v_row.reward_type = 'bundle' THEN
    UPDATE public.profiles
       SET coins = coins + v_row.reward_coins,
           gems  = gems  + v_row.reward_gems,
           xp    = xp    + v_row.reward_xp
     WHERE id = v_user;
    v_vip_pts := (v_row.reward_gems * 10) + (v_row.reward_coins / 100) + (v_row.reward_xp / 100);

  ELSIF v_row.reward_type = 'item' THEN
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (v_user, COALESCE(v_row.item_kind, 'misc'), v_row.item_id, GREATEST(v_row.quantity, 1));
    SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
      FROM public.items_catalog WHERE code = v_row.item_id LIMIT 1;
    v_vip_pts := ((COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100)) * GREATEST(v_row.quantity, 1);

  ELSIF v_row.reward_type = 'ship' THEN
    SELECT sort_order INTO v_template_id FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp)
    SELECT v_user, COALESCE(v_template_id, 1), v_row.item_id, max_hp, max_hp
      FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    SELECT price_coins, price_gems INTO v_price_coins, v_price_gems
      FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    v_vip_pts := (COALESCE(v_price_gems,0) * 10) + (COALESCE(v_price_coins,0) / 100);
  END IF;

  INSERT INTO public.code_redemptions (code_id, user_id) VALUES (v_row.id, v_user);
  UPDATE public.redemption_codes SET uses_count = uses_count + 1 WHERE id = v_row.id;

  -- Award VIP points
  PERFORM public.add_vip_points(v_user, v_vip_pts);

  RETURN jsonb_build_object(
    'ok', true,
    'reward_type', v_row.reward_type,
    'item_id', v_row.item_id,
    'reward_coins', v_row.reward_coins,
    'reward_gems', v_row.reward_gems,
    'reward_xp', v_row.reward_xp,
    'quantity', v_row.quantity,
    'vip_points_earned', v_vip_pts
  );
END;
$function$;

-- 6. Update grant_paddle_purchase to award VIP points (1 cent = 1 pt → $1 = 100 pts)
CREATE OR REPLACE FUNCTION public.grant_paddle_purchase(
  _txn_id text, _user uuid, _pack_id text, _amount_cents integer,
  _gems integer, _coins bigint, _rubies integer, _shield_days integer,
  _vip_days integer, _env text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_existing record;
BEGIN
  SELECT * INTO v_existing FROM public.paddle_purchases WHERE paddle_transaction_id = _txn_id;
  IF found AND v_existing.granted THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'pack_id', v_existing.pack_id);
  END IF;

  INSERT INTO public.paddle_purchases (user_id, paddle_transaction_id, pack_id, status, amount_cents, granted, granted_at, environment)
  VALUES (_user, _txn_id, _pack_id, 'paid', _amount_cents, true, now(), _env)
  ON CONFLICT (paddle_transaction_id) DO UPDATE SET status='paid', granted=true, granted_at=now();

  IF coalesce(_gems,0) > 0 OR coalesce(_coins,0) > 0 OR coalesce(_rubies,0) > 0 THEN
    UPDATE public.profiles
       SET gems = gems + coalesce(_gems,0),
           coins = coins + coalesce(_coins,0),
           rubies = rubies + coalesce(_rubies,0)
     WHERE id = _user;
  END IF;

  IF coalesce(_shield_days,0) > 0 THEN
    UPDATE public.profiles
       SET protection_until = greatest(coalesce(protection_until, now()), now()) + (_shield_days || ' days')::interval
     WHERE id = _user;
  END IF;

  IF coalesce(_vip_days,0) > 0 THEN
    UPDATE public.profiles
       SET protection_until = greatest(coalesce(protection_until, now()), now()) + (_vip_days || ' days')::interval
     WHERE id = _user;
  END IF;

  -- VIP points from real money: 1 cent = 1 pt
  PERFORM public.add_vip_points(_user, coalesce(_amount_cents, 0)::bigint);

  RETURN jsonb_build_object('ok', true, 'pack_id', _pack_id, 'vip_points_earned', coalesce(_amount_cents,0));
END $function$;

-- 7. Backfill: ensure all existing players have at least vip_level=1
UPDATE public.profiles SET vip_level = 1 WHERE vip_level IS NULL OR vip_level < 1;
