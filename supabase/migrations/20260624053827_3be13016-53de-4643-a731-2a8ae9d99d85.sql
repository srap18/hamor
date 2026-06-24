
-- 1) Server-side dragon overall level (mirrors client overallLevel logic for stage 1/2 gate)
CREATE OR REPLACE FUNCTION public.dragon_is_hatched(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (stage >= 2) OR (stage = 1 AND dp >= 10000)
       FROM public.dragons WHERE user_id = _user),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.dragon_is_hatched(uuid) TO authenticated, service_role;

-- 2) Gate the attack->arena_score trigger
CREATE OR REPLACE FUNCTION public.trg_attack_arena_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ws date;
  _mult numeric := 1;
  _active boolean := false;
  _ends timestamptz;
  _pts bigint;
BEGIN
  -- STRICT GATE: attacker must have a hatched dragon
  IF NOT public.dragon_is_hatched(NEW.attacker_id) THEN
    RETURN NEW;
  END IF;

  _ws := (date_trunc('week', (now() AT TIME ZONE 'UTC'))::date);
  SELECT event_active, event_multiplier, event_ends_at
    INTO _active, _mult, _ends
    FROM public.arena_settings LIMIT 1;
  IF _active IS TRUE AND (_ends IS NULL OR _ends > now()) THEN
    _mult := COALESCE(_mult, 1);
  ELSE
    _mult := 1;
  END IF;
  _pts := GREATEST(0, FLOOR(COALESCE(NEW.damage_dealt, 0)::numeric * _mult))::bigint;
  IF _pts <= 0 AND NEW.attacker_won IS NOT TRUE THEN RETURN NEW; END IF;
  INSERT INTO public.arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (NEW.attacker_id, _ws, _pts, CASE WHEN NEW.attacker_won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE
    SET score = arena_scores.score + EXCLUDED.score,
        wins  = arena_scores.wins  + EXCLUDED.wins,
        updated_at = now();
  RETURN NEW;
END $function$;

-- 3) Gate the RPC award_arena_score as well
CREATE OR REPLACE FUNCTION public.award_arena_score(p_score bigint, p_won boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
  v_capped bigint;
  v_settings public.arena_settings%ROWTYPE;
  v_mult numeric := 1;
BEGIN
  IF v_user IS NULL OR p_score <= 0 THEN RETURN; END IF;

  -- STRICT GATE: must have hatched dragon
  IF NOT public.dragon_is_hatched(v_user) THEN RETURN; END IF;

  SELECT * INTO v_settings FROM public.arena_settings WHERE id = true;
  IF v_settings.id IS NOT NULL AND v_settings.enabled = false THEN
    RETURN;
  END IF;

  IF v_settings.event_active
     AND (v_settings.event_ends_at IS NULL OR v_settings.event_ends_at > now()) THEN
    v_mult := COALESCE(v_settings.event_multiplier, 1);
  END IF;

  v_capped := LEAST(p_score, 5000);
  v_capped := GREATEST(1, (v_capped * v_mult)::bigint);

  INSERT INTO arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (v_user, v_week, v_capped, CASE WHEN p_won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    score = arena_scores.score + EXCLUDED.score,
    wins  = arena_scores.wins  + EXCLUDED.wins,
    updated_at = now();
END $function$;

-- 4) Reset arena scores again (defensive)
TRUNCATE TABLE public.arena_scores;
