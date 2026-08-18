CREATE OR REPLACE FUNCTION public.prune_messages_keep_last_50()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a uuid;
  b uuid;
  lock_key bigint;
  ids uuid[];
BEGIN
  -- Only one pruning session per conversation at a time; others skip instantly.
  IF NEW.channel = 'public' THEN
    lock_key := hashtextextended('msgprune:public', 0);
  ELSIF NEW.channel = 'tribe' AND NEW.tribe_id IS NOT NULL THEN
    lock_key := hashtextextended('msgprune:tribe:' || NEW.tribe_id::text, 0);
  ELSIF NEW.channel = 'dm' AND NEW.recipient_id IS NOT NULL THEN
    a := LEAST(NEW.sender_id, NEW.recipient_id);
    b := GREATEST(NEW.sender_id, NEW.recipient_id);
    lock_key := hashtextextended('msgprune:dm:' || a::text || ':' || b::text, 0);
  ELSE
    RETURN NULL;
  END IF;

  IF NOT pg_try_advisory_xact_lock(lock_key) THEN
    RETURN NULL;
  END IF;

  IF NEW.channel = 'public' THEN
    SELECT array_agg(id) INTO ids FROM (
      SELECT id FROM public.messages
      WHERE channel = 'public'
      ORDER BY created_at DESC
      OFFSET 50
      LIMIT 200
    ) s;
  ELSIF NEW.channel = 'tribe' THEN
    SELECT array_agg(id) INTO ids FROM (
      SELECT id FROM public.messages
      WHERE channel = 'tribe' AND tribe_id = NEW.tribe_id
      ORDER BY created_at DESC
      OFFSET 50
      LIMIT 200
    ) s;
  ELSE
    SELECT array_agg(id) INTO ids FROM (
      SELECT id FROM public.messages
      WHERE channel = 'dm'
        AND ((sender_id = a AND recipient_id = b) OR (sender_id = b AND recipient_id = a))
      ORDER BY created_at DESC
      OFFSET 50
      LIMIT 200
    ) s;
  END IF;

  IF ids IS NOT NULL AND array_length(ids, 1) > 0 THEN
    DELETE FROM public.messages WHERE id = ANY(ids);
  END IF;

  RETURN NULL;
END;
$$;