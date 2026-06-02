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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tribe_id, user_id, status INTO v_tribe, v_user, v_status
  FROM public.tribe_join_requests WHERE id = _request_id;
  IF v_tribe IS NULL THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'request not pending'; END IF;
  IF NOT public.is_tribe_officer(v_uid, v_tribe) THEN
    RAISE EXCEPTION 'not an officer';
  END IF;
  DELETE FROM public.tribe_members WHERE user_id = v_user;
  INSERT INTO public.tribe_members(tribe_id, user_id, role) VALUES (v_tribe, v_user, 'member')
    ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET tribe_id = v_tribe WHERE id = v_user;
  UPDATE public.tribe_join_requests SET status = 'accepted' WHERE id = _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_join_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_join_request(uuid) TO authenticated;

-- Backfill missing tribe_members rows; bypass the 8-member trigger for repair
ALTER TABLE public.tribe_members DISABLE TRIGGER USER;
INSERT INTO public.tribe_members (tribe_id, user_id, role)
SELECT p.tribe_id, p.id, 'member'
FROM public.profiles p
WHERE p.tribe_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tribe_members tm
    WHERE tm.user_id = p.id AND tm.tribe_id = p.tribe_id
  )
ON CONFLICT DO NOTHING;
ALTER TABLE public.tribe_members ENABLE TRIGGER USER;