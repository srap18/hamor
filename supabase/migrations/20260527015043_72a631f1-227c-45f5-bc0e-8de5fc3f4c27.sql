
CREATE OR REPLACE FUNCTION public.buy_background(_bg_id text, _price bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _price < 0 OR _price > 100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  PERFORM public._mutate_currency(_uid, -_price, 0, 0, 0);
  UPDATE public.profiles SET selected_bg_id = _bg_id WHERE id = _uid;
END $$;

GRANT EXECUTE ON FUNCTION public.buy_background(text, bigint) TO authenticated;
