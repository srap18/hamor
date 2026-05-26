
ALTER TABLE public.tribes
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS banner text NOT NULL DEFAULT '🏴‍☠️',
  ADD COLUMN IF NOT EXISTS level int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS treasure_coins bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_donations bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.tribe_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tribe_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tribe_donations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS td_select_all ON public.tribe_donations;
CREATE POLICY td_select_all ON public.tribe_donations FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_tribe_donations_tribe ON public.tribe_donations(tribe_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.rename_tribe(_tribe_id uuid, _new_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cost int := 100;
  _gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribes WHERE id = _tribe_id AND owner_id = _uid) THEN
    RAISE EXCEPTION 'only owner can rename';
  END IF;
  IF char_length(trim(_new_name)) < 2 OR char_length(trim(_new_name)) > 40 THEN
    RAISE EXCEPTION 'invalid name length';
  END IF;
  SELECT gems INTO _gems FROM public.profiles WHERE id = _uid;
  IF COALESCE(_gems, 0) < _cost THEN RAISE EXCEPTION 'not enough gems'; END IF;
  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid;
  UPDATE public.tribes SET name = trim(_new_name) WHERE id = _tribe_id;
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.update_tribe_details(_tribe_id uuid, _description text, _banner text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribes WHERE id = _tribe_id AND owner_id = _uid) THEN
    RAISE EXCEPTION 'only owner';
  END IF;
  UPDATE public.tribes SET
    description = COALESCE(left(_description, 240), description),
    banner = CASE WHEN _banner IS NULL OR _banner = '' THEN banner ELSE left(_banner, 8) END
  WHERE id = _tribe_id;
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.donate_to_tribe(_tribe_id uuid, _amount bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _coins bigint;
  _treasure bigint;
  _cur_level int;
  _need bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount < 100 THEN RAISE EXCEPTION 'min 100 coins'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid) THEN
    RAISE EXCEPTION 'not a member';
  END IF;
  SELECT coins INTO _coins FROM public.profiles WHERE id = _uid;
  IF COALESCE(_coins, 0) < _amount THEN RAISE EXCEPTION 'not enough coins'; END IF;

  UPDATE public.profiles SET coins = coins - _amount WHERE id = _uid;
  UPDATE public.tribes
    SET treasure_coins = treasure_coins + _amount,
        total_donations = total_donations + _amount
    WHERE id = _tribe_id
    RETURNING treasure_coins, level INTO _treasure, _cur_level;

  -- level-up loop: each level N requires 10000 * N^2 cumulative treasure
  LOOP
    _need := 10000::bigint * _cur_level * _cur_level;
    EXIT WHEN _treasure < _need;
    _treasure := _treasure - _need;
    _cur_level := _cur_level + 1;
  END LOOP;
  UPDATE public.tribes SET level = _cur_level, treasure_coins = _treasure WHERE id = _tribe_id;

  INSERT INTO public.tribe_donations(tribe_id, user_id, amount) VALUES (_tribe_id, _uid, _amount);
  RETURN json_build_object('ok', true, 'level', _cur_level, 'treasure', _treasure);
END; $$;

GRANT EXECUTE ON FUNCTION public.rename_tribe(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tribe_details(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.donate_to_tribe(uuid, bigint) TO authenticated;
