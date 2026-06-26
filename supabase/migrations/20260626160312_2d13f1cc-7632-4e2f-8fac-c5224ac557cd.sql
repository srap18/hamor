
-- ============== VOICE ROOMS SYSTEM ==============

CREATE TYPE public.voice_room_role AS ENUM ('owner','mod','speaker','listener');
CREATE TYPE public.voice_room_req_status AS ENUM ('pending','accepted','rejected','cancelled');
CREATE TYPE public.voice_room_report_target AS ENUM ('room','user');

-- ---------- rooms ----------
CREATE TABLE public.voice_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  image_url text,
  seat_count int NOT NULL DEFAULT 8 CHECK (seat_count BETWEEN 2 AND 20),
  is_private boolean NOT NULL DEFAULT false,
  password text,
  allow_mic_requests boolean NOT NULL DEFAULT true,
  listeners_only boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX voice_rooms_one_active_per_owner
  ON public.voice_rooms(owner_id) WHERE closed_at IS NULL;
CREATE INDEX voice_rooms_active_idx ON public.voice_rooms(created_at DESC) WHERE closed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_rooms TO authenticated;
GRANT SELECT ON public.voice_rooms TO anon;
GRANT ALL ON public.voice_rooms TO service_role;
ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;

-- ---------- members (presence) ----------
CREATE TABLE public.voice_room_members (
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.voice_room_role NOT NULL DEFAULT 'listener',
  seat_index int,
  muted boolean NOT NULL DEFAULT false,
  speaking boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id),
  UNIQUE (room_id, seat_index)
);
CREATE INDEX voice_room_members_room_idx ON public.voice_room_members(room_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_room_members TO authenticated;
GRANT SELECT ON public.voice_room_members TO anon;
GRANT ALL ON public.voice_room_members TO service_role;
ALTER TABLE public.voice_room_members ENABLE ROW LEVEL SECURITY;

-- ---------- mic requests ----------
CREATE TABLE public.voice_room_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.voice_room_req_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX voice_room_requests_one_pending
  ON public.voice_room_requests(room_id, user_id) WHERE status = 'pending';
CREATE INDEX voice_room_requests_room_pending_idx
  ON public.voice_room_requests(room_id, created_at) WHERE status = 'pending';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_room_requests TO authenticated;
GRANT ALL ON public.voice_room_requests TO service_role;
ALTER TABLE public.voice_room_requests ENABLE ROW LEVEL SECURITY;

-- ---------- messages ----------
CREATE TABLE public.voice_room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  pinned boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voice_room_messages_room_idx ON public.voice_room_messages(room_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_room_messages TO authenticated;
GRANT ALL ON public.voice_room_messages TO service_role;
ALTER TABLE public.voice_room_messages ENABLE ROW LEVEL SECURITY;

-- ---------- bans (per-room) ----------
CREATE TABLE public.voice_room_bans (
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  banned_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.voice_room_bans TO authenticated;
GRANT ALL ON public.voice_room_bans TO service_role;
ALTER TABLE public.voice_room_bans ENABLE ROW LEVEL SECURITY;

-- ---------- reports ----------
CREATE TABLE public.voice_room_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type public.voice_room_report_target NOT NULL,
  target_user_id uuid REFERENCES auth.users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 500),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.voice_room_reports TO authenticated;
GRANT ALL ON public.voice_room_reports TO service_role;
ALTER TABLE public.voice_room_reports ENABLE ROW LEVEL SECURITY;

-- ---------- logs ----------
CREATE TABLE public.voice_room_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  target_user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voice_room_logs_room_idx ON public.voice_room_logs(room_id, created_at DESC);
GRANT SELECT, INSERT ON public.voice_room_logs TO authenticated;
GRANT ALL ON public.voice_room_logs TO service_role;
ALTER TABLE public.voice_room_logs ENABLE ROW LEVEL SECURITY;

-- ---------- global creation bans (admin) ----------
CREATE TABLE public.voice_room_creation_bans (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  banned_by uuid REFERENCES auth.users(id),
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.voice_room_creation_bans TO authenticated;
GRANT ALL ON public.voice_room_creation_bans TO service_role;
ALTER TABLE public.voice_room_creation_bans ENABLE ROW LEVEL SECURITY;

-- ---------- global voice mutes (admin) ----------
CREATE TABLE public.voice_room_global_mutes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_by uuid REFERENCES auth.users(id),
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.voice_room_global_mutes TO authenticated;
GRANT ALL ON public.voice_room_global_mutes TO service_role;
ALTER TABLE public.voice_room_global_mutes ENABLE ROW LEVEL SECURITY;

-- =============== HELPER FUNCTIONS ===============

CREATE OR REPLACE FUNCTION public.vr_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('admin','moderator'));
$$;

CREATE OR REPLACE FUNCTION public.vr_is_owner(_room uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.voice_rooms WHERE id = _room AND owner_id = _uid AND closed_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.vr_is_mod_or_owner(_room uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.voice_rooms r WHERE r.id = _room AND r.closed_at IS NULL AND r.owner_id = _uid
  ) OR EXISTS (
    SELECT 1 FROM public.voice_room_members m
    WHERE m.room_id = _room AND m.user_id = _uid AND m.role = 'mod'
  );
$$;

CREATE OR REPLACE FUNCTION public.vr_is_banned(_room uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.voice_room_bans WHERE room_id = _room AND user_id = _uid);
$$;

-- =============== RLS POLICIES ===============

-- voice_rooms: public can read non-private rooms (private show metadata only via RPC)
CREATE POLICY vr_rooms_select ON public.voice_rooms FOR SELECT
  USING (true);
CREATE POLICY vr_rooms_insert ON public.voice_rooms FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY vr_rooms_update ON public.voice_rooms FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.vr_is_admin(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.vr_is_admin(auth.uid()));
CREATE POLICY vr_rooms_delete ON public.voice_rooms FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.vr_is_admin(auth.uid()));

-- members
CREATE POLICY vr_members_select ON public.voice_room_members FOR SELECT USING (true);
CREATE POLICY vr_members_insert ON public.voice_room_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT public.vr_is_banned(room_id, auth.uid()));
CREATE POLICY vr_members_update ON public.voice_room_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_mod_or_owner(room_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.vr_is_mod_or_owner(room_id, auth.uid()));
CREATE POLICY vr_members_delete ON public.voice_room_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_mod_or_owner(room_id, auth.uid()));

