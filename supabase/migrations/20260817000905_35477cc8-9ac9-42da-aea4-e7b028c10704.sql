
CREATE TABLE IF NOT EXISTS public.banned_phrase_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message_id uuid,
  channel text,
  peer_id uuid,
  tribe_id uuid,
  body text NOT NULL,
  phrase text NOT NULL,
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.banned_phrase_hits TO authenticated;
GRANT ALL ON public.banned_phrase_hits TO service_role;
ALTER TABLE public.banned_phrase_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read banned phrase hits" ON public.banned_phrase_hits;
CREATE POLICY "admins read banned phrase hits" ON public.banned_phrase_hits
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS banned_phrase_hits_created_idx ON public.banned_phrase_hits (created_at DESC);
CREATE INDEX IF NOT EXISTS banned_phrase_hits_user_idx ON public.banned_phrase_hits (user_id);

-- Phrases to watch (normalized comparison handles decoration / repeats / diacritics)
CREATE OR REPLACE FUNCTION public.banned_phrase_match(_body text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _norm text := public.normalize_for_profanity(_body);
  _flat text;
  _p text;
  _np text;
  _nf text;
  _phrases text[] := ARRAY['ملوك الاعماق'];
BEGIN
  IF _norm IS NULL OR length(_norm) = 0 THEN RETURN NULL; END IF;
  _flat := replace(_norm, ' ', '');
  FOREACH _p IN ARRAY _phrases LOOP
    _np := public.normalize_for_profanity(_p);
    _nf := replace(_np, ' ', '');
    IF position(_np IN _norm) > 0 OR position(_nf IN _flat) > 0 THEN
      RETURN _p;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._detect_banned_phrase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _hit text;
  _did_mute boolean := false;
BEGIN
  IF NEW.body IS NULL OR length(btrim(NEW.body)) = 0 THEN RETURN NEW; END IF;
  _hit := public.banned_phrase_match(NEW.body);
  IF _hit IS NULL THEN RETURN NEW; END IF;

  IF NOT public.is_admin(NEW.sender_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.chat_mutes
      WHERE user_id = NEW.sender_id AND active = true
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      INSERT INTO public.chat_mutes(user_id, reason, muted_by, active, expires_at, scope)
      VALUES (NEW.sender_id, 'كتابة عبارة ممنوعة: ' || _hit, NULL, true, now() + interval '7 days', 'both');
      _did_mute := true;
    END IF;
  END IF;

  INSERT INTO public.banned_phrase_hits(user_id, message_id, channel, peer_id, tribe_id, body, phrase, muted)
  VALUES (NEW.sender_id, NEW.id, NEW.channel, NEW.recipient_id, NEW.tribe_id, NEW.body, _hit, _did_mute);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detect_banned_phrase ON public.messages;
CREATE TRIGGER trg_detect_banned_phrase
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public._detect_banned_phrase();

-- Admin: list hits with player names
CREATE OR REPLACE FUNCTION public.admin_banned_phrase_hits(_limit integer DEFAULT 100)
RETURNS TABLE(
  id uuid, user_id uuid, user_name text, user_emoji text,
  peer_id uuid, peer_name text, channel text, body text,
  phrase text, muted boolean, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT h.id, h.user_id,
         COALESCE(p.display_name, 'غير معروف'), COALESCE(p.avatar_emoji, '👤'),
         h.peer_id, pr.display_name, h.channel, h.body, h.phrase, h.muted, h.created_at
  FROM public.banned_phrase_hits h
  LEFT JOIN public.profiles p ON p.id = h.user_id
  LEFT JOIN public.profiles pr ON pr.id = h.peer_id
  WHERE public.is_admin(auth.uid())
  ORDER BY h.created_at DESC
  LIMIT COALESCE(_limit, 100);
$$;

GRANT EXECUTE ON FUNCTION public.admin_banned_phrase_hits(integer) TO authenticated;

-- Admin: last 10 messages of the same conversation up to the hit
CREATE OR REPLACE FUNCTION public.admin_banned_phrase_context(_hit_id uuid)
RETURNS TABLE(
  id uuid, sender_id uuid, sender_name text, body text, channel text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h public.banned_phrase_hits%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  SELECT * INTO h FROM public.banned_phrase_hits WHERE banned_phrase_hits.id = _hit_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT m.id, m.sender_id, COALESCE(p.display_name, 'غير معروف') AS sender_name,
           COALESCE(m.body, '') AS body, m.channel, m.created_at
    FROM public.messages m
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    WHERE m.created_at <= h.created_at
      AND (
        (h.channel = 'dm' AND h.peer_id IS NOT NULL AND m.channel = 'dm'
          AND ((m.sender_id = h.user_id AND m.recipient_id = h.peer_id)
            OR (m.sender_id = h.peer_id AND m.recipient_id = h.user_id)))
        OR (h.channel = 'tribe' AND m.channel = 'tribe' AND m.tribe_id IS NOT DISTINCT FROM h.tribe_id)
        OR (h.channel NOT IN ('dm','tribe') AND m.channel = h.channel)
      )
    ORDER BY m.created_at DESC
    LIMIT 10
  ) t
  ORDER BY t.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_banned_phrase_context(uuid) TO authenticated;
