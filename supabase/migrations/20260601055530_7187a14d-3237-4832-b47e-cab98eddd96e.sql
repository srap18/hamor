ALTER TABLE public.redemption_codes
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.admin_archive_code(_code_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE public.redemption_codes
  SET archived_at = now(), active = false
  WHERE id = _code_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_archive_code(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_find_codes(_q text)
RETURNS SETOF public.redemption_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  RETURN QUERY
  SELECT * FROM public.redemption_codes
  WHERE code ILIKE ('%' || _q || '%')
  ORDER BY created_at DESC
  LIMIT 50;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_find_codes(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_find_codes(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_redemption(_code_id uuid, _user_id uuid, _reclaim boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted int;
  _code public.redemption_codes%ROWTYPE;
  _r jsonb;
  _qty int;
  _kind text;
  _iid text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO _code FROM public.redemption_codes WHERE id = _code_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found');
  END IF;

  DELETE FROM public.code_redemptions
  WHERE code_id = _code_id AND user_id = _user_id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  IF _deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  UPDATE public.redemption_codes
  SET uses_count = GREATEST(0, uses_count - _deleted)
  WHERE id = _code_id;

  IF _reclaim THEN
    IF _code.reward_type = 'bundle' THEN
      UPDATE public.profiles
      SET coins = GREATEST(0::bigint, coins - COALESCE(_code.reward_coins, 0)),
          gems  = GREATEST(0, gems  - COALESCE(_code.reward_gems, 0)),
          xp    = GREATEST(0, xp    - COALESCE(_code.reward_xp, 0))
      WHERE id = _user_id;
    ELSIF _code.reward_type = 'item' AND _code.item_id IS NOT NULL THEN
      _qty := COALESCE(_code.quantity, 1);
      UPDATE public.inventory
      SET quantity = quantity - _qty
      WHERE user_id = _user_id
        AND item_type = COALESCE(_code.item_kind, item_type)
        AND item_id = _code.item_id;
      DELETE FROM public.inventory
      WHERE user_id = _user_id
        AND item_type = COALESCE(_code.item_kind, item_type)
        AND item_id = _code.item_id
        AND quantity <= 0;
    ELSIF _code.reward_type = 'ship' AND _code.item_id IS NOT NULL THEN
      _qty := COALESCE(_code.quantity, 1);
      DELETE FROM public.ships_owned
      WHERE id IN (
        SELECT id FROM public.ships_owned
        WHERE user_id = _user_id AND catalog_code = _code.item_id
        ORDER BY acquired_at DESC
        LIMIT _qty
      );
    END IF;

    IF _code.extra_rewards IS NOT NULL THEN
      FOR _r IN SELECT * FROM jsonb_array_elements(_code.extra_rewards) LOOP
        IF (_r->>'type') = 'bundle' THEN
          UPDATE public.profiles
          SET coins = GREATEST(0::bigint, coins - COALESCE((_r->>'coins')::bigint, 0)),
              gems  = GREATEST(0, gems  - COALESCE((_r->>'gems')::int, 0)),
              xp    = GREATEST(0, xp    - COALESCE((_r->>'xp')::int, 0))
          WHERE id = _user_id;
        ELSIF (_r->>'type') = 'item' THEN
          _iid := _r->>'item_id';
          _kind := COALESCE(_r->>'item_kind', 'misc');
          _qty := COALESCE((_r->>'quantity')::int, 1);
          IF _iid IS NOT NULL THEN
            UPDATE public.inventory
            SET quantity = quantity - _qty
            WHERE user_id = _user_id AND item_type = _kind AND item_id = _iid;
            DELETE FROM public.inventory
            WHERE user_id = _user_id AND item_type = _kind AND item_id = _iid AND quantity <= 0;
          END IF;
        ELSIF (_r->>'type') = 'ship' THEN
          _iid := _r->>'item_id';
          _qty := COALESCE((_r->>'quantity')::int, 1);
          IF _iid IS NOT NULL THEN
            DELETE FROM public.ships_owned
            WHERE id IN (
              SELECT id FROM public.ships_owned
              WHERE user_id = _user_id AND catalog_code = _iid
              ORDER BY acquired_at DESC
              LIMIT _qty
            );
          END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'removed', _deleted, 'reclaimed', _reclaim);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_redemption(uuid, uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_redemption(uuid, uuid, boolean) TO authenticated;