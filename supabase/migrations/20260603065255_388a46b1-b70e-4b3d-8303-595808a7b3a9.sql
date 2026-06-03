
-- Replies table
CREATE TABLE public.forum_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.forum_topics(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_forum_replies_topic ON public.forum_replies(topic_id, created_at);

GRANT SELECT, INSERT, DELETE ON public.forum_replies TO authenticated;
GRANT ALL ON public.forum_replies TO service_role;

ALTER TABLE public.forum_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY fr_select_all ON public.forum_replies FOR SELECT TO authenticated USING (true);
CREATE POLICY fr_insert_own ON public.forum_replies FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY fr_delete_own_or_admin ON public.forum_replies FOR DELETE TO authenticated USING (auth.uid() = user_id OR is_admin(auth.uid()));

-- Replies count on topics
ALTER TABLE public.forum_topics ADD COLUMN IF NOT EXISTS replies_count int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.forum_replies_count_trg()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.forum_topics SET replies_count = replies_count + 1 WHERE id = NEW.topic_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.forum_topics SET replies_count = GREATEST(0, replies_count - 1) WHERE id = OLD.topic_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER forum_replies_count_ai AFTER INSERT ON public.forum_replies
FOR EACH ROW EXECUTE FUNCTION public.forum_replies_count_trg();
CREATE TRIGGER forum_replies_count_ad AFTER DELETE ON public.forum_replies
FOR EACH ROW EXECUTE FUNCTION public.forum_replies_count_trg();

-- Validate replies: same content rules + ban check
CREATE OR REPLACE FUNCTION public.forum_replies_validate_trg()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  combined text;
  bad text;
  banned text[] := ARRAY[
    'كلب','كلاب','حمار','حمير','خنزير','خنازير','زفت','تفو',
    'قحب','قحبة','شرموط','شرموطة','عاهر','عاهرة','منيوك','منيوكة',
    'كس','كسك','كسمك','كسختك','كسامك','طيز','طيزك','زب','زبر','زبري',
    'نيك','نياك','منيك','انيك','نياكة','نياكه',
    'لعن','لعنة','يلعن','ملعون','ابن الكلب','ابن كلب','ابن العاهرة',
    'fuck','shit','bitch','asshole','dick','pussy','whore','slut','cunt'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM public.forum_bans WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'FORUM_BANNED';
  END IF;
  combined := COALESCE(NEW.body,'');
  IF length(trim(combined)) < 2 THEN RAISE EXCEPTION 'TOO_SHORT'; END IF;
  IF length(combined) > 500 THEN RAISE EXCEPTION 'TOO_LONG'; END IF;
  IF combined ~* '(https?://|www\.|\.com|\.net|\.org|\.io|\.co|\.me|t\.me|wa\.me|bit\.ly|tinyurl)' THEN
    RAISE EXCEPTION 'NO_LINKS';
  END IF;
  IF combined ~ '[A-Za-z]' THEN
    RAISE EXCEPTION 'ARABIC_ONLY';
  END IF;
  FOREACH bad IN ARRAY banned LOOP
    IF position(bad IN lower(combined)) > 0 THEN
      RAISE EXCEPTION 'PROFANITY';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER forum_replies_validate_bi BEFORE INSERT ON public.forum_replies
FOR EACH ROW EXECUTE FUNCTION public.forum_replies_validate_trg();

-- 6-hour rate limit on topics
CREATE OR REPLACE FUNCTION public.forum_topics_rate_limit_trg()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  last_at timestamptz;
BEGIN
  SELECT max(created_at) INTO last_at FROM public.forum_topics WHERE user_id = NEW.user_id;
  IF last_at IS NOT NULL AND last_at > now() - interval '6 hours' THEN
    RAISE EXCEPTION 'RATE_LIMIT_6H';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER forum_topics_rate_limit_bi BEFORE INSERT ON public.forum_topics
FOR EACH ROW EXECUTE FUNCTION public.forum_topics_rate_limit_trg();

-- Update admin ban to also delete replies
CREATE OR REPLACE FUNCTION public.forum_admin_ban(_user_id uuid, _reason text DEFAULT ''::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.forum_bans(user_id, banned_by, reason)
    VALUES (_user_id, auth.uid(), COALESCE(_reason, ''))
    ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by;
  DELETE FROM public.forum_topics WHERE user_id = _user_id;
  DELETE FROM public.forum_replies WHERE user_id = _user_id;
END $$;

-- Backfill counts
UPDATE public.forum_topics t SET replies_count = COALESCE(
  (SELECT count(*) FROM public.forum_replies r WHERE r.topic_id = t.id), 0
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.forum_replies;
