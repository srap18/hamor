-- 1) Symmetric bracket enforcement --------------------------------------
CREATE OR REPLACE FUNCTION public.pvp_level_gap_error(_attacker uuid, _defender uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE _a int; _d int;
BEGIN
  IF _attacker IS NULL OR _defender IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_attacker) THEN RETURN NULL; END IF;

  -- Ongoing engagement: the defender may always retaliate.
  IF public.pvp_engaged(_attacker, _defender) THEN RETURN NULL; END IF;

  -- Attacker must first meet the basic fleet requirement.
  IF public.pvp_attack_bracket(_attacker) = 0 THEN
    RETURN public.pvp_attacker_requirement_error(_attacker);
  END IF;

  -- Category is owned-ships based for BOTH sides so the rule is symmetric
  -- and cannot be dodged by storing / docking high level ships.
  _a := public.pvp_defense_bracket(_attacker);
  _d := public.pvp_defense_bracket(_defender);

  IF _a = _d THEN RETURN NULL; END IF;

  IF _a = 1 THEN
    RETURN '🛡️ هذا اللاعب من فئة المستوى 16+ ولا يمكنك مهاجمته.' || E'\n'
        || 'فئتك الحالية: سفن المستوى 6 – 15.' || E'\n'
        || 'للانتقال إلى الفئة المتقدمة تحتاج 3 سفن مستوى 16 أو أعلى مبحرة وتصيد.';
  END IF;

  RETURN '🛡️ هذا اللاعب من فئة المستوى 6 – 15 ولا يمكنك مهاجمته.' || E'\n'
      || 'فئتك الحالية: سفن المستوى 16 فأعلى.' || E'\n'
      || 'لاعبو الفئة المتقدمة يهاجمون فئتهم فقط.';
END
$$;

-- keep the client check consistent with the server rule
CREATE OR REPLACE FUNCTION public.pvp_attack_check(_defender uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _err text;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not authenticated'); END IF;
  IF _defender IS NULL OR _defender = _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid defender'); END IF;

  _err := public.pvp_attacker_requirement_error(_uid);
  IF _err IS NULL THEN _err := public.pvp_defender_requirement_error(_defender); END IF;
  IF _err IS NULL THEN _err := public.pvp_level_gap_error(_uid, _defender); END IF;

  RETURN jsonb_build_object(
    'ok', _err IS NULL,
    'reason', _err,
    'my_bracket', public.pvp_defense_bracket(_uid),
    'target_bracket', public.pvp_defense_bracket(_defender),
    'eligible_ships', public.pvp_eligible_ship_count(_uid, 6),
    'eligible_ships_16', public.pvp_eligible_ship_count(_uid, 16)
  );
END
$$;

-- 2) Automatic regeneration for damaged (not destroyed) ships -------------
ALTER TABLE public.ships_owned
  ADD COLUMN IF NOT EXISTS last_damaged_at timestamptz;

CREATE OR REPLACE FUNCTION public._trg_stamp_ship_damage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hp < OLD.hp THEN
    NEW.last_damaged_at := now();
  ELSIF NEW.hp >= COALESCE(NEW.max_hp, 100) THEN
    NEW.last_damaged_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_stamp_ship_damage ON public.ships_owned;
CREATE TRIGGER trg_stamp_ship_damage
BEFORE UPDATE OF hp ON public.ships_owned
FOR EACH ROW EXECUTE FUNCTION public._trg_stamp_ship_damage();

-- backfill so currently damaged ships start regenerating now
UPDATE public.ships_owned
   SET last_damaged_at = now()
 WHERE destroyed_at IS NULL
   AND last_damaged_at IS NULL
   AND hp < max_hp;

CREATE OR REPLACE FUNCTION public.regen_damaged_ships(_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user IS NULL THEN RETURN; END IF;

  UPDATE public.ships_owned AS so
     SET hp = LEAST(
                COALESCE(so.max_hp, 100),
                COALESCE(so.hp, 0)
                + FLOOR(
                    COALESCE(so.max_hp, 100)::numeric
                    * EXTRACT(EPOCH FROM (now() - so.last_damaged_at))::numeric
                    / NULLIF(public._ship_repair_seconds(so.template_id), 0)::numeric
                  )::integer
              ),
         last_damaged_at = now()
   WHERE so.user_id = _user
     AND so.destroyed_at IS NULL
     AND so.last_damaged_at IS NOT NULL
     AND so.hp < so.max_hp
     AND FLOOR(
           COALESCE(so.max_hp, 100)::numeric
           * EXTRACT(EPOCH FROM (now() - so.last_damaged_at))::numeric
           / NULLIF(public._ship_repair_seconds(so.template_id), 0)::numeric
         )::integer >= 1;
END
$$;

GRANT EXECUTE ON FUNCTION public.regen_damaged_ships(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_ship_repairs(_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user IS NULL THEN
    RETURN;
  END IF;

  -- 1) Rescue: any destroyed ship missing a repair timer -> assign one based on level.
  UPDATE public.ships_owned AS so
     SET repair_ends_at = so.destroyed_at
       + make_interval(secs =>
           ROUND(60 + (LEAST(30, GREATEST(1, COALESCE(so.template_id, 1))) - 1)
                      * (14400 - 60) / 29.0)::int)
   WHERE so.user_id = _user
     AND so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NULL;

  -- 2) Fully restore every ship whose repair timer has ended.
  UPDATE public.ships_owned
     SET hp = COALESCE(max_hp, 100),
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE user_id = _user
     AND repair_ends_at IS NOT NULL
     AND repair_ends_at <= now();

  -- 3) Gradually heal still-repairing destroyed ships.
  UPDATE public.ships_owned AS so
     SET hp = LEAST(
                COALESCE(so.max_hp, 100),
                GREATEST(
                  COALESCE(so.hp, 0),
                  FLOOR(
                    COALESCE(so.max_hp, 100)::numeric
                    * EXTRACT(EPOCH FROM (now() - so.destroyed_at))::numeric
                    / NULLIF(EXTRACT(EPOCH FROM (so.repair_ends_at - so.destroyed_at))::numeric, 0)
                  )::integer
                )
              )
   WHERE so.user_id = _user
     AND so.destroyed_at IS NOT NULL
     AND so.repair_ends_at IS NOT NULL
     AND so.repair_ends_at > now();

  -- 4) Regenerate damaged-but-alive ships automatically.
  PERFORM public.regen_damaged_ships(_user);
END
$$;
