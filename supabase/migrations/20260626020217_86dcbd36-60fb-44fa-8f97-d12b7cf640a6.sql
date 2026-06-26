
-- 1) Stop counting bomb/nuke attacks toward arena points: neutralize the trigger
CREATE OR REPLACE FUNCTION public.trg_attack_arena_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Arena points are now awarded ONLY via dragon-vs-dragon battles
  -- through public.award_arena_score(). Other attacks (bombs/nukes) no longer score.
  RETURN NEW;
END $function$;

-- 2) Reset arena leaderboard
TRUNCATE TABLE public.arena_scores;

-- 3) Change paid attacks: 200 gems = pack of 5 attacks (not per-attack)
CREATE OR REPLACE FUNCTION public.arena_attack_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _d record;
  _used int; _packs int;
  _free_left int; _paid_left int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid;
  IF _d IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'free_left', 5, 'extra_bought', 0, 'paid_left', 0, 'next_cost', 200);
  END IF;
  IF _d.daily_arena_date IS DISTINCT FROM _today THEN
    _used := 0; _packs := 0;
  ELSE
    _used := COALESCE(_d.daily_arena_used, 0);
    _packs := COALESCE(_d.daily_arena_extra_bought, 0);
  END IF;
  _free_left := GREATEST(0, 5 - LEAST(_used, 5));
  _paid_left := GREATEST(0, _packs * 5 - GREATEST(0, _used - 5));
  RETURN jsonb_build_object(
    'ok', true,
    'free_left', _free_left,
    'extra_bought', _packs,
    'paid_left', _paid_left,
    'next_cost', CASE WHEN _free_left + _paid_left > 0 THEN 0 ELSE 200 END,
    'pack_size', 5
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.arena_attack_request()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _d record;
  _gems int;
  _free_left int;
  _paid_left int;
  _pack_cost int := 200;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid FOR UPDATE;
  IF _d IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_dragon'); END IF;

  IF _d.daily_arena_date IS DISTINCT FROM _today THEN
    UPDATE public.dragons
       SET daily_arena_date = _today,
           daily_arena_used = 0,
           daily_arena_extra_bought = 0
     WHERE user_id = _uid;
    _d.daily_arena_used := 0;
    _d.daily_arena_extra_bought := 0;
  END IF;

  _free_left := GREATEST(0, 5 - LEAST(COALESCE(_d.daily_arena_used,0), 5));
  _paid_left := GREATEST(0, COALESCE(_d.daily_arena_extra_bought,0) * 5
                            - GREATEST(0, COALESCE(_d.daily_arena_used,0) - 5));

  -- Free attack
  IF _free_left > 0 THEN
    UPDATE public.dragons SET daily_arena_used = daily_arena_used + 1, updated_at = now()
     WHERE user_id = _uid;
    RETURN jsonb_build_object('ok', true, 'kind', 'free',
      'free_left', _free_left - 1, 'paid_left', _paid_left);
  END IF;

  -- Already-paid attack from an existing pack
  IF _paid_left > 0 THEN
    UPDATE public.dragons SET daily_arena_used = daily_arena_used + 1, updated_at = now()
     WHERE user_id = _uid;
    RETURN jsonb_build_object('ok', true, 'kind', 'paid',
      'free_left', 0, 'paid_left', _paid_left - 1);
  END IF;

  -- Need to buy a new pack of 5 for 200 gems
  SELECT COALESCE(gems, 0) INTO _gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _gems < _pack_cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'need_gems',
                              'cost', _pack_cost, 'have', _gems);
  END IF;

  UPDATE public.profiles SET gems = gems - _pack_cost WHERE id = _uid;
  UPDATE public.dragons
     SET daily_arena_used = daily_arena_used + 1,
         daily_arena_extra_bought = daily_arena_extra_bought + 1,
         updated_at = now()
   WHERE user_id = _uid;

  RETURN jsonb_build_object('ok', true, 'kind', 'pack_buy',
    'free_left', 0, 'paid_left', 4, 'pack_size', 5, 'cost', _pack_cost);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.arena_attack_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.arena_attack_request() TO authenticated;
