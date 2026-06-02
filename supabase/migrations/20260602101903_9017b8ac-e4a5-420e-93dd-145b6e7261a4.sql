
CREATE OR REPLACE FUNCTION public.send_friend_request(p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_row record;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;
  IF p_target IS NULL OR p_target = v_me THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_target');
  END IF;

  -- Already friends/pending in EITHER direction?
  SELECT * INTO v_row FROM public.friends
  WHERE (requester_id = v_me AND addressee_id = p_target)
     OR (requester_id = p_target AND addressee_id = v_me)
  LIMIT 1;

  IF FOUND THEN
    IF v_row.status = 'accepted' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'already_friends');
    END IF;
    -- pending
    IF v_row.requester_id = p_target THEN
      -- The other side already sent a pending request → accept it
      UPDATE public.friends SET status = 'accepted' WHERE id = v_row.id;
      RETURN jsonb_build_object('ok', true, 'code', 'accepted_existing');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'already_sent');
  END IF;

  INSERT INTO public.friends(requester_id, addressee_id, status)
  VALUES (v_me, p_target, 'pending');
  RETURN jsonb_build_object('ok', true, 'code', 'sent');
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;
