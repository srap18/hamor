
-- Enforce user_blocks ONLY on friend requests and private DMs.
-- Profile viewing and ocean visits are intentionally NOT affected by blocks.

-- 1) Block-aware friend request RPC
CREATE OR REPLACE FUNCTION public.send_friend_request(p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_row record;
  v_blocked boolean;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;
  IF p_target IS NULL OR p_target = v_me THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_target');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_me AND blocked_id = p_target)
       OR (blocker_id = p_target AND blocked_id = v_me)
  ) INTO v_blocked;
  IF v_blocked THEN
    RETURN jsonb_build_object('ok', false, 'code', 'blocked');
  END IF;

  SELECT * INTO v_row FROM public.friends
  WHERE (requester_id = v_me AND addressee_id = p_target)
     OR (requester_id = p_target AND addressee_id = v_me)
  LIMIT 1;

  IF FOUND THEN
    IF v_row.status = 'accepted' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'already_friends');
    END IF;
    IF v_row.requester_id = p_target THEN
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

-- 2) Block-aware DM insert policy
DROP POLICY IF EXISTS msg_insert_dm ON public.messages;
CREATE POLICY msg_insert_dm ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    channel = 'dm'
    AND auth.uid() = sender_id
    AND recipient_id IS NOT NULL
    AND NOT is_muted(auth.uid())
    AND NOT is_banned(auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = auth.uid() AND blocked_id = recipient_id)
         OR (blocker_id = recipient_id AND blocked_id = auth.uid())
    )
  );
