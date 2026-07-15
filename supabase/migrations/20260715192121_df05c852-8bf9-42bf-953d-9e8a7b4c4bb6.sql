
CREATE OR REPLACE FUNCTION public.get_tribe_attack_log(_tribe_id uuid, _limit int DEFAULT 100)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  attacker_id uuid,
  defender_id uuid,
  damage_dealt int,
  attacker_won boolean,
  loot_coins bigint,
  direction text,
  attacker_name text,
  attacker_avatar_url text,
  attacker_avatar_emoji text,
  attacker_tribe_id uuid,
  attacker_tribe_name text,
  attacker_tribe_emblem text,
  defender_name text,
  defender_avatar_url text,
  defender_avatar_emoji text,
  defender_tribe_id uuid,
  defender_tribe_name text,
  defender_tribe_emblem text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  allowed AS (
    SELECT 1
    FROM tribe_members tm, me
    WHERE tm.tribe_id = _tribe_id AND tm.user_id = me.uid
    UNION ALL
    SELECT 1 FROM user_roles ur, me
    WHERE ur.user_id = me.uid AND ur.role IN ('admin','moderator')
  ),
  members AS (
    SELECT user_id FROM tribe_members WHERE tribe_id = _tribe_id
  )
  SELECT
    a.id,
    a.created_at,
    a.attacker_id,
    a.defender_id,
    a.damage_dealt,
    a.attacker_won,
    a.loot_coins,
    CASE
      WHEN a.attacker_id IN (SELECT user_id FROM members) THEN 'out'
      ELSE 'in'
    END AS direction,
    ap.display_name, ap.avatar_url, ap.avatar_emoji,
    atr.id, atr.name, atr.emblem,
    dp.display_name, dp.avatar_url, dp.avatar_emoji,
    dtr.id, dtr.name, dtr.emblem
  FROM attacks a
  LEFT JOIN profiles ap ON ap.id = a.attacker_id
  LEFT JOIN profiles dp ON dp.id = a.defender_id
  LEFT JOIN tribe_members atm ON atm.user_id = a.attacker_id
  LEFT JOIN tribes atr ON atr.id = atm.tribe_id
  LEFT JOIN tribe_members dtm ON dtm.user_id = a.defender_id
  LEFT JOIN tribes dtr ON dtr.id = dtm.tribe_id
  WHERE EXISTS (SELECT 1 FROM allowed)
    AND (a.attacker_id IN (SELECT user_id FROM members)
      OR a.defender_id IN (SELECT user_id FROM members))
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 500));
$$;

REVOKE ALL ON FUNCTION public.get_tribe_attack_log(uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_tribe_attack_log(uuid, int) TO authenticated;
