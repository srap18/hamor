DROP FUNCTION IF EXISTS public.get_currency_leaderboard(text, integer);

CREATE OR REPLACE FUNCTION public.get_currency_leaderboard(_col text, _limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, xp integer, coins integer, gems bigint, name_frame text, avatar_frame text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _col NOT IN ('coins','gems','xp') THEN
    RAISE EXCEPTION 'invalid column';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, p.xp, p.coins, p.gems, p.name_frame, p.avatar_frame
     FROM public.profiles p
     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN (''admin''::app_role,''moderator''::app_role))
     ORDER BY p.%I DESC NULLS LAST LIMIT $1', _col
  ) USING _limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_currency_leaderboard(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_currency_leaderboard(text, integer) TO authenticated;
