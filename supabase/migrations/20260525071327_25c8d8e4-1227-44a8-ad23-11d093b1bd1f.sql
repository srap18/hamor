
-- Allow players to broadcast a global message after detonating a nuke
CREATE OR REPLACE FUNCTION public.broadcast_nuke(_target_id uuid, _message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _attacker_name text;
  _target_name text;
  _msg text;
  _nid uuid;
  _recent_nuke_count int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;

  _msg := btrim(coalesce(_message, ''));
  IF char_length(_msg) < 20 THEN RAISE EXCEPTION 'message must be at least 20 characters'; END IF;
  IF char_length(_msg) > 200 THEN _msg := substring(_msg, 1, 200); END IF;

  -- Require a recent attack record (last 5 minutes) to prove the player actually attacked
  SELECT COUNT(*) INTO _recent_nuke_count
    FROM public.attacks
   WHERE attacker_id = _attacker
     AND defender_id = _target_id
     AND created_at > now() - interval '5 minutes';
  IF _recent_nuke_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (
    NULL,
    '☢️ ' || coalesce(_attacker_name, 'لاعب') || ' فجّر ' || coalesce(_target_name, 'لاعب') || ' بقنبلة ذرية!',
    _msg,
    'nuke',
    _attacker
  ) RETURNING id INTO _nid;

  RETURN _nid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.broadcast_nuke(uuid, text) TO authenticated;
