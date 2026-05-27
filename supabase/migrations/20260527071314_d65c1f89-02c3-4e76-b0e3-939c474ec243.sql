
CREATE OR REPLACE FUNCTION public.deduct_gems_for_voice_change(_user_id uuid, _amount integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_gems integer;
BEGIN
  SELECT gems INTO current_gems FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF current_gems IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;
  IF current_gems < _amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_enough_gems', 'needed', _amount, 'have', current_gems);
  END IF;
  UPDATE public.profiles SET gems = gems - _amount WHERE id = _user_id;
  RETURN jsonb_build_object('ok', true, 'deducted', _amount, 'remaining', current_gems - _amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_gems_for_voice_change(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_gems_for_voice_change(uuid, integer) TO service_role;
