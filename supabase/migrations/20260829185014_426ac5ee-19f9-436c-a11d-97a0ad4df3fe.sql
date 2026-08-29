
CREATE OR REPLACE FUNCTION public.admin_grant_background(_player uuid, _bg_id text, _days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _exp text; _row_id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  IF _player IS NULL OR coalesce(_bg_id,'') = '' THEN RAISE EXCEPTION 'bad args'; END IF;

  IF _days IS NULL OR _days <= 0 THEN
    -- Permanent ownership: record legacy ownership so the expiry trigger never stamps it
    INSERT INTO public.legacy_cosmetics(user_id, item_type, item_id, reason)
    VALUES (_player, 'background', _bg_id, 'admin_permanent_grant')
    ON CONFLICT (user_id, item_type, item_id) DO NOTHING;
    _exp := NULL;
  ELSE
    DELETE FROM public.legacy_cosmetics
     WHERE user_id = _player AND item_type = 'background' AND item_id = _bg_id
       AND reason = 'admin_permanent_grant';
    _exp := (now() + make_interval(days => _days))::text;
  END IF;

  SELECT id INTO _row_id FROM public.inventory
   WHERE user_id = _player AND item_type = 'background' AND item_id = _bg_id
   LIMIT 1;

  IF _row_id IS NULL THEN
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_player, 'background', _bg_id, 1,
            CASE WHEN _exp IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('expires_at', _exp) END)
    RETURNING id INTO _row_id;
  END IF;

  UPDATE public.inventory
     SET quantity = GREATEST(1, quantity),
         meta = CASE WHEN _exp IS NULL
                     THEN coalesce(meta,'{}'::jsonb) - 'expires_at'
                     ELSE coalesce(meta,'{}'::jsonb) || jsonb_build_object('expires_at', _exp) END
   WHERE id = _row_id;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_grant_background', _player,
          jsonb_build_object('bg_id', _bg_id, 'days', _days, 'expires_at', _exp));

  RETURN jsonb_build_object('ok', true, 'bg_id', _bg_id, 'expires_at', _exp);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_background(uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_grant_background(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_background(_player uuid, _bg_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;

  DELETE FROM public.legacy_cosmetics
   WHERE user_id = _player AND item_type = 'background' AND item_id = _bg_id;
  DELETE FROM public.inventory
   WHERE user_id = _player AND item_type = 'background' AND item_id = _bg_id;

  UPDATE public.profiles SET selected_bg_id = 'cove'
   WHERE id = _player AND selected_bg_id = _bg_id;

  INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
  VALUES (auth.uid(), 'admin_revoke_background', _player, jsonb_build_object('bg_id', _bg_id));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_background(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_revoke_background(uuid, text) TO authenticated;
