
ALTER TABLE public.competition_catches ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'catch';

CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid, _force boolean DEFAULT false)
 RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _target_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _target_cat public.ship_catalog%ROWTYPE;
  _target_ship_id uuid;
  _target_user_id uuid;
  _start timestamptz;
  _duration numeric;
  _elapsed numeric;
  _ratio numeric := 1;
  _my_cap integer;
  _target_cap integer;
  _max integer;
  _market_remaining bigint;
  _scaled integer := 0;
  _pool jsonb;
  _pool_len integer;
  _chosen text;
  _unit_value bigint := 0;
  _summary jsonb := '[]'::jsonb;
  _grace_seconds constant numeric := 3;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id=_attacker_ship_id AND user_id=_me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF NOT _force AND (_ship.stealing_ends_at IS NULL OR _ship.stealing_ends_at > now()) THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT * INTO _target_ship FROM public.ships_owned WHERE id=_target_ship_id AND user_id=_target_user_id FOR UPDATE;

  _start := COALESCE(_ship.stealing_started_at, _ship.fishing_started_at, now());
  IF _force AND _ship.stealing_ends_at IS NOT NULL AND _ship.stealing_ends_at > now() THEN
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _start)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _start))) + _grace_seconds;
    _ratio := LEAST(1, GREATEST(0, _elapsed / _duration));
  ELSE
    _ratio := 1;
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code=_ship.catalog_code AND active=true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code=('ship-lvl-' || COALESCE(_ship.template_id,1)) AND active=true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
  END IF;

  IF _target_ship.id IS NOT NULL THEN
    IF _target_ship.catalog_code IS NOT NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code=_target_ship.catalog_code AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE code=('ship-lvl-' || COALESCE(_target_ship.template_id,1)) AND active=true LIMIT 1;
    END IF;
    IF _target_cat.id IS NULL THEN
      SELECT * INTO _target_cat FROM public.ship_catalog WHERE sort_order = COALESCE(_target_ship.template_id,1) AND active=true ORDER BY market_level_required ASC LIMIT 1;
    END IF;
  END IF;

  _my_cap := GREATEST(1, COALESCE(_cat.fishing_power, _cat.storage, 10));
  _target_cap := GREATEST(0, COALESCE(_target_cat.fishing_power, _target_cat.storage, 0));
  -- السرقة مقيدة بالأصغر بين سعة سفينة السارق وسعة سفينة الضحية
  IF _target_cap > 0 THEN
    _max := LEAST(_my_cap, _target_cap);
  ELSE
    _max := _my_cap;
  END IF;
  _market_remaining := public.user_market_remaining(_me);

  _scaled := FLOOR(_max * _ratio)::int;
  IF _ratio > 0 AND _scaled < 1 THEN _scaled := 1; END IF;
  _scaled := LEAST(GREATEST(0,_scaled)::bigint, _market_remaining)::int;

  IF _scaled > 0 AND _target_ship.id IS NOT NULL THEN
    _pool := COALESCE(_target_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);

    IF _pool_len > 0 THEN
      IF _target_ship.preferred_fish_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _target_ship.preferred_fish_id) THEN
        _chosen := _target_ship.preferred_fish_id;
      ELSE
        SELECT p.value INTO _chosen
        FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
        WHERE p.ord = (1 + (abs(hashtextextended(_attacker_ship_id::text || ':' || _start::text, 91003)) % _pool_len))
        LIMIT 1;
      END IF;

      SELECT COALESCE(current_price,0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id=_chosen;
      IF _unit_value IS NULL THEN _unit_value := 0; END IF;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_me, _chosen, _attacker_ship_id, now(), _unit_value, _scaled);
      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at)
      VALUES (_me, _chosen, _scaled, _scaled, now())
      ON CONFLICT (user_id, fish_id) DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
          updated_at = now();
      -- ملاحظة: لم تعد السرقة تُحتسب في فعاليات الصيد

      _summary := jsonb_build_array(jsonb_build_object('fish_id', _chosen, 'value', _unit_value, 'qty', _scaled));
    ELSE
      _scaled := 0;
    END IF;
  ELSE
    _scaled := 0;
  END IF;

  UPDATE public.ships_owned
     SET at_sea=false, fishing_started_at=NULL,
         stealing_target_user_id=NULL, stealing_target_ship_id=NULL,
         stealing_ends_at=NULL, stealing_started_at=NULL
   WHERE id=_attacker_ship_id;

  RETURN QUERY SELECT _scaled, (_scaled::bigint * _unit_value), _summary;
END;
$function$;
