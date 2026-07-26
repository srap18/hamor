
-- Performance indexes based on pg_stat_statements top offenders.
-- All CREATE INDEX IF NOT EXISTS — safe re-run, no logic change.

-- Notifications: recipient inbox reads (16M+ calls)
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_id, created_at DESC);

-- Notifications: broadcast (recipient_id IS NULL) recent reads (16M+ calls)
CREATE INDEX IF NOT EXISTS idx_notifications_broadcast_created
  ON public.notifications (created_at DESC)
  WHERE recipient_id IS NULL;

-- Notification reads per user (16M+ calls)
CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON public.notification_reads (user_id);

-- Messages: public/tribe channel lists ordered by time
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON public.messages (channel, created_at DESC);

-- Messages: DM inbox (recipient) and outbox (sender)
CREATE INDEX IF NOT EXISTS idx_messages_channel_recipient_created
  ON public.messages (channel, recipient_id, created_at DESC)
  WHERE recipient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_channel_sender_created
  ON public.messages (channel, sender_id, created_at DESC);

-- Tribe chat window
CREATE INDEX IF NOT EXISTS idx_messages_channel_tribe_created
  ON public.messages (channel, tribe_id, created_at)
  WHERE tribe_id IS NOT NULL;

-- Friends lookups by either side + status filter
CREATE INDEX IF NOT EXISTS idx_friends_requester_status
  ON public.friends (requester_id, status);

CREATE INDEX IF NOT EXISTS idx_friends_addressee_status
  ON public.friends (addressee_id, status);

-- Inventory scans by (user_id, item_type)
CREATE INDEX IF NOT EXISTS idx_inventory_user_item_type
  ON public.inventory (user_id, item_type);

-- Fish caught totals per user
CREATE INDEX IF NOT EXISTS idx_fish_caught_user
  ON public.fish_caught (user_id);

-- Ships owned per user, storage filter, ordered by acquisition
CREATE INDEX IF NOT EXISTS idx_ships_owned_user_storage_acquired
  ON public.ships_owned (user_id, in_storage, acquired_at);

-- Support ticket messages by ticket in chronological order
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_created
  ON public.support_ticket_messages (ticket_id, created_at);

-- User roles quick lookup (used by useIsAdmin, 15M+ calls)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
  ON public.user_roles (user_id, role);
