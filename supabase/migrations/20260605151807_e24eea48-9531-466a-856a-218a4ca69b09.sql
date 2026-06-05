
CREATE OR REPLACE FUNCTION public.prune_messages_keep_last_50()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz;
  a uuid;
  b uuid;
BEGIN
  IF NEW.channel = 'public' THEN
    SELECT created_at INTO cutoff
    FROM public.messages
    WHERE channel = 'public'
    ORDER BY created_at DESC
    OFFSET 49 LIMIT 1;
    IF cutoff IS NOT NULL THEN
      DELETE FROM public.messages
      WHERE channel = 'public' AND created_at < cutoff;
    END IF;
  ELSIF NEW.channel = 'tribe' AND NEW.tribe_id IS NOT NULL THEN
    SELECT created_at INTO cutoff
    FROM public.messages
    WHERE channel = 'tribe' AND tribe_id = NEW.tribe_id
    ORDER BY created_at DESC
    OFFSET 49 LIMIT 1;
    IF cutoff IS NOT NULL THEN
      DELETE FROM public.messages
      WHERE channel = 'tribe' AND tribe_id = NEW.tribe_id AND created_at < cutoff;
    END IF;
  ELSIF NEW.channel = 'dm' AND NEW.recipient_id IS NOT NULL THEN
    a := LEAST(NEW.sender_id, NEW.recipient_id);
    b := GREATEST(NEW.sender_id, NEW.recipient_id);
    SELECT created_at INTO cutoff
    FROM public.messages
    WHERE channel = 'dm'
      AND LEAST(sender_id, recipient_id) = a
      AND GREATEST(sender_id, recipient_id) = b
    ORDER BY created_at DESC
    OFFSET 49 LIMIT 1;
    IF cutoff IS NOT NULL THEN
      DELETE FROM public.messages
      WHERE channel = 'dm'
        AND LEAST(sender_id, recipient_id) = a
        AND GREATEST(sender_id, recipient_id) = b
        AND created_at < cutoff;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prune_messages_keep_last_50 ON public.messages;
CREATE TRIGGER trg_prune_messages_keep_last_50
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.prune_messages_keep_last_50();
