CREATE OR REPLACE FUNCTION public.get_active_competitions()
 RETURNS TABLE(id uuid, title text, description text, banner_emoji text, banner_text text, banner_theme text, metric text, target_fish_id text, hide_target boolean, reward_coins bigint, reward_gems integer, reward_xp integer, reward_text text, starts_at timestamp with time zone, ends_at timestamp with time zone, prize_tiers jsonb, prizes_distributed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  BEGIN PERFORM public.finalize_due_competitions(); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN QUERY
  SELECT
    c.id, c.title, c.description, c.banner_emoji, c.banner_text, c.banner_theme,
    c.metric,
    CASE WHEN c.hide_target AND NOT is_admin(_uid) THEN NULL ELSE c.target_fish_id END,
    c.hide_target,
    c.reward_coins, c.reward_gems, c.reward_xp, c.reward_text,
    c.starts_at, c.ends_at, c.prize_tiers, c.prizes_distributed_at
  FROM public.competitions c
  WHERE c.active = true
    AND c.ends_at > now() - interval '1 day'
  ORDER BY c.starts_at ASC, c.ends_at ASC;
END $function$;