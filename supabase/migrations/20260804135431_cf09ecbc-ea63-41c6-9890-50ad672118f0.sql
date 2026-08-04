CREATE OR REPLACE FUNCTION public.get_fish_leaderboard(_limit integer DEFAULT 100)
 RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, avatar_frame text, name_frame text, unique_fish integer, total_fish bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH caught AS (
    SELECT fc.user_id AS uid, fc.fish_id
    FROM public.fish_caught fc
    WHERE fc.total_caught > 0
  ),
  stock AS (
    SELECT fs.user_id AS uid, fs.fish_id
    FROM public.fish_stock fs
    WHERE fs.quantity > 0
  ),
  species AS (
    SELECT uid, fish_id FROM caught
    UNION
    SELECT uid, fish_id FROM stock
  ),
  agg AS (
    SELECT s.uid,
           COUNT(DISTINCT s.fish_id)::int AS unique_fish,
           COALESCE((SELECT SUM(fc2.total_caught) FROM public.fish_caught fc2 WHERE fc2.user_id = s.uid), 0)::bigint AS total_fish
    FROM species s
    GROUP BY s.uid
  )
  SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
         p.avatar_frame, p.name_frame,
         agg.unique_fish,
         agg.total_fish
  FROM public.profiles p
  JOIN agg ON agg.uid = p.id
  WHERE agg.unique_fish > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role IN ('admin'::public.app_role, 'moderator'::public.app_role)
    )
  ORDER BY agg.unique_fish DESC, agg.total_fish DESC, p.xp DESC, p.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 100));
$function$;