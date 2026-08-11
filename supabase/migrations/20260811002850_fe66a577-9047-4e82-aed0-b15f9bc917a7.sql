CREATE OR REPLACE FUNCTION public.steal_guard_reason(_thief uuid, _victim uuid, OUT reason text, OUT link_reason text)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _pair int; _total int; _last timestamptz;
BEGIN
  reason := NULL;
  link_reason := public.steal_link_reason(_thief, _victim);

  IF link_reason IS NOT NULL THEN
    reason := 'linked_accounts';
    RETURN;
  END IF;

  -- Any real attempt on this victim (even cancelled/empty) starts the cooldown,
  -- so probing/harassment loops are impossible.
  SELECT max(created_at) INTO _last
  FROM public.steal_log
  WHERE thief_id = _thief AND victim_id = _victim
    AND result IN ('started', 'success', 'empty', 'cancelled');

  IF _last IS NOT NULL AND _last > now() - interval '2 hours' THEN
    reason := 'cooldown';
    RETURN;
  END IF;

  SELECT count(*) INTO _pair
  FROM public.steal_log
  WHERE thief_id = _thief AND victim_id = _victim
    AND result IN ('started', 'success')
    AND created_at > now() - interval '24 hours';

  IF COALESCE(_pair, 0) >= 3 THEN
    reason := 'pair_daily_limit';
    RETURN;
  END IF;

  SELECT count(*) INTO _total
  FROM public.steal_log
  WHERE thief_id = _thief
    AND result IN ('started', 'success')
    AND created_at > now() - interval '24 hours';

  IF COALESCE(_total, 0) >= 10 THEN
    reason := 'daily_limit';
    RETURN;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.steal_guard_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.steal_guard_reason(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._steal_log_settle(_thief uuid, _attacker_ship uuid, _qty bigint, _value bigint, _fish text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.steal_log
   WHERE thief_id = _thief AND attacker_ship_id = _attacker_ship AND result = 'started'
   ORDER BY created_at DESC LIMIT 1;

  IF _id IS NULL THEN RETURN; END IF;

  UPDATE public.steal_log
     SET result = CASE WHEN COALESCE(_qty, 0) > 0 THEN 'success'
                       WHEN COALESCE(_reason, '') ILIKE '%cancel%' THEN 'cancelled'
                       ELSE 'empty' END,
         quantity = COALESCE(_qty, 0),
         total_value = COALESCE(_value, 0),
         fish_id = _fish,
         meta = meta || jsonb_build_object('settle_reason', _reason)
   WHERE id = _id;
END;
$fn$;

REVOKE ALL ON FUNCTION public._steal_log_settle(uuid, uuid, bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._steal_log_settle(uuid, uuid, bigint, bigint, text, text) TO service_role;