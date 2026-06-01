CREATE OR REPLACE FUNCTION public.claim_vip_daily()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_level INTEGER;
  v_gems INTEGER;
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.effective_vip_level(v_user);
  IF v_level < 1 THEN RAISE EXCEPTION 'no_vip'; END IF;

  v_gems := CASE v_level
    WHEN 1 THEN 50    WHEN 2 THEN 100   WHEN 3 THEN 200   WHEN 4 THEN 350
    WHEN 5 THEN 550   WHEN 6 THEN 800   WHEN 7 THEN 1200  WHEN 8 THEN 1700
    WHEN 9 THEN 2300  WHEN 10 THEN 3000 ELSE 0 END;

  BEGIN
    INSERT INTO public.vip_daily_claims(user_id, claim_date, vip_level, gems_awarded)
    VALUES (v_user, v_today, v_level, v_gems);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_claimed_today';
  END;

  PERFORM public._mutate_currency(v_user, 0, v_gems, 0, 0);
  RETURN jsonb_build_object('ok', true, 'gems', v_gems, 'level', v_level);
END;
$function$;
