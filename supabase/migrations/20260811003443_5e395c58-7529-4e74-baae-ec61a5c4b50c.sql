CREATE OR REPLACE FUNCTION public.steal_release_stale(_user uuid DEFAULT NULL, _older_than interval DEFAULT interval '24 hours')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  UPDATE public.ships_owned
     SET stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_started_at = NULL,
         stealing_ends_at = NULL
   WHERE stealing_ends_at IS NOT NULL
     AND stealing_ends_at < now() - _older_than
     AND (_user IS NULL OR user_id = _user);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.steal_release_stale(uuid, interval) FROM PUBLIC, anon, authenticated;

-- mark abandoned log rows so they never linger as "started"
UPDATE public.steal_log
   SET result = 'expired'
 WHERE result = 'started'
   AND created_at < now() - interval '24 hours';

SELECT public.steal_release_stale(NULL, interval '6 hours');

CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS TABLE(ends_at timestamptz, reject_reason text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _blocked timestamptz;
  _g record;
  _msg text;
  _ends timestamptz;
  _resume boolean := false;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT steal_blocked_until INTO _blocked FROM public.profiles WHERE id = _me;
  IF _blocked IS NOT NULL AND _blocked > now() THEN
    RAISE EXCEPTION 'blocked from stealing until %', _blocked;
  END IF;

  -- free any of my own ships stuck in a long-abandoned mission
  PERFORM public.steal_release_stale(_me, interval '24 hours');

  IF public.ship_has_police(_target_user_id, _target_ship_id) THEN
    RAISE EXCEPTION 'هذه السفينة محمية بواسطة الشرطي ولا يمكن سرقتها.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('steal_guard:' || _me::text, 0));

  SELECT true INTO _resume
  FROM public.ships_owned
  WHERE id = _attacker_ship_id AND user_id = _me
    AND stealing_ends_at IS NOT NULL AND stealing_ends_at > now()
    AND stealing_target_user_id = _target_user_id
    AND stealing_target_ship_id = _target_ship_id;

  IF NOT COALESCE(_resume, false) AND NOT public.is_admin(_me) THEN
    SELECT * INTO _g FROM public.steal_guard_reason(_me, _target_user_id);

    IF _g.reason IS NOT NULL THEN
      PERFORM public._steal_log_write(_me, _target_user_id, _attacker_ship_id, _target_ship_id,
        'rejected', _g.reason, _g.link_reason, '{}'::jsonb);

      _msg := CASE _g.reason
        WHEN 'linked_accounts' THEN 'ممنوع: هذا الحساب مرتبط بحسابك، لا يمكن السرقة بينكما.'
        WHEN 'cooldown' THEN 'يجب الانتظار ساعتين بين كل سرقة من نفس اللاعب.'
        WHEN 'pair_daily_limit' THEN 'وصلت للحد الأقصى: 3 سرقات من نفس اللاعب خلال 24 ساعة.'
        WHEN 'daily_limit' THEN 'وصلت للحد اليومي: 10 سرقات ناجحة خلال 24 ساعة.'
        ELSE 'السرقة غير مسموحة حاليًا.'
      END;

      RETURN QUERY SELECT NULL::timestamptz, _g.reason, _msg;
      RETURN;
    END IF;
  END IF;

  SELECT s.ends_at INTO _ends
  FROM public.start_steal_mission_impl(_attacker_ship_id, _target_user_id, _target_ship_id) s;

  IF NOT COALESCE(_resume, false) THEN
    PERFORM public._steal_log_write(_me, _target_user_id, _attacker_ship_id, _target_ship_id,
      'started', NULL, NULL, jsonb_build_object('ends_at', _ends));
  END IF;

  RETURN QUERY SELECT _ends, NULL::text, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated, service_role;