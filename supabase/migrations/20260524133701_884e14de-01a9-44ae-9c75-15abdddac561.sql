
-- Fix user_market: remove OR true that exposed all users' market levels
DROP POLICY IF EXISTS "um_select_self_or_admin" ON public.user_market;
CREATE POLICY "um_select_self_or_admin" ON public.user_market
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Fix notifications: require authenticated user for broadcast rows
DROP POLICY IF EXISTS "users_view_own_notifs" ON public.notifications;
CREATE POLICY "users_view_own_notifs" ON public.notifications
  FOR SELECT USING (
    auth.uid() IS NOT NULL AND (
      recipient_id IS NULL
      OR recipient_id = auth.uid()
      OR public.is_admin(auth.uid())
    )
  );

-- Fix tribe_members privilege escalation:
-- only allow self-insert as 'member' AND only when an approved join request exists,
-- OR when the tribe currently has no members (creator becomes owner).
DROP POLICY IF EXISTS "tribe_members_insert_self" ON public.tribe_members;
CREATE POLICY "tribe_members_insert_self" ON public.tribe_members
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND (
      (
        role = 'member' AND EXISTS (
          SELECT 1 FROM public.tribe_join_requests r
          WHERE r.tribe_id = tribe_members.tribe_id
            AND r.user_id = auth.uid()
            AND r.status = 'approved'
        )
      )
      OR (
        role = 'owner' AND NOT EXISTS (
          SELECT 1 FROM public.tribe_members m WHERE m.tribe_id = tribe_members.tribe_id
        )
      )
    )
  );

-- Fix function search_path mutable
CREATE OR REPLACE FUNCTION public.market_upgrade_cost(_level integer)
 RETURNS TABLE(cost_coins bigint, seconds integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT
    (500 * POWER(1.45, _level))::BIGINT AS cost_coins,
    CASE
      WHEN _level <= 2 THEN 30
      WHEN _level <= 4 THEN 120
      WHEN _level <= 7 THEN 900
      WHEN _level <= 10 THEN 3600
      WHEN _level <= 15 THEN 14400
      WHEN _level <= 20 THEN 43200
      WHEN _level <= 25 THEN 86400
      ELSE 259200
    END AS seconds;
$function$;
