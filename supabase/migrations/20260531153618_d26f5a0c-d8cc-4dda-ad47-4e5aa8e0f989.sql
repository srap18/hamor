
CREATE OR REPLACE FUNCTION public.buy_phoenix_ship()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cost int := 10000;
  cur_gems int;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT gems INTO cur_gems FROM public.profiles WHERE id = uid FOR UPDATE;
  IF cur_gems IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
  IF cur_gems < cost THEN
    RAISE EXCEPTION 'not enough gems';
  END IF;

  UPDATE public.profiles SET gems = gems - cost WHERE id = uid;

  INSERT INTO public.ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code)
  VALUES (uid, 31, 6000, 6000, false, 'phoenix')
  RETURNING id INTO new_id;

  INSERT INTO public.transactions (user_id, kind, amount, currency, meta)
  VALUES (uid, 'buy_phoenix_ship', cost, 'gems', jsonb_build_object('ship_id', new_id));

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_phoenix_ship() TO authenticated;
