-- Restore phoenix functions and reactivate catalog entry
UPDATE public.ship_catalog SET active = true WHERE code = 'phoenix';

CREATE OR REPLACE FUNCTION public.buy_phoenix_pack_3()
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cost int := 3800;
  cur_gems int;
  new_ids uuid[] := ARRAY[]::uuid[];
  new_id uuid;
  i int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT gems INTO cur_gems FROM public.profiles WHERE id = uid FOR UPDATE;
  IF cur_gems IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;
  IF cur_gems < cost THEN RAISE EXCEPTION 'not enough gems'; END IF;

  UPDATE public.profiles SET gems = gems - cost WHERE id = uid;

  FOR i IN 1..3 LOOP
    INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code)
    VALUES (uid, 31, 13000, 13000, false, 'ship-lvl-31')
    RETURNING id INTO new_id;
    new_ids := array_append(new_ids, new_id);
  END LOOP;

  INSERT INTO public.transactions (user_id, kind, amount, currency, meta)
  VALUES (uid, 'buy_phoenix_pack_3', cost, 'gems', jsonb_build_object('ship_ids', to_jsonb(new_ids)));

  RETURN new_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_phoenix_pack_3() TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_phoenix_pack_1()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cost int := 1500;
  cur_gems int;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT gems INTO cur_gems FROM public.profiles WHERE id = uid FOR UPDATE;
  IF cur_gems IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;
  IF cur_gems < cost THEN RAISE EXCEPTION 'not enough gems'; END IF;

  UPDATE public.profiles SET gems = gems - cost WHERE id = uid;

  INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code)
  VALUES (uid, 31, 13000, 13000, false, 'ship-lvl-31')
  RETURNING id INTO new_id;

  INSERT INTO public.transactions (user_id, kind, amount, currency, meta)
  VALUES (uid, 'buy_phoenix_pack_1', cost, 'gems', jsonb_build_object('ship_id', new_id));

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_phoenix_pack_1() TO authenticated;