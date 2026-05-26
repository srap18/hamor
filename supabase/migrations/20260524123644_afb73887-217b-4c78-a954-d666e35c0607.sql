
-- Join requests
CREATE TABLE public.tribe_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tribe_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tribe_id, user_id)
);
ALTER TABLE public.tribe_join_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tribe_officer(_user_id uuid, _tribe_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tribe_members
    WHERE user_id = _user_id AND tribe_id = _tribe_id AND role IN ('owner','moderator')
  );
$$;

CREATE POLICY tjr_insert_self ON public.tribe_join_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY tjr_select_involved ON public.tribe_join_requests FOR SELECT USING (
  auth.uid() = user_id OR public.is_tribe_officer(auth.uid(), tribe_id)
);
CREATE POLICY tjr_update_officer ON public.tribe_join_requests FOR UPDATE USING (
  public.is_tribe_officer(auth.uid(), tribe_id)
);
CREATE POLICY tjr_delete_self_or_officer ON public.tribe_join_requests FOR DELETE USING (
  auth.uid() = user_id OR public.is_tribe_officer(auth.uid(), tribe_id)
);

-- Allow tribe officers to update/delete members (kick/promote)
CREATE POLICY tm_update_officer ON public.tribe_members FOR UPDATE USING (
  public.is_tribe_officer(auth.uid(), tribe_id)
) WITH CHECK (public.is_tribe_officer(auth.uid(), tribe_id));
CREATE POLICY tm_delete_officer ON public.tribe_members FOR DELETE USING (
  public.is_tribe_officer(auth.uid(), tribe_id)
);

-- Wars
CREATE TABLE public.tribe_wars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declarer_id uuid NOT NULL,
  target_id uuid NOT NULL,
  declarer_tribe_id uuid,
  target_tribe_id uuid,
  status text NOT NULL DEFAULT 'active',
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
ALTER TABLE public.tribe_wars ENABLE ROW LEVEL SECURITY;
CREATE POLICY tw_insert_self ON public.tribe_wars FOR INSERT WITH CHECK (auth.uid() = declarer_id AND declarer_id <> target_id);
CREATE POLICY tw_select_all ON public.tribe_wars FOR SELECT USING (true);
CREATE POLICY tw_update_involved ON public.tribe_wars FOR UPDATE USING (auth.uid() = declarer_id OR auth.uid() = target_id);

-- Support gifts (repair or crew)
CREATE TABLE public.support_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  kind text NOT NULL,
  amount bigint NOT NULL DEFAULT 0,
  ship_id uuid,
  claimed boolean NOT NULL DEFAULT false,
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY sg_insert_sender ON public.support_gifts FOR INSERT WITH CHECK (auth.uid() = sender_id AND sender_id <> recipient_id);
CREATE POLICY sg_select_involved ON public.support_gifts FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY sg_update_recipient ON public.support_gifts FOR UPDATE USING (auth.uid() = recipient_id);
