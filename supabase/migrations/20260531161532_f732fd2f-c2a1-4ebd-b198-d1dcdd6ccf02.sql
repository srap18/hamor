
-- 1) Add join_mode to tribes
ALTER TABLE public.tribes
  ADD COLUMN IF NOT EXISTS join_mode text NOT NULL DEFAULT 'request';
ALTER TABLE public.tribes
  DROP CONSTRAINT IF EXISTS tribes_join_mode_check;
ALTER TABLE public.tribes
  ADD CONSTRAINT tribes_join_mode_check CHECK (join_mode IN ('open','request'));

-- 2) Allow owner and admin to delete a tribe
DROP POLICY IF EXISTS tribes_delete_owner_or_admin ON public.tribes;
CREATE POLICY tribes_delete_owner_or_admin ON public.tribes
  FOR DELETE
  USING (auth.uid() = owner_id OR public.is_admin(auth.uid()));

-- 3) Also let admin update/delete on voice_rooms (already exists). Add admin DELETE for tribes_join_requests cleanup not needed.

-- 4) Enforce mute on DM messages
DROP POLICY IF EXISTS msg_insert_dm ON public.messages;
CREATE POLICY msg_insert_dm ON public.messages
  FOR INSERT
  WITH CHECK (
    channel = 'dm'
    AND auth.uid() = sender_id
    AND recipient_id IS NOT NULL
    AND NOT public.is_muted(auth.uid())
  );

-- 5) Enforce mute on voice room messages
DROP POLICY IF EXISTS vrm_insert_own ON public.voice_room_messages;
CREATE POLICY vrm_insert_own ON public.voice_room_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT public.is_muted(auth.uid())
  );

-- 6) Open-join RPC: instantly joins an "open" tribe
CREATE OR REPLACE FUNCTION public.join_tribe_open(_tribe_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT join_mode INTO v_mode FROM public.tribes WHERE id = _tribe_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'tribe not found';
  END IF;
  IF v_mode <> 'open' THEN
    RAISE EXCEPTION 'tribe requires request';
  END IF;
  -- Already member?
  IF EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = v_uid) THEN
    RETURN;
  END IF;
  -- Remove from any other tribe first
  DELETE FROM public.tribe_members WHERE user_id = v_uid;
  INSERT INTO public.tribe_members(tribe_id, user_id, role) VALUES (_tribe_id, v_uid, 'member');
  UPDATE public.profiles SET tribe_id = _tribe_id WHERE id = v_uid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_tribe_open(uuid) TO authenticated;

-- 7) Owner can change join_mode
CREATE OR REPLACE FUNCTION public.set_tribe_join_mode(_tribe_id uuid, _mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _mode NOT IN ('open','request') THEN
    RAISE EXCEPTION 'invalid mode';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribes WHERE id = _tribe_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'only owner';
  END IF;
  UPDATE public.tribes SET join_mode = _mode WHERE id = _tribe_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_tribe_join_mode(uuid, text) TO authenticated;

-- 8) Cleanup idle voice rooms (callable by anyone; SECURITY DEFINER scoped)
CREATE OR REPLACE FUNCTION public.cleanup_idle_voice_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.voice_rooms
    WHERE empty_since IS NOT NULL
      AND empty_since < (now() - interval '1 hour')
      AND NOT EXISTS (SELECT 1 FROM public.voice_room_participants p WHERE p.room_id = voice_rooms.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN COALESCE(v_count, 0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_idle_voice_rooms() TO authenticated, anon;

-- 9) Admin can delete tribe (override via RPC for cascade safety, not strictly needed since policy added)
CREATE OR REPLACE FUNCTION public.admin_delete_tribe(_tribe_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  DELETE FROM public.tribes WHERE id = _tribe_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_delete_tribe(uuid) TO authenticated;

-- 10) Admin can delete voice room
CREATE OR REPLACE FUNCTION public.admin_delete_voice_room(_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  DELETE FROM public.voice_rooms WHERE id = _room_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_delete_voice_room(uuid) TO authenticated;
