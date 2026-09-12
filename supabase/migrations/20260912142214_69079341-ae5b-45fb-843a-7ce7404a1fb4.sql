CREATE OR REPLACE FUNCTION public.refund_ban_user(_txn_id text, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_pack text;
  v_gems integer;
  v_coins bigint;
  v_rubies integer;
  v_device_count int := 0;
BEGIN
  -- Trusted internal sanction: allow the ban insert even when there is no
  -- admin session (webhook / cron sweep run unauthenticated).
  PERFORM set_config('app.allow_auto_sanction', 'true', true);

  SELECT user_id, pack_id, granted_gems, granted_coins, granted_rubies
    INTO v_user, v_pack, v_gems, v_coins, v_rubies
  FROM public.paddle_purchases
  WHERE paddle_transaction_id = _txn_id
  FOR UPDATE;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'txn_not_found');
  END IF;

  UPDATE public.paddle_purchases
     SET status = 'refunded',
         granted = false,
         refund_banned_at = now()
   WHERE paddle_transaction_id = _txn_id;

  UPDATE public.profiles
     SET gems   = gems   - coalesce(v_gems,0),
         coins  = coins  - coalesce(v_coins,0),
         rubies = rubies - coalesce(v_rubies,0),
         purchases_blocked = true,
         elite_vip_level = 0,
         elite_vip_expires_at = NULL,
         vip_expires_at = LEAST(coalesce(vip_expires_at, now()), now()),
         protection_until = LEAST(coalesce(protection_until, now()), now())
   WHERE id = v_user;

  UPDATE public.bans SET active = false WHERE user_id = v_user AND active = true;
  INSERT INTO public.bans (user_id, reason, active, expires_at)
  VALUES (v_user, 'REFUND/CHARGEBACK: ' || coalesce(_reason,''), true, NULL);

  INSERT INTO public.banned_devices (device_id, user_id, reason)
  SELECT da.device_id, v_user, 'refund_ban:' || _txn_id
    FROM public.device_accounts da
   WHERE da.user_id = v_user
  ON CONFLICT (device_id) DO NOTHING;
  GET DIAGNOSTICS v_device_count = ROW_COUNT;

  BEGIN
    INSERT INTO public.economy_audit (user_id, reason, ref, gems_delta, coins_delta, rubies_delta, meta)
    VALUES (
      v_user, 'refund_ban', _txn_id,
      -coalesce(v_gems,0), -coalesce(v_coins,0), -coalesce(v_rubies,0),
      jsonb_build_object('pack_id', v_pack, 'devices_banned', v_device_count, 'policy', 'no_refunds')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user,
    'gems_revoked', v_gems,
    'devices_banned', v_device_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.paddle_refund_sweep_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
BEGIN
  SELECT apikey INTO cfg FROM public.play_sync_config WHERE id = 1;
  IF cfg.apikey IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://project--fc1f387e-db92-4515-a5c6-90044e4e7b7a.lovable.app/api/public/hooks/paddle-refund-sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', cfg.apikey),
    body := '{}'::jsonb
  );
END;
$function$;

SELECT cron.schedule('paddle-refund-sweep-hourly', '20 * * * *', $$SELECT public.paddle_refund_sweep_tick();$$);