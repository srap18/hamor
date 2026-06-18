
-- Enforce per-user block at the DB layer for public + tribe channels too
-- (DM was already covered on INSERT). This way realtime + select both hide
-- messages from blocked users in both directions.

DROP POLICY IF EXISTS msg_select_public ON public.messages;
CREATE POLICY msg_select_public ON public.messages
FOR SELECT
USING (
  channel = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = messages.sender_id)
       OR (ub.blocked_id = auth.uid() AND ub.blocker_id = messages.sender_id)
  )
);

DROP POLICY IF EXISTS msg_select_tribe ON public.messages;
CREATE POLICY msg_select_tribe ON public.messages
FOR SELECT
USING (
  channel = 'tribe'
  AND tribe_id IS NOT NULL
  AND is_tribe_member(auth.uid(), tribe_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = messages.sender_id)
       OR (ub.blocked_id = auth.uid() AND ub.blocker_id = messages.sender_id)
  )
);

DROP POLICY IF EXISTS msg_select_dm ON public.messages;
CREATE POLICY msg_select_dm ON public.messages
FOR SELECT
USING (
  channel = 'dm'
  AND (auth.uid() = sender_id OR auth.uid() = recipient_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = messages.sender_id)
       OR (ub.blocked_id = auth.uid() AND ub.blocker_id = messages.sender_id)
  )
);
