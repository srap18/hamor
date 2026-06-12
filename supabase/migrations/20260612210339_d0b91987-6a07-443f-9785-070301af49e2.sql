CREATE OR REPLACE FUNCTION public.notify_steal_started(
  _target_user_id uuid,
  _attacker_user_id uuid,
  _attacker_name text,
  _attacker_emoji text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _name text := COALESCE(NULLIF(_attacker_name, ''), 'قرصان');
  _emoji text := COALESCE(NULLIF(_attacker_emoji, ''), '🏴‍☠️');
BEGIN
  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
  VALUES (
    _target_user_id,
    '🏴‍☠️ يحاول سرقتك!',
    _emoji || ' ' || _name || ' وصل محيطك وبدأ يسرق — ادخل وأوقفه',
    'attack',
    _attacker_user_id,
    jsonb_build_object('type', 'steal_started', 'attacker_id', _attacker_user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_steal_started(uuid, uuid, text, text) FROM PUBLIC;