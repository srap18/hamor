
-- 1) Prevent forced move; clear other pending requests on accept
CREATE OR REPLACE FUNCTION public.accept_join_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tribe uuid;
  v_user uuid;
  v_status text;
  v_current_tribe uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tribe_id, user_id, status INTO v_tribe, v_user, v_status
  FROM public.tribe_join_requests WHERE id = _request_id;
  IF v_tribe IS NULL THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'request not pending'; END IF;
  IF NOT public.is_tribe_officer(v_uid, v_tribe) THEN
    RAISE EXCEPTION 'not an officer';
  END IF;

  -- If the user is already in a tribe, reject this request instead of force-moving them
  SELECT tribe_id INTO v_current_tribe FROM public.profiles WHERE id = v_user;
  IF v_current_tribe IS NOT NULL THEN
    UPDATE public.tribe_join_requests SET status = 'rejected' WHERE id = _request_id;
    RAISE EXCEPTION 'user already in a tribe';
  END IF;

  INSERT INTO public.tribe_members(tribe_id, user_id, role) VALUES (v_tribe, v_user, 'member')
    ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET tribe_id = v_tribe WHERE id = v_user;
  UPDATE public.tribe_join_requests SET status = 'accepted' WHERE id = _request_id;

  -- Remove any other pending requests for this user so other tribes can't pull them in later
  DELETE FROM public.tribe_join_requests
  WHERE user_id = v_user AND id <> _request_id AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.accept_join_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_join_request(uuid) TO authenticated;

-- 2) Cleanup helper: purge stale pending requests for users already in a tribe
DELETE FROM public.tribe_join_requests r
USING public.profiles p
WHERE r.user_id = p.id
  AND p.tribe_id IS NOT NULL
  AND r.status = 'pending';
