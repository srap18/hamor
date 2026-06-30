
-- 1) State table: tracks when a defender's anti-X is disabled.
CREATE TABLE IF NOT EXISTS public.anti_disabled_state (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anti_id TEXT NOT NULL,
  disabled_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, anti_id)
);

GRANT SELECT ON public.anti_disabled_state TO authenticated;
GRANT ALL ON public.anti_disabled_state TO service_role;

ALTER TABLE public.anti_disabled_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anti_disabled_state_self_read" ON public.anti_disabled_state;
CREATE POLICY "anti_disabled_state_self_read"
ON public.anti_disabled_state FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 2) Buy disabler with gems → inventory (item_type='disabler')
CREATE OR REPLACE FUNCTION public.buy_disabler_to_inventory(_item_id text, _qty integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user UUID := auth.uid();
  _price int;
  _total bigint;
  _gems bigint;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'bad_qty'; END IF;

  _price := CASE _item_id
    WHEN 'disabler_rocket'   THEN 100
    WHEN 'disabler_nuke'     THEN 300
    WHEN 'disabler_ad_bomb'  THEN 500
    ELSE NULL
  END;
  IF _price IS NULL THEN RAISE EXCEPTION 'unknown_disabler'; END IF;

  _total := _price::bigint * _qty::bigint;

  SELECT gems INTO _gems FROM public.profiles WHERE id = _user FOR UPDATE;
  IF COALESCE(_gems, 0) < _total THEN RAISE EXCEPTION 'not_enough_gems'; END IF;

  UPDATE public.profiles SET gems = gems - _total WHERE id = _user;

  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_user, 'disabler', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id) WHERE (meta IS NULL OR (meta ->> 'assigned_ship_id') IS NULL)
  DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
END;
$$;

REVOKE ALL ON FUNCTION public.buy_disabler_to_inventory(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_disabler_to_inventory(text, integer) TO authenticated;

-- 3) Fire disabler at a target player → sets disabled_until for 10 minutes
CREATE OR REPLACE FUNCTION public.fire_disabler(_target_id uuid, _disabler_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _attacker UUID := auth.uid();
  _qty int;
  _anti_id text;
  _name text;
  _attacker_name text;
  _target_name text;
  _until TIMESTAMPTZ;
  _cur TIMESTAMPTZ;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'bad_target'; END IF;

  -- Map disabler → which anti it shuts down + display name
  CASE _disabler_id
    WHEN 'disabler_rocket'  THEN _anti_id := 'anti_rocket';   _name := 'مضاد الصواريخ';
    WHEN 'disabler_nuke'    THEN _anti_id := 'anti_nuke';     _name := 'مضاد القنبلة الذرية';
    WHEN 'disabler_ad_bomb' THEN _anti_id := 'anti_ad_bomb';  _name := 'مضاد القنبلة الإعلانية';
    ELSE RAISE EXCEPTION 'unknown_disabler';
  END CASE;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target_id) THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  -- Consume one disabler
  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id
    FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'not_enough'; END IF;

  IF _qty = 1 THEN
    DELETE FROM public.inventory
      WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
      WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id;
  END IF;

  -- Extend existing disable, never shorten
  SELECT disabled_until INTO _cur FROM public.anti_disabled_state
    WHERE user_id = _target_id AND anti_id = _anti_id FOR UPDATE;
  _until := GREATEST(COALESCE(_cur, now()), now()) + interval '10 minutes';

  INSERT INTO public.anti_disabled_state(user_id, anti_id, disabled_until)
  VALUES (_target_id, _anti_id, _until)
  ON CONFLICT (user_id, anti_id) DO UPDATE SET disabled_until = EXCLUDED.disabled_until;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications(user_id, kind, title, body, meta)
  VALUES (_target_id, 'anti_disabled',
    '⚡ تم تعطيل ' || _name,
    'اللاعب ' || COALESCE(_attacker_name,'لاعب') || ' عطّل ' || _name || ' لمدة 10 دقائق.',
    jsonb_build_object('anti_id', _anti_id, 'attacker_id', _attacker, 'disabled_until', _until));

  INSERT INTO public.notifications(user_id, kind, title, body, meta)
  VALUES (_attacker, 'anti_disabled_attacker',
    '⚡ ' || _name || ' معطّل',
    'عطّلت ' || _name || ' لدى ' || COALESCE(_target_name,'لاعب') || ' لمدة 10 دقائق.',
    jsonb_build_object('anti_id', _anti_id, 'defender_id', _target_id, 'disabled_until', _until));

  RETURN jsonb_build_object('ok', true, 'disabled_until', _until);
END;
$$;

REVOKE ALL ON FUNCTION public.fire_disabler(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fire_disabler(uuid, text) TO authenticated;

-- 4) Patch _try_anti_block: skip block when defender's anti is currently disabled
CREATE OR REPLACE FUNCTION public._try_anti_block(_defender uuid, _anti_id text, _pct int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _qty int;
  _roll int;
  _until TIMESTAMPTZ;
BEGIN
  IF _defender IS NULL OR _anti_id IS NULL THEN RETURN false; END IF;

  -- If anti is disabled, skip the block entirely (do not consume inventory)
  SELECT disabled_until INTO _until FROM public.anti_disabled_state
    WHERE user_id = _defender AND anti_id = _anti_id;
  IF _until IS NOT NULL AND _until > now() THEN
    RETURN false;
  END IF;

  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id
    FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RETURN false; END IF;

  _roll := (floor(random() * 100))::int + 1;
  IF _roll > _pct THEN RETURN false; END IF;

  IF _qty = 1 THEN
    DELETE FROM public.inventory
      WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
      WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id;
  END IF;
  RETURN true;
END;
$$;
