
-- 1) Table
CREATE TABLE public.player_daughter (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'ابنتي',
  stage int NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 3),
  feed_xp int NOT NULL DEFAULT 0,
  total_fish_fed int NOT NULL DEFAULT 0,
  last_fed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.player_daughter TO authenticated;
GRANT ALL ON public.player_daughter TO service_role;

ALTER TABLE public.player_daughter ENABLE ROW LEVEL SECURITY;

CREATE POLICY pd_select_own ON public.player_daughter FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY pd_insert_own ON public.player_daughter FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY pd_update_own ON public.player_daughter FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- 2) Auto-create row for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_daughter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.player_daughter (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created_daughter ON auth.users;
CREATE TRIGGER on_auth_user_created_daughter
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_daughter();

-- Backfill existing users
INSERT INTO public.player_daughter (user_id)
SELECT id FROM auth.users
ON CONFLICT DO NOTHING;

-- 3) Helper: compute stage from total fish fed
CREATE OR REPLACE FUNCTION public._daughter_stage_for(_fed int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _fed >= 200 THEN 3 WHEN _fed >= 50 THEN 2 ELSE 1 END;
$$;

-- 4) Get my daughter
CREATE OR REPLACE FUNCTION public.get_my_daughter()
RETURNS public.player_daughter LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.player_daughter WHERE user_id = auth.uid();
$$;

-- 5) Rename daughter
CREATE OR REPLACE FUNCTION public.rename_daughter(_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _n text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  _n := btrim(coalesce(_name, ''));
  IF char_length(_n) < 1 OR char_length(_n) > 20 THEN RAISE EXCEPTION 'invalid name length'; END IF;
  UPDATE public.player_daughter SET name = _n, updated_at = now() WHERE user_id = _uid;
END $$;

-- 6) Feed daughter — consume fish from fish_stock, gain feed_xp, level up
CREATE OR REPLACE FUNCTION public.feed_daughter(_fish_stock_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _count int := 0;
  _xp_gain int := 0;
  _old_stage int; _new_stage int;
  _new_total int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _fish_stock_ids IS NULL OR array_length(_fish_stock_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no fish provided';
  END IF;
  IF array_length(_fish_stock_ids, 1) > 100 THEN RAISE EXCEPTION 'too many fish'; END IF;

  -- Ensure row exists
  INSERT INTO public.player_daughter (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;

  SELECT COUNT(*)::int, COALESCE(SUM(GREATEST(1, (base_value/100)::int)), 0)::int
    INTO _count, _xp_gain
  FROM public.fish_stock
  WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;

  IF _count = 0 THEN RAISE EXCEPTION 'no matching fish'; END IF;

  DELETE FROM public.fish_stock WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;

  SELECT stage INTO _old_stage FROM public.player_daughter WHERE user_id = _uid;

  UPDATE public.player_daughter
    SET feed_xp = feed_xp + _xp_gain,
        total_fish_fed = total_fish_fed + _count,
        last_fed_at = now(),
        updated_at = now()
    WHERE user_id = _uid
    RETURNING total_fish_fed INTO _new_total;

  _new_stage := public._daughter_stage_for(_new_total);
  IF _new_stage <> _old_stage THEN
    UPDATE public.player_daughter SET stage = _new_stage WHERE user_id = _uid;
  END IF;

  RETURN jsonb_build_object(
    'fed_count', _count,
    'xp_gained', _xp_gain,
    'old_stage', _old_stage,
    'new_stage', _new_stage,
    'leveled_up', _new_stage > _old_stage,
    'total_fish_fed', _new_total
  );
END $$;

-- 7) Cashback bonus on purchases
CREATE OR REPLACE FUNCTION public._daughter_cashback_pct(_stage int)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _stage WHEN 3 THEN 0.10 WHEN 2 THEN 0.05 WHEN 1 THEN 0.02 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.daughter_apply_purchase_bonus(_spent_coins bigint, _spent_gems int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _stage int; _pct numeric; _bc bigint := 0; _bg int := 0;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('coins',0,'gems',0); END IF;
  SELECT stage INTO _stage FROM public.player_daughter WHERE user_id = _uid;
  IF _stage IS NULL THEN RETURN jsonb_build_object('coins',0,'gems',0); END IF;
  _pct := public._daughter_cashback_pct(_stage);
  IF _pct = 0 THEN RETURN jsonb_build_object('coins',0,'gems',0); END IF;
  _bc := FLOOR(GREATEST(0, _spent_coins) * _pct)::bigint;
  _bg := FLOOR(GREATEST(0, _spent_gems) * _pct)::int;
  IF _bc > 0 OR _bg > 0 THEN
    PERFORM public._mutate_currency(_uid, _bc, _bg, 0, 0);
  END IF;
  RETURN jsonb_build_object('coins', _bc, 'gems', _bg, 'pct', _pct);
END $$;

-- 8) Wire cashback into buy_with_coins / buy_with_gems
CREATE OR REPLACE FUNCTION public.buy_with_coins(_item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price bigint; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame') THEN _count := 1; END IF;
  _total := _price * _count;
  PERFORM public._mutate_currency(_uid, -_total, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
  PERFORM public.daughter_apply_purchase_bonus(_total, 0);
END $function$;

CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_gems INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_gems INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with gems: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame') THEN _count := 1; END IF;
  _total := (_price::bigint) * _count;
  PERFORM public._mutate_currency(_uid, 0, -_total::integer, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
  PERFORM public.daughter_apply_purchase_bonus(0, _total::int);
END $function$;

-- 9) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.player_daughter;
