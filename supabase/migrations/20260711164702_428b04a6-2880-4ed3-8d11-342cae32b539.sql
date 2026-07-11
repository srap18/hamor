
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS friend_requests_closed boolean NOT NULL DEFAULT false;

-- Respect the target's "closed to requests" flag
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
  v_closed boolean;
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

  SELECT friend_requests_closed INTO v_closed FROM public.profiles WHERE id = p_target;
  IF COALESCE(v_closed, false) THEN
    -- Allow silent auto-accept if the target had previously sent me a request
    SELECT * INTO v_row FROM public.friends
     WHERE requester_id = p_target AND addressee_id = v_me AND status = 'pending'
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.friends SET status='accepted' WHERE id = v_row.id;
      RETURN jsonb_build_object('ok', true, 'code', 'accepted_existing');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'requests_closed');
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
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;

-- Toggle "closed to friend requests"
CREATE OR REPLACE FUNCTION public.set_friend_requests_closed(p_closed boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  UPDATE public.profiles SET friend_requests_closed = COALESCE(p_closed, false) WHERE id = v_me;
  RETURN COALESCE(p_closed, false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_friend_requests_closed(boolean) TO authenticated;

-- Accept every pending friend request addressed to me
CREATE OR REPLACE FUNCTION public.accept_all_friend_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  WITH upd AS (
    UPDATE public.friends f
       SET status = 'accepted'
     WHERE f.addressee_id = v_me
       AND f.status = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM public.user_blocks b
          WHERE (b.blocker_id = v_me AND b.blocked_id = f.requester_id)
             OR (b.blocker_id = f.requester_id AND b.blocked_id = v_me)
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.accept_all_friend_requests() TO authenticated;

-- Reject (delete) every pending friend request addressed to me
CREATE OR REPLACE FUNCTION public.reject_all_friend_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n integer := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  WITH del AS (
    DELETE FROM public.friends
     WHERE addressee_id = v_me AND status = 'pending'
     RETURNING 1
  )
  SELECT count(*) INTO v_n FROM del;
  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_all_friend_requests() TO authenticated;

-- Delete a private conversation (both sides) between me and another player
CREATE OR REPLACE FUNCTION public.delete_dm_conversation(p_other uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_n integer := 0;
  v_lo uuid;
  v_hi uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_other IS NULL OR p_other = v_me THEN RAISE EXCEPTION 'invalid_target'; END IF;

  WITH del AS (
    DELETE FROM public.messages
     WHERE channel = 'dm'
       AND ((sender_id = v_me AND recipient_id = p_other)
         OR (sender_id = p_other AND recipient_id = v_me))
     RETURNING 1
  )
  SELECT count(*) INTO v_n FROM del;

  v_lo := LEAST(v_me, p_other);
  v_hi := GREATEST(v_me, p_other);
  DELETE FROM public.dm_threads WHERE user_low = v_lo AND user_high = v_hi;

  RETURN v_n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_dm_conversation(uuid) TO authenticated;
