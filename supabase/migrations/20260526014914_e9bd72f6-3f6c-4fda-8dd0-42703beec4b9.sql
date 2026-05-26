
-- 1) quest_progress: revoke direct writes
DROP POLICY IF EXISTS users_manage_own_progress ON public.quest_progress;
CREATE POLICY qp_select_own ON public.quest_progress
  FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.quest_progress FROM authenticated, anon;

-- 2) user_achievements: revoke direct writes
DROP POLICY IF EXISTS users_manage_own_achievements ON public.user_achievements;
CREATE POLICY ua_select_own ON public.user_achievements
  FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.user_achievements FROM authenticated, anon;

-- 3) ship_listings: revoke direct writes (use RPC only)
DROP POLICY IF EXISTS listings_insert_seller ON public.ship_listings;
DROP POLICY IF EXISTS listings_update_seller ON public.ship_listings;
REVOKE INSERT, UPDATE, DELETE ON public.ship_listings FROM authenticated, anon;

-- 4) realtime.messages: scope channel topic access
DROP POLICY IF EXISTS realtime_authenticated_only ON realtime.messages;

CREATE POLICY realtime_scoped_topics ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    -- public broadcast channel
    realtime.topic() = 'public'
    -- user's own private channel: "user:<uid>"
    OR realtime.topic() = 'user:' || auth.uid()::text
    -- direct message channel: "dm:<uidA>:<uidB>" sorted
    OR (
      realtime.topic() LIKE 'dm:%'
      AND position(auth.uid()::text in realtime.topic()) > 0
    )
    -- tribe channel: "tribe:<tribe_uuid>"
    OR (
      realtime.topic() LIKE 'tribe:%'
      AND public.is_tribe_member(
        auth.uid(),
        NULLIF(substring(realtime.topic() from 7), '')::uuid
      )
    )
  );
