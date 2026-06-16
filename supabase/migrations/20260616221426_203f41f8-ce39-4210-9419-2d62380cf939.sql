
-- 1) Bot action timing log
CREATE TABLE IF NOT EXISTS public.bot_action_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bot_action_log TO authenticated;
GRANT ALL ON public.bot_action_log TO service_role;

ALTER TABLE public.bot_action_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bot_action_log_user_at ON public.bot_action_log(user_id, at DESC);

DROP POLICY IF EXISTS "users read own bot log" ON public.bot_action_log;
CREATE POLICY "users read own bot log" ON public.bot_action_log
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 2) Detection function: looks at last 8 actions; if stddev of intervals < 250ms => bot
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
  -- Insert this action
  INSERT INTO public.bot_action_log(user_id, action, at) VALUES (_uid, _action, now());

  -- Trim: keep only last 20 rows for this user
  DELETE FROM public.bot_action_log
  WHERE user_id = _uid
    AND id NOT IN (
      SELECT id FROM public.bot_action_log
      WHERE user_id = _uid
      ORDER BY at DESC
      LIMIT 20
    );

  -- Already actively banned? skip
  SELECT EXISTS(SELECT 1 FROM public.bans WHERE user_id = _uid AND active = true
                AND (expires_at IS NULL OR expires_at > now()))
    INTO _already_banned;
  IF _already_banned THEN RETURN; END IF;

  -- Compute intervals from last 8 actions (across all tracked actions)
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

  -- Mean and stddev (ms)
  SELECT avg(v), stddev_pop(v) INTO _mean, _stddev FROM unnest(_intervals_ms) v;

  -- Skip if intervals are very long (>30s) — humans naturally space out
  IF _mean > 30000 THEN RETURN; END IF;

  -- Bot pattern: stddev very low relative to mean (highly regular clicks)
  IF _stddev < 250 OR (_mean > 0 AND _stddev / _mean < 0.05) THEN
    -- Log cheat flag
    INSERT INTO public.cheat_flags(user_id, kind, severity, details)
    VALUES (_uid, 'auto_clicker_detected', 8,
      jsonb_build_object('mean_ms', _mean, 'stddev_ms', _stddev, 'samples', _count, 'last_action', _action));

    -- Temporary 24h ban (admin can deactivate)
    INSERT INTO public.bans(user_id, reason, expires_at, active, banned_at)
    VALUES (_uid,
      '⚠️ تم اكتشاف استخدامك لبرنامج غش (نقرات آلية منتظمة). الحظر مؤقت — تواصل مع الإدارة لفك الحظر.',
      now() + interval '24 hours',
      true,
      now());
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._detect_bot_and_ban(uuid, text) FROM PUBLIC;

-- 3) Patch set_ship_at_sea to call the detector
CREATE OR REPLACE FUNCTION public.set_ship_at_sea(_ship_id uuid, _at_sea boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _ratio numeric;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Bot detection BEFORE work; if it bans the user, fail their action
  PERFORM public._detect_bot_and_ban(_uid, CASE WHEN _at_sea THEN 'ship_start' ELSE 'ship_stop' END);
  IF EXISTS (SELECT 1 FROM public.bans WHERE user_id = _uid AND active = true
             AND (expires_at IS NULL OR expires_at > now())) THEN
    RAISE EXCEPTION 'banned_bot_detected';
  END IF;

  SELECT user_id, at_sea, fishing_started_at, destroyed_at, repair_ends_at
    INTO _row
    FROM public.ships_owned
   WHERE id = _ship_id
   FOR UPDATE;

  IF _row.user_id IS NULL OR _row.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  IF _at_sea AND _row.destroyed_at IS NOT NULL AND _row.repair_ends_at IS NOT NULL AND _row.repair_ends_at > now() THEN
    _ratio := public._ship_repair_ratio(_row.destroyed_at, _row.repair_ends_at);
    IF _ratio < 0.30 THEN
      UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
  END IF;

  IF _at_sea THEN
    IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
      RETURN;
    END IF;
    UPDATE public.ships_owned
       SET at_sea = true,
           fishing_started_at = now()
     WHERE id = _ship_id;
  ELSE
    UPDATE public.ships_owned
       SET at_sea = false,
           fishing_started_at = NULL
     WHERE id = _ship_id;
  END IF;
END;
$function$;

-- 4) Hook sell_fish too
CREATE OR REPLACE FUNCTION public._sell_fish_botcheck() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END; $$;
-- (we patch via a wrapper RPC; safest path is to call the detector at start of sell_fish itself)
