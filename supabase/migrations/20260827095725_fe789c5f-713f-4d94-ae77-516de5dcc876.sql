
CREATE TABLE public.fleet_combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  fish_id text NOT NULL,
  qty integer NOT NULL DEFAULT 5,
  chance_pct integer NOT NULL DEFAULT 100,
  cooldown_minutes integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fleet_combos TO authenticated;
GRANT ALL ON public.fleet_combos TO service_role;
ALTER TABLE public.fleet_combos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "combos readable" ON public.fleet_combos FOR SELECT TO authenticated USING (true);
CREATE POLICY "combos admin write" ON public.fleet_combos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fleet_combo_ships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id uuid NOT NULL REFERENCES public.fleet_combos(id) ON DELETE CASCADE,
  catalog_code text NOT NULL,
  slot smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (combo_id, slot)
);
GRANT SELECT ON public.fleet_combo_ships TO authenticated;
GRANT ALL ON public.fleet_combo_ships TO service_role;
ALTER TABLE public.fleet_combo_ships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "combo ships readable" ON public.fleet_combo_ships FOR SELECT TO authenticated USING (true);
CREATE POLICY "combo ships admin write" ON public.fleet_combo_ships FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fleet_combo_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id uuid NOT NULL REFERENCES public.fleet_combos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  fish_id text NOT NULL,
  qty integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fleet_combo_claims_user_idx ON public.fleet_combo_claims(user_id, combo_id, created_at DESC);
GRANT SELECT ON public.fleet_combo_claims TO authenticated;
GRANT ALL ON public.fleet_combo_claims TO service_role;
ALTER TABLE public.fleet_combo_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claims own read" ON public.fleet_combo_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER fleet_combos_updated_at BEFORE UPDATE ON public.fleet_combos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Active combos for the current player (3 required ships all at sea right now)
CREATE OR REPLACE FUNCTION public.my_active_fleet_combos()
RETURNS TABLE(combo_id uuid, name text, fish_id text, qty integer, chance_pct integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.fish_id, c.qty, c.chance_pct
  FROM public.fleet_combos c
  WHERE c.active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.fleet_combo_ships s
      WHERE s.combo_id = c.id
        AND NOT EXISTS (
          SELECT 1 FROM public.ships_owned so
          WHERE so.user_id = auth.uid()
            AND so.fishing_started_at IS NOT NULL
            AND COALESCE(so.catalog_code, 'ship-lvl-' || COALESCE(so.template_id, 0)) = s.catalog_code
        )
    )
    AND EXISTS (SELECT 1 FROM public.fleet_combo_ships s2 WHERE s2.combo_id = c.id);
$$;
GRANT EXECUTE ON FUNCTION public.my_active_fleet_combos() TO authenticated;

-- Award combo fish at harvest time (called from collect_fishing_reward)
CREATE OR REPLACE FUNCTION public._award_fleet_combo(_uid uuid, _ship_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c record; _unit bigint; _remaining bigint; _give integer;
BEGIN
  FOR _c IN
    SELECT c.* FROM public.fleet_combos c
    WHERE c.active = true
      AND EXISTS (SELECT 1 FROM public.fleet_combo_ships s2 WHERE s2.combo_id = c.id)
      -- this ship must be part of the recipe
      AND EXISTS (
        SELECT 1 FROM public.fleet_combo_ships s3
        JOIN public.ships_owned so ON so.id = _ship_id
        WHERE s3.combo_id = c.id
          AND COALESCE(so.catalog_code, 'ship-lvl-' || COALESCE(so.template_id, 0)) = s3.catalog_code
      )
      -- every required ship must be at sea fishing
      AND NOT EXISTS (
        SELECT 1 FROM public.fleet_combo_ships s
        WHERE s.combo_id = c.id
          AND NOT EXISTS (
            SELECT 1 FROM public.ships_owned so2
            WHERE so2.user_id = _uid
              AND (so2.fishing_started_at IS NOT NULL OR so2.id = _ship_id)
              AND COALESCE(so2.catalog_code, 'ship-lvl-' || COALESCE(so2.template_id, 0)) = s.catalog_code
          )
      )
      -- cooldown
      AND NOT EXISTS (
        SELECT 1 FROM public.fleet_combo_claims cl
        WHERE cl.combo_id = c.id AND cl.user_id = _uid
          AND cl.created_at > now() - make_interval(mins => GREATEST(0, c.cooldown_minutes))
          AND c.cooldown_minutes > 0
      )
  LOOP
    IF (random() * 100) > GREATEST(0, LEAST(100, _c.chance_pct)) THEN CONTINUE; END IF;

    _remaining := public.user_market_remaining(_uid);
    IF _remaining <= 0 THEN RETURN; END IF;
    _give := LEAST(GREATEST(1, _c.qty)::bigint, _remaining)::int;

    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _c.fish_id, _give, _give)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key
    DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
                  total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
                  updated_at = now();

    SELECT COALESCE(current_price, 0)::bigint INTO _unit
      FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _c.fish_id LIMIT 1;

    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_uid, _c.fish_id, _ship_id, now(), COALESCE(_unit, 0), _give);

    INSERT INTO public.fleet_combo_claims(combo_id, user_id, fish_id, qty)
    VALUES (_c.id, _uid, _c.fish_id, _give);
  END LOOP;
END
$$;
REVOKE EXECUTE ON FUNCTION public._award_fleet_combo(uuid, uuid) FROM public, anon, authenticated;
