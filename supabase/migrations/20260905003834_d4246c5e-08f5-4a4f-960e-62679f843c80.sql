CREATE OR REPLACE FUNCTION public._selftest_daily_rewards(_uid uuid)
RETURNS TABLE(day int, r_type text, r_id text, qty int, before_v bigint, after_v bigint, ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i int; _t text; _id text; _q int; _b bigint; _a bigint; _ex int;
BEGIN
  FOR i IN 0..14 LOOP
    SELECT r.reward_type, r.reward_id, r.reward_qty INTO _t, _id, _q
      FROM public.daily_login_reward_for(i) r;

    IF _t = 'coins' THEN
      SELECT coins INTO _b FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET coins = coins + _q WHERE id = _uid;
      SELECT coins INTO _a FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET coins = coins - _q WHERE id = _uid;
    ELSIF _t = 'gems' THEN
      SELECT gems INTO _b FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET gems = gems + _q WHERE id = _uid;
      SELECT gems INTO _a FROM public.profiles WHERE id = _uid;
      UPDATE public.profiles SET gems = gems - _q WHERE id = _uid;
    ELSE
      SELECT quantity INTO _ex FROM public.inventory
        WHERE user_id=_uid AND item_type=_t AND item_id=_id FOR UPDATE;
      _b := COALESCE(_ex, 0);
      IF _ex IS NULL THEN
        INSERT INTO public.inventory(user_id,item_type,item_id,quantity) VALUES (_uid,_t,_id,_q);
      ELSE
        UPDATE public.inventory SET quantity = quantity + _q
          WHERE user_id=_uid AND item_type=_t AND item_id=_id;
      END IF;
      SELECT quantity INTO _a FROM public.inventory
        WHERE user_id=_uid AND item_type=_t AND item_id=_id;
      IF _ex IS NULL THEN
        DELETE FROM public.inventory WHERE user_id=_uid AND item_type=_t AND item_id=_id;
      ELSE
        UPDATE public.inventory SET quantity = quantity - _q
          WHERE user_id=_uid AND item_type=_t AND item_id=_id;
      END IF;
    END IF;

    day := i + 1; r_type := _t; r_id := _id; qty := _q;
    before_v := _b; after_v := _a; ok := (_a - _b = _q);
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._selftest_daily_rewards(uuid) FROM PUBLIC, anon, authenticated;