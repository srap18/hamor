-- 1) Pinned admin message (single global row)
CREATE TABLE IF NOT EXISTS public.chat_pinned (
  id boolean PRIMARY KEY DEFAULT true,
  body text NOT NULL DEFAULT '',
  pinned_by uuid,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_pinned_singleton CHECK (id = true)
);
GRANT SELECT ON public.chat_pinned TO anon, authenticated;
GRANT ALL ON public.chat_pinned TO service_role;
ALTER TABLE public.chat_pinned ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_all_read ON public.chat_pinned FOR SELECT USING (true);
CREATE POLICY cp_admin_write ON public.chat_pinned FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- 2) Profanity word list
CREATE TABLE IF NOT EXISTS public.profanity_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT ON public.profanity_words TO authenticated;
GRANT ALL ON public.profanity_words TO service_role;
ALTER TABLE public.profanity_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY pw_admin_all ON public.profanity_words FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY pw_auth_read ON public.profanity_words FOR SELECT TO authenticated USING (true);

-- 3) Profanity warnings (24h window)
CREATE TABLE IF NOT EXISTS public.profanity_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  body text NOT NULL,
  matched_word text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profanity_warnings_user_time_idx ON public.profanity_warnings(user_id, created_at DESC);
GRANT SELECT ON public.profanity_warnings TO authenticated;
GRANT ALL ON public.profanity_warnings TO service_role;
ALTER TABLE public.profanity_warnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pwn_admin_all ON public.profanity_warnings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY pwn_own_read ON public.profanity_warnings FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4) Normalization function — strips diacritics, tatweel, zero-width, alef variants,
--    collapses 3+ repeated letters, removes everything except letters/digits.
CREATE OR REPLACE FUNCTION public.normalize_for_profanity(_t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text := COALESCE(_t, '');
BEGIN
  s := lower(s);
  -- remove arabic diacritics (tashkeel) and tatweel
  s := regexp_replace(s, '[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g');
  -- remove zero-width / bidi marks
  s := regexp_replace(s, '[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]', '', 'g');
  -- unify alef / yaa / taa marbuta
  s := regexp_replace(s, '[إأآٱا]', 'ا', 'g');
  s := regexp_replace(s, '[ىئي]', 'ي', 'g');
  s := regexp_replace(s, 'ة', 'ه', 'g');
  s := regexp_replace(s, 'ؤ', 'و', 'g');
  -- common arabizi / leet substitutions → arabic letters
  s := translate(s, '0123456789', 'ozegysbtao');
  -- keep only arabic letters + latin letters
  s := regexp_replace(s, '[^a-z\u0621-\u064A]', '', 'g');
  -- collapse runs of 3+ identical letters down to 1 (handles "كلللب" or "كلللللب")
  -- repeat until stable
  FOR i IN 1..6 LOOP
    s := regexp_replace(s, '(.)\1{2,}', '\1', 'g');
  END LOOP;
  -- also collapse pairs to single (so "كككلب", "ككلب" both become "كلب")
  s := regexp_replace(s, '(.)\1', '\1', 'g');
  RETURN s;
END;
$$;

-- 5) Check function: returns matched word or NULL
CREATE OR REPLACE FUNCTION public.check_profanity(_body text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text := public.normalize_for_profanity(_body);
  _w record;
  _nw text;
BEGIN
  IF _norm IS NULL OR length(_norm) = 0 THEN RETURN NULL; END IF;
  FOR _w IN SELECT word FROM public.profanity_words LOOP
    _nw := public.normalize_for_profanity(_w.word);
    IF length(_nw) >= 2 AND position(_nw IN _norm) > 0 THEN
      RETURN _w.word;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_profanity(text) FROM anon;

-- 6) Send-safe RPC
CREATE OR REPLACE FUNCTION public.send_chat_message_safe(
  _channel text,
  _body text,
  _recipient_id uuid DEFAULT NULL,
  _tribe_id uuid DEFAULT NULL,
  _reply_to_id uuid DEFAULT NULL,
  _reply_to_body text DEFAULT NULL,
  _reply_to_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _matched text;
  _warn_count int;
  _mute_count int;
  _mute_hours int;
  _expires timestamptz;
  _msg_id uuid;
  _body text := btrim(COALESCE(_body, ''));
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(_body) = 0 THEN RAISE EXCEPTION 'empty body'; END IF;
  IF length(_body) > 500 THEN _body := left(_body, 500); END IF;
  IF _channel NOT IN ('public','tribe','dm') THEN RAISE EXCEPTION 'bad channel'; END IF;

  -- if currently muted, reject
  IF EXISTS (
    SELECT 1 FROM public.chat_mutes
    WHERE user_id = _uid AND active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN jsonb_build_object('status', 'muted_already', 'reason', 'أنت مكتوم حالياً');
  END IF;

  _matched := public.check_profanity(_body);

  IF _matched IS NOT NULL THEN
    -- log warning
    INSERT INTO public.profanity_warnings(user_id, body, matched_word)
    VALUES (_uid, _body, _matched);

    -- count warnings in the last 24h (including the one just inserted)
    SELECT count(*) INTO _warn_count
    FROM public.profanity_warnings
    WHERE user_id = _uid AND created_at > now() - interval '24 hours';

    IF _warn_count < 3 THEN
      -- warnings 1 and 2: just a warning, message blocked
      RETURN jsonb_build_object(
        'status', 'warned',
        'warn_count', _warn_count,
        'remaining', 3 - _warn_count,
        'message', 'تحذير ' || _warn_count || '/2 — ممنوع السب والشتم. تكرار المخالفة سيؤدي للكتم.'
      );
    END IF;

    -- 3rd+ offense → mute, escalate based on prior profanity mutes
    SELECT count(*) INTO _mute_count
    FROM public.chat_mutes
    WHERE user_id = _uid AND reason LIKE 'profanity%';

    _mute_hours := CASE _mute_count
      WHEN 0 THEN 1
      WHEN 1 THEN 6
      WHEN 2 THEN 12
      WHEN 3 THEN 24
      WHEN 4 THEN 48
      ELSE 168
    END;
    _expires := now() + make_interval(hours => _mute_hours);

    -- deactivate any prior active mutes, then insert the new one
    UPDATE public.chat_mutes SET active = false
     WHERE user_id = _uid AND active = true;
    INSERT INTO public.chat_mutes(user_id, reason, expires_at, active)
    VALUES (_uid, 'profanity:' || _matched, _expires, true);

    RETURN jsonb_build_object(
      'status', 'muted',
      'hours', _mute_hours,
      'expires_at', _expires,
      'message', 'تم كتمك ' || _mute_hours || ' ساعة بسبب تكرار السب.'
    );
  END IF;

  -- clean message → insert
  IF _channel = 'tribe' THEN
    IF _tribe_id IS NULL OR NOT public.is_tribe_member(_uid, _tribe_id) THEN
      RAISE EXCEPTION 'not tribe member';
    END IF;
  ELSIF _channel = 'dm' THEN
    IF _recipient_id IS NULL OR _recipient_id = _uid THEN
      RAISE EXCEPTION 'bad recipient';
    END IF;
  END IF;

  INSERT INTO public.messages(channel, body, sender_id, recipient_id, tribe_id,
                              reply_to_id, reply_to_body, reply_to_name)
  VALUES (_channel, _body, _uid,
          CASE WHEN _channel='dm' THEN _recipient_id ELSE NULL END,
          CASE WHEN _channel='tribe' THEN _tribe_id ELSE NULL END,
          _reply_to_id, left(COALESCE(_reply_to_body,''), 200), left(COALESCE(_reply_to_name,''), 60))
  RETURNING id INTO _msg_id;

  RETURN jsonb_build_object('status', 'ok', 'message_id', _msg_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.send_chat_message_safe(text, text, uuid, uuid, uuid, text, text) FROM anon;

-- 7) Set/clear pinned message helpers (admin only via RLS, but provide convenience RPC)
CREATE OR REPLACE FUNCTION public.set_pinned_chat(_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin only'; END IF;
  INSERT INTO public.chat_pinned(id, body, pinned_by, pinned_at)
  VALUES (true, COALESCE(_body, ''), auth.uid(), now())
  ON CONFLICT (id) DO UPDATE
    SET body = EXCLUDED.body,
        pinned_by = EXCLUDED.pinned_by,
        pinned_at = EXCLUDED.pinned_at;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_pinned_chat(text) FROM anon;

-- 8) Seed initial profanity list (admin can edit later)
INSERT INTO public.profanity_words(word) VALUES
  ('كلب'), ('حمار'), ('خنزير'), ('قرد'),
  ('زب'), ('زبي'), ('كس'), ('كسمك'), ('كسختك'), ('كسامك'),
  ('طيز'), ('طيزك'),
  ('شرموط'), ('شرموطه'), ('شراميط'),
  ('قحبه'), ('قحاب'),
  ('عاهره'), ('عاهرات'),
  ('نيك'), ('منيوك'), ('منيك'), ('متناك'), ('متناكه'), ('نياك'),
  ('خرا'), ('خراء'), ('خرى'), ('خاري'),
  ('لعنه'), ('يلعن'), ('ملعون'),
  ('زفت'), ('طز'),
  ('فيك'), ('عرص'), ('عرصات'), ('ابن العرص'),
  ('ابن الكلب'), ('ابن الحرام'), ('ابن الزنا'),
  ('فاجر'), ('فاجره'),
  ('حقير'), ('حقاير'),
  ('سحاقيه'), ('شاذ'),
  ('fuck'), ('shit'), ('bitch'), ('asshole'), ('cunt'), ('dick')
ON CONFLICT (word) DO NOTHING;