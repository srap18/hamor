
-- 1) Add storage column
ALTER TABLE public.ships_owned
  ADD COLUMN IF NOT EXISTS in_storage boolean NOT NULL DEFAULT false;

-- Allow client UPDATE on in_storage (in addition to at_sea)
GRANT UPDATE (at_sea, in_storage) ON public.ships_owned TO authenticated;

CREATE INDEX IF NOT EXISTS idx_ships_owned_user_storage
  ON public.ships_owned(user_id, in_storage);

-- 2) Update buy_ship_by_code: allow up to 3 active + 3 storage
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _new uuid;
  _market_level int;
  _active_count int;
  _storage_count int;
  _put_in_storage boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _price_coins < 0 OR _price_coins > 1000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp < 50 OR _max_hp > 100000 THEN RAISE EXCEPTION 'bad hp'; END IF;
  IF _template_id < 1 OR _template_id > 100 THEN RAISE EXCEPTION 'bad template'; END IF;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _template_id > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN
      RAISE EXCEPTION 'fleet and storage full';
    END IF;
    _put_in_storage := true;
  END IF;

  PERFORM public._mutate_currency(_uid, -_price_coins, 0, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage)
    VALUES (_uid, _template_id, _code, false, _max_hp, _max_hp, _put_in_storage)
    RETURNING id INTO _new;
  RETURN _new;
END $$;

-- 3) Helper to insert a ship respecting storage rules (used by code redemption)
CREATE OR REPLACE FUNCTION public._grant_ship_with_storage(_uid uuid, _catalog_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _new uuid;
  _template int;
  _hp int;
  _active_count int;
  _storage_count int;
  _put_in_storage boolean := false;
BEGIN
  SELECT sort_order, max_hp INTO _template, _hp
    FROM public.ship_catalog WHERE code = _catalog_code LIMIT 1;
  IF _template IS NULL THEN RETURN NULL; END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN
      RETURN NULL; -- skip silently when full
    END IF;
    _put_in_storage := true;
  END IF;

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage)
  VALUES (_uid, COALESCE(_template,1), _catalog_code, false, _hp, _hp, _put_in_storage)
  RETURNING id INTO _new;
  RETURN _new;
END $$;

-- 4) Move ship from active fleet to storage
CREATE OR REPLACE FUNCTION public.ship_to_storage(p_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _storage_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _row FROM public.ships_owned WHERE id = p_ship_id AND user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _row.in_storage THEN RETURN jsonb_build_object('ok', true, 'code', 'already_stored'); END IF;
  IF _row.at_sea THEN RAISE EXCEPTION 'ship is at sea'; END IF;
  IF _row.stealing_target_user_id IS NOT NULL THEN RAISE EXCEPTION 'ship on mission'; END IF;
  IF _row.destroyed_at IS NOT NULL AND _row.repair_ends_at IS NOT NULL AND _row.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT COUNT(*) INTO _storage_count
    FROM public.ships_owned WHERE user_id = _uid AND in_storage = true;
  IF _storage_count >= 3 THEN RAISE EXCEPTION 'storage full'; END IF;

  UPDATE public.ships_owned SET in_storage = true WHERE id = p_ship_id;
  RETURN jsonb_build_object('ok', true, 'code', 'stored');
END $$;

-- 5) Move ship from storage back to active fleet
CREATE OR REPLACE FUNCTION public.ship_from_storage(p_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _active_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _row FROM public.ships_owned WHERE id = p_ship_id AND user_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF NOT _row.in_storage THEN RETURN jsonb_build_object('ok', true, 'code', 'already_active'); END IF;

  SELECT COUNT(*) INTO _active_count
    FROM public.ships_owned WHERE user_id = _uid AND in_storage = false;
  IF _active_count >= 3 THEN RAISE EXCEPTION 'fleet full'; END IF;

  UPDATE public.ships_owned SET in_storage = false WHERE id = p_ship_id;
  RETURN jsonb_build_object('ok', true, 'code', 'activated');
END $$;

-- 6) Swap active ship with a stored one
CREATE OR REPLACE FUNCTION public.swap_ship_with_storage(p_active_id uuid, p_storage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _a record;
  _s record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_active_id = p_storage_id THEN RAISE EXCEPTION 'same ship'; END IF;

  SELECT * INTO _a FROM public.ships_owned WHERE id = p_active_id AND user_id = _uid FOR UPDATE;
  IF NOT FOUND OR _a.in_storage THEN RAISE EXCEPTION 'active ship invalid'; END IF;
  SELECT * INTO _s FROM public.ships_owned WHERE id = p_storage_id AND user_id = _uid FOR UPDATE;
  IF NOT FOUND OR NOT _s.in_storage THEN RAISE EXCEPTION 'stored ship invalid'; END IF;

  IF _a.at_sea THEN RAISE EXCEPTION 'ship is at sea'; END IF;
  IF _a.stealing_target_user_id IS NOT NULL THEN RAISE EXCEPTION 'ship on mission'; END IF;
  IF _a.destroyed_at IS NOT NULL AND _a.repair_ends_at IS NOT NULL AND _a.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  UPDATE public.ships_owned SET in_storage = true  WHERE id = p_active_id;
  UPDATE public.ships_owned SET in_storage = false WHERE id = p_storage_id;
  RETURN jsonb_build_object('ok', true, 'code', 'swapped');
END $$;

GRANT EXECUTE ON FUNCTION public.ship_to_storage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ship_from_storage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.swap_ship_with_storage(uuid, uuid) TO authenticated;
