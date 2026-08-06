-- Ranking-only zeroing for ship-market level <= 15

-- 1) Weekly XP leaderboard: exclude market level <= 15
CREATE OR REPLACE FUNCTION public.get_weekly_xp_leaderboard(_limit integer DEFAULT 100)
 RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, weekly_xp integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id,
         COALESCE(p.display_name, p.username, '—') AS display_name,
         p.avatar_emoji,
         p.avatar_url,
         p.level,
         p.weekly_xp
    FROM public.profiles p
    LEFT JOIN public.user_market um ON um.user_id = p.id
   WHERE p.weekly_xp > 0
     AND NOT public.is_admin(p.id)
     AND COALESCE(um.level, 1) >= 16
   ORDER BY p.weekly_xp DESC, p.level DESC
   LIMIT GREATEST(COALESCE(_limit, 100), 1)
$function$;

-- 2) Season damage: zero existing rows for market level <= 15
UPDATE public.season_damage sd
   SET damage_total = 0
  FROM public.user_market um
 WHERE um.user_id = sd.user_id
   AND COALESCE(um.level, 1) <= 15
   AND sd.damage_total > 0;

UPDATE public.season_damage sd
   SET damage_total = 0
 WHERE sd.damage_total > 0
   AND NOT EXISTS (SELECT 1 FROM public.user_market um WHERE um.user_id = sd.user_id);

-- 3) Keep them at zero going forward
CREATE OR REPLACE FUNCTION public._season_damage_market_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _lvl integer;
BEGIN
  SELECT COALESCE(level, 1) INTO _lvl FROM public.user_market WHERE user_id = NEW.user_id;
  IF COALESCE(_lvl, 1) <= 15 THEN
    NEW.damage_total := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS season_damage_market_gate ON public.season_damage;
CREATE TRIGGER season_damage_market_gate
BEFORE INSERT OR UPDATE ON public.season_damage
FOR EACH ROW EXECUTE FUNCTION public._season_damage_market_gate();