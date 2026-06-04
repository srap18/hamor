ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_destroyer_message text;

CREATE OR REPLACE FUNCTION public.broadcast_nuke(_target_id uuid, _message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _attacker uuid := auth.uid(); _msg text; _recent_nuke_count int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;
  _msg := btrim(coalesce(_message, ''));
  IF char_length(_msg) < 20 THEN RAISE EXCEPTION 'message must be at least 20 characters'; END IF;
  IF char_length(_msg) > 200 THEN _msg := substring(_msg, 1, 200); END IF;
  SELECT COUNT(*) INTO _recent_nuke_count FROM public.attacks
   WHERE attacker_id = _attacker AND defender_id = _target_id AND created_at > now() - interval '5 minutes';
  IF _recent_nuke_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;
  UPDATE public.profiles
    SET last_destroyer_message = _msg
  WHERE id = _target_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.broadcast_nuke(uuid, text) TO authenticated;