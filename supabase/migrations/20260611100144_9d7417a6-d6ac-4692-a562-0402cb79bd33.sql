-- 1) Weapons catalog (server source of truth)
CREATE TABLE IF NOT EXISTS public.weapons_catalog (
  id text PRIMARY KEY,
  damage integer NOT NULL CHECK (damage >= 0),
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  aoe boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.weapons_catalog TO authenticated;
GRANT SELECT ON public.weapons_catalog TO anon;
GRANT ALL ON public.weapons_catalog TO service_role;

ALTER TABLE public.weapons_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read weapons catalog"
  ON public.weapons_catalog FOR SELECT
  USING (true);

CREATE POLICY "Only service role can modify weapons"
  ON public.weapons_catalog FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Seed canonical weapon data (matches src/lib/weapons.ts).
INSERT INTO public.weapons_catalog (id, damage, xp, aoe) VALUES
  ('rocket_small',   800,    0, false),
  ('rocket_medium',  4000,   0, false),
  ('rocket_large',   18000,  50, false),
  ('nuke',           70000, 250, true),
  ('ad_bomb',        70000, 500, true)
ON CONFLICT (id) DO UPDATE SET
  damage = EXCLUDED.damage,
  xp = EXCLUDED.xp,
  aoe = EXCLUDED.aoe,
  updated_at = now();

-- 2) Unified VIP verification RPC
CREATE OR REPLACE FUNCTION public.verify_and_get_vip_status(_user_id uuid)
RETURNS TABLE(is_vip boolean, elite_level smallint, combat_multiplier numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lvl smallint;
  _mult numeric;
BEGIN
  _lvl := public.get_elite_vip_level(_user_id);
  _mult := public.get_combat_multiplier(_user_id);
  RETURN QUERY SELECT (_lvl > 0)::boolean AS is_vip, _lvl AS elite_level, _mult AS combat_multiplier;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_and_get_vip_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_get_vip_status(uuid) TO service_role;

-- 3) Secure v2 apply_ship_damage — computes damage server-side from weapon catalog.
-- Client passes _weapon_id (cannot be forged into more damage than the catalog allows).
CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(
  _ship_id uuid,
  _weapon_id text,
  _skip_fishing_check boolean DEFAULT false
)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamptz, damage_applied integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _base_damage integer;
  _mult numeric;
  _final_damage integer;
  _result record;
BEGIN
  IF _attacker IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Look up trusted weapon damage from the server catalog
  SELECT damage INTO _base_damage
  FROM public.weapons_catalog
  WHERE id = _weapon_id;

  IF _base_damage IS NULL THEN
    RAISE EXCEPTION 'Unknown weapon: %', _weapon_id;
  END IF;

  -- Apply attacker's VIP combat multiplier (server-derived)
  _mult := public.get_combat_multiplier(_attacker);
  _final_damage := GREATEST(0, FLOOR(_base_damage * _mult))::integer;

  -- Delegate to the existing battle-tested apply_ship_damage which enforces
  -- protection, fleet ownership, and fishing-state checks.
  SELECT * INTO _result
  FROM public.apply_ship_damage(_ship_id, _final_damage, _skip_fishing_check);

  RETURN QUERY SELECT _result.new_hp, _result.destroyed, _result.repair_ends_at, _final_damage;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_ship_damage_v2(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ship_damage_v2(uuid, text, boolean) TO service_role;