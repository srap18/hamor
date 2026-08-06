
-- 1) Immunity check: a player below ship-market 15 is ALWAYS immune.
CREATE OR REPLACE FUNCTION public.pvp_is_immune(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT (p.pvp_immunity_lifted_at IS NULL)
        OR (COALESCE(public.effective_market_level(p.id), 1) < 15)
    FROM public.profiles p WHERE p.id = _user_id
  ), true);
$function$;

-- 2) Only lift immunity for attackers who actually qualify (market 15+).
CREATE OR REPLACE FUNCTION public._pvp_lift_immunity_on_attack()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.attacker_id IS NOT NULL
     AND (COALESCE(NEW.damage_dealt, 0) > 0 OR COALESCE(NEW.attacker_won, false))
     AND COALESCE(public.effective_market_level(NEW.attacker_id), 1) >= 15 THEN
    UPDATE public.profiles
       SET pvp_immunity_lifted_at = now()
     WHERE id = NEW.attacker_id AND pvp_immunity_lifted_at IS NULL;
  END IF;
  RETURN NEW;
END $function$;

-- 3) Close the direct-insert hole on attacks (all writes go through SECURITY DEFINER RPCs).
DROP POLICY IF EXISTS atk_insert_attacker ON public.attacks;
REVOKE INSERT, UPDATE, DELETE ON public.attacks FROM authenticated, anon;
