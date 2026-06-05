
CREATE TABLE IF NOT EXISTS public.destroyer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defender_id uuid NOT NULL,
  attacker_id uuid NOT NULL,
  attacker_name text,
  kind text NOT NULL DEFAULT 'nuke',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_destroyer_messages_defender_created ON public.destroyer_messages (defender_id, created_at DESC);

GRANT SELECT ON public.destroyer_messages TO anon, authenticated;
GRANT ALL ON public.destroyer_messages TO service_role;

ALTER TABLE public.destroyer_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "destroyer_messages public read" ON public.destroyer_messages;
CREATE POLICY "destroyer_messages public read" ON public.destroyer_messages
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.broadcast_nuke(_target_id uuid, _message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _attacker uuid := auth.uid(); _msg text; _recent_nuke_count int; _attacker_name text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;
  _msg := btrim(coalesce(_message, ''));
  IF char_length(_msg) < 20 THEN RAISE EXCEPTION 'message must be at least 20 characters'; END IF;
  IF char_length(_msg) > 200 THEN _msg := substring(_msg, 1, 200); END IF;
  SELECT COUNT(*) INTO _recent_nuke_count FROM public.attacks
   WHERE attacker_id = _attacker AND defender_id = _target_id AND created_at > now() - interval '5 minutes';
  IF _recent_nuke_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;

  UPDATE public.profiles
    SET last_destroyer_message = _msg
  WHERE id = _target_id;

  INSERT INTO public.destroyer_messages (defender_id, attacker_id, attacker_name, kind, message)
  VALUES (_target_id, _attacker, _attacker_name, 'nuke', _msg);
END; $function$;

CREATE OR REPLACE FUNCTION public.get_destroyer_messages(_defender_id uuid)
RETURNS TABLE (
  id uuid,
  attacker_id uuid,
  attacker_name text,
  kind text,
  message text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id, attacker_id, attacker_name, kind, message, created_at
  FROM public.destroyer_messages
  WHERE defender_id = _defender_id
    AND created_at > now() - interval '48 hours'
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_destroyer_messages(uuid) TO anon, authenticated;
