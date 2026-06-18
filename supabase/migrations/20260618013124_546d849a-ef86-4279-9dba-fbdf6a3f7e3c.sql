CREATE OR REPLACE FUNCTION public._detect_bot_and_ban(_uid uuid, _action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _intervals_ms numeric[];
  _stddev numeric;
  _mean numeric;
  _count int;
  _already_banned boolean;
BEGIN
  INSERT INTO public.bot_action_log(user_id, action, at) VALUES (_uid, _action, now());

  DELETE FROM public.bot_action_log
  WHERE user_id = _uid
    AND id NOT IN (
      SELECT id FROM public.bot_action_log
      WHERE user_id = _uid
      ORDER BY at DESC
      LIMIT 20
    );

  SELECT EXISTS(SELECT 1 FROM public.bans WHERE user_id = _uid AND active = true
                AND (expires_at IS NULL OR expires_at > now()))
    INTO _already_banned;
  IF _already_banned THEN RETURN; END IF;

  WITH last8 AS (
    SELECT at FROM public.bot_action_log
    WHERE user_id = _uid
    ORDER BY at DESC
    LIMIT 8
  ),
  ordered AS (
    SELECT at, LAG(at) OVER (ORDER BY at) AS prev_at FROM last8
  )
  SELECT array_agg(EXTRACT(EPOCH FROM (at - prev_at)) * 1000.0)
    INTO _intervals_ms
   FROM ordered
   WHERE prev_at IS NOT NULL;

  _count := COALESCE(array_length(_intervals_ms, 1), 0);
  IF _count < 7 THEN RETURN; END IF;

  SELECT avg(v), stddev_pop(v) INTO _mean, _stddev FROM unnest(_intervals_ms) v;

  -- Skip if intervals are very long (>30s) — humans naturally space out
  IF _mean > 30000 THEN RETURN; END IF;

  -- Tightened bot pattern:
  --  - very low absolute jitter (<400ms), OR
  --  - mean under 5s with low coefficient of variation (<0.20) — bot with small jitter
  IF _stddev < 400 OR (_mean > 0 AND _mean < 5000 AND _stddev / _mean < 0.20) THEN
    INSERT INTO public.cheat_flags(user_id, kind, severity, details)
    VALUES (_uid, 'auto_clicker_detected', 8,
      jsonb_build_object('mean_ms', _mean, 'stddev_ms', _stddev, 'samples', _count, 'last_action', _action));

    INSERT INTO public.bans(user_id, reason, expires_at, active, banned_at)
    VALUES (_uid,
      '⚠️ تم اكتشاف استخدامك لبرنامج غش (نقرات آلية منتظمة). الحظر مؤقت — تواصل مع الإدارة لفك الحظر.',
      now() + interval '24 hours',
      true,
      now());
  END IF;
END;
$$;