-- requests
CREATE POLICY vr_req_select ON public.voice_room_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_mod_or_owner(room_id, auth.uid()));
CREATE POLICY vr_req_insert ON public.voice_room_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT public.vr_is_banned(room_id, auth.uid()));
CREATE POLICY vr_req_update ON public.voice_room_requests FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_mod_or_owner(room_id, auth.uid()));
CREATE POLICY vr_req_delete ON public.voice_room_requests FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_mod_or_owner(room_id, auth.uid()));

-- messages
CREATE POLICY vr_msg_select ON public.voice_room_messages FOR SELECT USING (true);
CREATE POLICY vr_msg_insert ON public.voice_room_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT public.vr_is_banned(room_id, auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.voice_room_global_mutes m
      WHERE m.user_id = auth.uid() AND (m.expires_at IS NULL OR m.expires_at > now())));
CREATE POLICY vr_msg_update ON public.voice_room_messages FOR UPDATE TO authenticated
  USING (public.vr_is_mod_or_owner(room_id, auth.uid()) OR public.vr_is_admin(auth.uid()));
CREATE POLICY vr_msg_delete ON public.voice_room_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_mod_or_owner(room_id, auth.uid()) OR public.vr_is_admin(auth.uid()));

-- bans
CREATE POLICY vr_bans_select ON public.voice_room_bans FOR SELECT TO authenticated
  USING (public.vr_is_mod_or_owner(room_id, auth.uid()) OR user_id = auth.uid());
CREATE POLICY vr_bans_insert ON public.voice_room_bans FOR INSERT TO authenticated
  WITH CHECK (public.vr_is_mod_or_owner(room_id, auth.uid()) AND banned_by = auth.uid());
CREATE POLICY vr_bans_delete ON public.voice_room_bans FOR DELETE TO authenticated
  USING (public.vr_is_mod_or_owner(room_id, auth.uid()));

