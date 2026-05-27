CREATE OR REPLACE FUNCTION public.gift_gems(_recipient uuid, _amount integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sender uuid := auth.uid(); _bal integer;
BEGIN
  IF _sender IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'auth'); END IF;
  IF _sender = _recipient THEN RETURN jsonb_build_object('ok', false, 'error', 'self'); END IF;
  IF _amount IS NULL OR _amount < 1 THEN RETURN jsonb_build_object('ok', false, 'error', 'amount'); END IF;
  SELECT gems INTO _bal FROM profiles WHERE id = _sender FOR UPDATE;
  IF _bal IS NULL OR _bal < _amount THEN RETURN jsonb_build_object('ok', false, 'error', 'insufficient'); END IF;
  UPDATE profiles SET gems = gems - _amount WHERE id = _sender;
  UPDATE profiles SET gems = gems + _amount WHERE id = _recipient;
  RETURN jsonb_build_object('ok', true, 'remaining', _bal - _amount);
END; $$;
GRANT EXECUTE ON FUNCTION public.gift_gems(uuid, integer) TO authenticated;