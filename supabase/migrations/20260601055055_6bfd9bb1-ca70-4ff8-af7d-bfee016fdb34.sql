CREATE OR REPLACE FUNCTION public.admin_revoke_redemption(_code_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted int;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
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

  RETURN jsonb_build_object('ok', true, 'removed', _deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revoke_redemption(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_redemptions(_code_id uuid)
RETURNS TABLE (
  user_id uuid,
  redeemed_at timestamptz,
  display_name text,
  avatar_emoji text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  RETURN QUERY
  SELECT r.user_id, r.redeemed_at, p.display_name, p.avatar_emoji
  FROM public.code_redemptions r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.code_id = _code_id
  ORDER BY r.redeemed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_redemptions(uuid) TO authenticated;