-- reports
CREATE POLICY vr_reports_insert ON public.voice_room_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
CREATE POLICY vr_reports_select ON public.voice_room_reports FOR SELECT TO authenticated
  USING (public.vr_is_admin(auth.uid()) OR reporter_id = auth.uid());

-- logs
CREATE POLICY vr_logs_select ON public.voice_room_logs FOR SELECT TO authenticated
  USING (public.vr_is_mod_or_owner(room_id, auth.uid()) OR public.vr_is_admin(auth.uid()));
CREATE POLICY vr_logs_insert ON public.voice_room_logs FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR public.vr_is_admin(auth.uid()));

-- creation bans (read own + admin manage)
CREATE POLICY vr_cban_select ON public.voice_room_creation_bans FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_admin(auth.uid()));

-- global mutes (read own + admin manage)
CREATE POLICY vr_gmute_select ON public.voice_room_global_mutes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.vr_is_admin(auth.uid()));

-- =============== CORE RPCs ===============

-- Create room (VIP only, no double active room, not creation-banned)
CREATE OR REPLACE FUNCTION public.vr_create_room(
  _name text, _description text, _image_url text, _seats int,
  _is_private boolean, _password text, _allow_mic_requests boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _vip int;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT COALESCE(elite_vip_level,0) INTO _vip FROM public.profiles WHERE id = _uid;
  IF COALESCE(_vip,0) < 1 THEN RAISE EXCEPTION 'vip_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.voice_room_creation_bans
             WHERE user_id = _uid AND (expires_at IS NULL OR expires_at > now())) THEN
    RAISE EXCEPTION 'creation_banned';
  END IF;
  IF EXISTS (SELECT 1 FROM public.voice_rooms WHERE owner_id = _uid AND closed_at IS NULL) THEN
    RAISE EXCEPTION 'already_owns_room';
  END IF;

  INSERT INTO public.voice_rooms(owner_id,name,description,image_url,seat_count,is_private,password,allow_mic_requests)
  VALUES (_uid, _name, NULLIF(_description,''), NULLIF(_image_url,''),
          COALESCE(_seats,8), COALESCE(_is_private,false), NULLIF(_password,''), COALESCE(_allow_mic_requests,true))
  RETURNING id INTO _new_id;

  INSERT INTO public.voice_room_members(room_id,user_id,role,seat_index)
  VALUES (_new_id, _uid, 'owner', 0);

  INSERT INTO public.voice_room_logs(room_id,actor_id,action,details)
  VALUES (_new_id,_uid,'room_created', jsonb_build_object('name',_name));

  RETURN _new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.vr_create_room(text,text,text,int,boolean,text,boolean) TO authenticated;

