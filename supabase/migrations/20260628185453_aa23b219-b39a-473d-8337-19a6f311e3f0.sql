-- Boost anti-counter block percentages with dragon level.
-- Base: anti_rocket 60%, anti_nuke 75%, anti_ad_bomb 70%.
-- Bonus: +floor(dragon_level / 5)% (up to +30 at level 150), capped overall at 90%.
CREATE OR REPLACE FUNCTION public.dragon_defense_bonus(_user_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT LEAST(30, GREATEST(0, FLOOR(public.dragon_overall_level(_user_id) / 5.0)::int));
$$;

GRANT EXECUTE ON FUNCTION public.dragon_defense_bonus(uuid) TO authenticated, anon;
