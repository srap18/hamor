CREATE OR REPLACE FUNCTION public.buy_background_gems(_bg_id text, _gems bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
        _have bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  IF _gems < 0 OR _gems > 1000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  SELECT gems INTO _have FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _have IS NULL OR _have < _gems THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles
     SET gems = gems - _gems,
         selected_bg_id = _bg_id
   WHERE id = _uid;
END $$;

GRANT EXECUTE ON FUNCTION public.buy_background_gems(text, bigint) TO authenticated;