-- Join room
CREATE OR REPLACE FUNCTION public.vr_join_room(_room uuid, _password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r public.voice_rooms%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO _r FROM public.voice_rooms WHERE id = _room AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'room_not_found'; END IF;
  IF public.vr_is_banned(_room, _uid) THEN RAISE EXCEPTION 'banned_from_room'; END IF;
  IF _r.locked AND _r.owner_id <> _uid THEN RAISE EXCEPTION 'room_locked'; END IF;
  IF _r.is_private AND _r.password IS NOT NULL AND _r.password <> COALESCE(_password,'') AND _r.owner_id <> _uid THEN
    RAISE EXCEPTION 'wrong_password';
  END IF;

  INSERT INTO public.voice_room_members(room_id,user_id,role)
  VALUES (_room, _uid, CASE WHEN _r.owner_id = _uid THEN 'owner'::voice_room_role ELSE 'listener'::voice_room_role END)
  ON CONFLICT (room_id,user_id) DO UPDATE SET last_seen_at = now();

  INSERT INTO public.voice_room_logs(room_id,actor_id,action) VALUES (_room,_uid,'joined');
END $$;
GRANT EXECUTE ON FUNCTION public.vr_join_room(uuid,text) TO authenticated;

-- Leave room (owner -> close room)
CREATE OR REPLACE FUNCTION public.vr_leave_room(_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT owner_id INTO _owner FROM public.voice_rooms WHERE id = _room AND closed_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM public.voice_room_members WHERE room_id = _room AND user_id = _uid;
  INSERT INTO public.voice_room_logs(room_id,actor_id,action) VALUES (_room,_uid,'left');
  IF _owner = _uid THEN
    UPDATE public.voice_rooms SET closed_at = now() WHERE id = _room;
    INSERT INTO public.voice_room_logs(room_id,actor_id,action) VALUES (_room,_uid,'room_closed');
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.vr_leave_room(uuid) TO authenticated;

-- Request mic
CREATE OR REPLACE FUNCTION public.vr_request_mic(_room uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r public.voice_rooms%ROWTYPE; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO _r FROM public.voice_rooms WHERE id = _room AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'room_not_found'; END IF;
  IF NOT _r.allow_mic_requests OR _r.listeners_only THEN RAISE EXCEPTION 'requests_disabled'; END IF;
  IF public.vr_is_banned(_room,_uid) THEN RAISE EXCEPTION 'banned'; END IF;

  INSERT INTO public.voice_room_requests(room_id,user_id) VALUES (_room,_uid)
  ON CONFLICT (room_id,user_id) WHERE status = 'pending' DO NOTHING
  RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.vr_request_mic(uuid) TO authenticated;

-- Resolve request (accept -> assign seat; reject)
CREATE OR REPLACE FUNCTION public.vr_resolve_request(_req uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _q public.voice_room_requests%ROWTYPE;
  _r public.voice_rooms%ROWTYPE;
  _seat int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO _q FROM public.voice_room_requests WHERE id = _req AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  SELECT * INTO _r FROM public.voice_rooms WHERE id = _q.room_id AND closed_at IS NULL;
  IF NOT public.vr_is_mod_or_owner(_q.room_id,_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF _accept THEN
    SELECT s INTO _seat FROM generate_series(1, _r.seat_count-1) s
      WHERE NOT EXISTS (SELECT 1 FROM public.voice_room_members m
        WHERE m.room_id = _q.room_id AND m.seat_index = s) LIMIT 1;
    IF _seat IS NULL THEN RAISE EXCEPTION 'seats_full'; END IF;

    INSERT INTO public.voice_room_members(room_id,user_id,role,seat_index)
    VALUES (_q.room_id,_q.user_id,'speaker',_seat)
    ON CONFLICT (room_id,user_id) DO UPDATE SET role='speaker', seat_index=_seat, muted=false;

    UPDATE public.voice_room_requests SET status='accepted', resolved_at=now() WHERE id = _req;
    INSERT INTO public.voice_room_logs(room_id,actor_id,target_user_id,action)
    VALUES (_q.room_id,_uid,_q.user_id,'mic_accepted');
  ELSE
    UPDATE public.voice_room_requests SET status='rejected', resolved_at=now() WHERE id = _req;
    INSERT INTO public.voice_room_logs(room_id,actor_id,target_user_id,action)
    VALUES (_q.room_id,_uid,_q.user_id,'mic_rejected');
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.vr_resolve_request(uuid,boolean) TO authenticated;

-- Moderation actions: kick, ban, unban, mute, unmute, remove from mic, set mod, transfer ownership
CREATE OR REPLACE FUNCTION public.vr_mod_action(
  _room uuid, _target uuid, _action text, _details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r public.voice_rooms%ROWTYPE;
  _owner_only boolean := _action IN ('set_mod','remove_mod','transfer_owner','delete_room','rename','change_image','change_description','change_seats','toggle_listeners_only','toggle_mic_requests','lock','unlock');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT * INTO _r FROM public.voice_rooms WHERE id = _room AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'room_not_found'; END IF;

  IF _owner_only AND _r.owner_id <> _uid AND NOT public.vr_is_admin(_uid) THEN
    RAISE EXCEPTION 'owner_only';
  END IF;
  IF NOT _owner_only AND NOT public.vr_is_mod_or_owner(_room,_uid) AND NOT public.vr_is_admin(_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- protect owner from being targeted by mods
  IF _target = _r.owner_id AND _uid <> _r.owner_id AND NOT public.vr_is_admin(_uid) THEN
    RAISE EXCEPTION 'cannot_target_owner';
  END IF;

  CASE _action
    WHEN 'kick' THEN
      DELETE FROM public.voice_room_members WHERE room_id=_room AND user_id=_target;
    WHEN 'ban' THEN
      DELETE FROM public.voice_room_members WHERE room_id=_room AND user_id=_target;
      INSERT INTO public.voice_room_bans(room_id,user_id,banned_by) VALUES (_room,_target,_uid)
      ON CONFLICT DO NOTHING;
    WHEN 'unban' THEN
      DELETE FROM public.voice_room_bans WHERE room_id=_room AND user_id=_target;
    WHEN 'mute' THEN
      UPDATE public.voice_room_members SET muted=true WHERE room_id=_room AND user_id=_target;
    WHEN 'unmute' THEN
      UPDATE public.voice_room_members SET muted=false WHERE room_id=_room AND user_id=_target;
    WHEN 'remove_mic' THEN
      UPDATE public.voice_room_members SET role='listener', seat_index=NULL, muted=false
        WHERE room_id=_room AND user_id=_target;
    WHEN 'set_mod' THEN
      UPDATE public.voice_room_members SET role='mod' WHERE room_id=_room AND user_id=_target;
    WHEN 'remove_mod' THEN
      UPDATE public.voice_room_members SET role='listener' WHERE room_id=_room AND user_id=_target;
    WHEN 'transfer_owner' THEN
      UPDATE public.voice_rooms SET owner_id = _target WHERE id = _room;
      UPDATE public.voice_room_members SET role='owner' WHERE room_id=_room AND user_id=_target;
      UPDATE public.voice_room_members SET role='listener' WHERE room_id=_room AND user_id=_uid;
    WHEN 'delete_room' THEN
      UPDATE public.voice_rooms SET closed_at=now() WHERE id=_room;
    WHEN 'rename' THEN
      UPDATE public.voice_rooms SET name = COALESCE(_details->>'name',name), updated_at=now() WHERE id=_room;
    WHEN 'change_description' THEN
      UPDATE public.voice_rooms SET description = _details->>'description', updated_at=now() WHERE id=_room;
    WHEN 'change_image' THEN
      UPDATE public.voice_rooms SET image_url = _details->>'image_url', updated_at=now() WHERE id=_room;
    WHEN 'change_seats' THEN
      UPDATE public.voice_rooms SET seat_count = GREATEST(2, LEAST(20, (_details->>'seats')::int)), updated_at=now() WHERE id=_room;
    WHEN 'toggle_listeners_only' THEN
      UPDATE public.voice_rooms SET listeners_only = COALESCE((_details->>'value')::boolean,NOT listeners_only) WHERE id=_room;
    WHEN 'toggle_mic_requests' THEN
      UPDATE public.voice_rooms SET allow_mic_requests = COALESCE((_details->>'value')::boolean,NOT allow_mic_requests) WHERE id=_room;
    WHEN 'lock' THEN UPDATE public.voice_rooms SET locked=true WHERE id=_room;
    WHEN 'unlock' THEN UPDATE public.voice_rooms SET locked=false WHERE id=_room;
    ELSE RAISE EXCEPTION 'unknown_action: %', _action;
  END CASE;

  INSERT INTO public.voice_room_logs(room_id,actor_id,target_user_id,action,details)
  VALUES (_room,_uid,_target,_action,_details);
END $$;
GRANT EXECUTE ON FUNCTION public.vr_mod_action(uuid,uuid,text,jsonb) TO authenticated;

-- Admin: ban from creating rooms
CREATE OR REPLACE FUNCTION public.vr_admin_creation_ban(_target uuid, _reason text, _expires timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.vr_is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.voice_room_creation_bans(user_id,banned_by,reason,expires_at)
  VALUES (_target, auth.uid(), _reason, _expires)
  ON CONFLICT (user_id) DO UPDATE
    SET banned_by=EXCLUDED.banned_by, reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at, created_at=now();
END $$;
GRANT EXECUTE ON FUNCTION public.vr_admin_creation_ban(uuid,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.vr_admin_creation_unban(_target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.vr_is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.voice_room_creation_bans WHERE user_id = _target;
END $$;
GRANT EXECUTE ON FUNCTION public.vr_admin_creation_unban(uuid) TO authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_bans;
