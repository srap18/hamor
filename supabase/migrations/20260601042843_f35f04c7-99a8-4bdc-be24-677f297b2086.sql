
-- Ad bombs: 500 gems = play a chosen video over target's harbor for 1 hour.
-- Victim can pay 100 gems to remove all their active ad bombs.

CREATE TABLE public.ad_bombs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  attacker_id uuid NOT NULL,
  video_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ad_bombs_target_active_idx ON public.ad_bombs (target_user_id, active, expires_at);

GRANT SELECT ON public.ad_bombs TO anon, authenticated;
GRANT ALL ON public.ad_bombs TO service_role;

ALTER TABLE public.ad_bombs ENABLE ROW LEVEL SECURITY;

-- Everyone can read active bombs (so any visitor sees them).
CREATE POLICY adb_read_all ON public.ad_bombs FOR SELECT USING (true);

-- Inserts/updates only via RPC (security definer); no direct policies needed.

ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_bombs;
ALTER TABLE public.ad_bombs REPLICA IDENTITY FULL;

-- RPC: launch ad bomb (charges 500 gems from attacker)
CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _gems integer;
  _new_id uuid;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;

  SELECT gems INTO _gems FROM public.profiles WHERE id = _attacker FOR UPDATE;
  IF _gems IS NULL OR _gems < 500 THEN RAISE EXCEPTION 'insufficient gems'; END IF;

  UPDATE public.profiles SET gems = gems - 500 WHERE id = _attacker;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (_target_id, '📺 قنبلة إعلانية!', 'تم تفجير قنبلة إعلانية على محيطك لمدة ساعة. ادفع 100 جوهرة لإزالتها.', 'attack', _attacker);

  RETURN _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.launch_ad_bomb(uuid, text) TO authenticated;

-- RPC: victim removes all their active ad bombs for 100 gems
CREATE OR REPLACE FUNCTION public.remove_ad_bombs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _gems integer;
  _count integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT count(*) INTO _count
  FROM public.ad_bombs
  WHERE target_user_id = _uid AND active = true AND expires_at > now();

  IF _count = 0 THEN RAISE EXCEPTION 'no active ad bombs'; END IF;

  SELECT gems INTO _gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _gems IS NULL OR _gems < 100 THEN RAISE EXCEPTION 'insufficient gems'; END IF;

  UPDATE public.profiles SET gems = gems - 100 WHERE id = _uid;
  UPDATE public.ad_bombs SET active = false
  WHERE target_user_id = _uid AND active = true AND expires_at > now();

  RETURN _count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_ad_bombs() TO authenticated;
