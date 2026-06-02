
-- ============ Forum topics ============
CREATE TABLE public.forum_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  votes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forum_topics_title_len CHECK (char_length(title) BETWEEN 4 AND 120),
  CONSTRAINT forum_topics_body_len CHECK (char_length(body) <= 1000)
);
CREATE INDEX forum_topics_sort_idx ON public.forum_topics (votes DESC, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.forum_topics TO authenticated;
GRANT ALL ON public.forum_topics TO service_role;

ALTER TABLE public.forum_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY ft_select_all ON public.forum_topics FOR SELECT TO authenticated USING (true);
CREATE POLICY ft_insert_own ON public.forum_topics FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY ft_delete_own_or_admin ON public.forum_topics FOR DELETE TO authenticated USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY ft_admin_update ON public.forum_topics FOR UPDATE TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ============ Votes ============
CREATE TABLE public.forum_topic_votes (
  topic_id uuid NOT NULL REFERENCES public.forum_topics(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.forum_topic_votes TO authenticated;
GRANT ALL ON public.forum_topic_votes TO service_role;

ALTER TABLE public.forum_topic_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY ftv_select_all ON public.forum_topic_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY ftv_insert_own ON public.forum_topic_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY ftv_delete_own ON public.forum_topic_votes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============ Vote counter triggers ============
CREATE OR REPLACE FUNCTION public.forum_topic_votes_count_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.forum_topics SET votes = votes + 1 WHERE id = NEW.topic_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.forum_topics SET votes = GREATEST(votes - 1, 0) WHERE id = OLD.topic_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER forum_topic_votes_count
AFTER INSERT OR DELETE ON public.forum_topic_votes
FOR EACH ROW EXECUTE FUNCTION public.forum_topic_votes_count_trg();

-- ============ Content validation trigger ============
CREATE OR REPLACE FUNCTION public.forum_topics_validate_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
  combined := COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.body,'');

  -- block URLs / links
  IF combined ~* '(https?://|www\.|\.com|\.net|\.org|\.io|\.co|\.me|t\.me|wa\.me|bit\.ly|tinyurl)' THEN
    RAISE EXCEPTION 'NO_LINKS';
  END IF;

  -- block English letters (Arabic, digits, punctuation, emojis only)
  IF combined ~ '[A-Za-z]' THEN
    RAISE EXCEPTION 'ARABIC_ONLY';
  END IF;

  -- block profanity
  FOREACH bad IN ARRAY banned LOOP
    IF position(bad IN lower(combined)) > 0 THEN
      RAISE EXCEPTION 'PROFANITY';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER forum_topics_validate
BEFORE INSERT OR UPDATE ON public.forum_topics
FOR EACH ROW EXECUTE FUNCTION public.forum_topics_validate_trg();
