-- ============ NOTIFICATIONS (أكبر مصدر للبطء) ============
-- الاستعلامات على recipient_id + ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_id, created_at DESC);

-- استعلامات البث العام (recipient_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_notifications_broadcast_created
  ON public.notifications (created_at DESC)
  WHERE recipient_id IS NULL;

-- ============ NOTIFICATION_READS ============
CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON public.notification_reads (user_id);

-- ============ MESSAGES (الشات) ============
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON public.messages (channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_channel_created
  ON public.messages (recipient_id, channel, created_at DESC)
  WHERE recipient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender_channel_created
  ON public.messages (sender_id, channel, created_at DESC);

-- ============ SHIPS_OWNED (السفن) ============
-- فحص السفن التي تسرق منك (يُستدعى بكثرة كل ثانية)
CREATE INDEX IF NOT EXISTS idx_ships_stealing_target_active
  ON public.ships_owned (stealing_target_user_id)
  WHERE stealing_ends_at IS NOT NULL;

-- قائمة سفن اللاعب حسب in_storage مرتبة بالاكتساب
CREATE INDEX IF NOT EXISTS idx_ships_user_storage_acquired
  ON public.ships_owned (user_id, in_storage, acquired_at ASC);

-- ============ INVENTORY (المخزون) ============
CREATE INDEX IF NOT EXISTS idx_inventory_user_type
  ON public.inventory (user_id, item_type);

CREATE INDEX IF NOT EXISTS idx_inventory_user_type_item
  ON public.inventory (user_id, item_type, item_id);

-- ============ AD_BOMBS (قنابل الإعلانات) ============
-- فحص القنابل النشطة على اللاعب (استدعاءات عالية جداً)
CREATE INDEX IF NOT EXISTS idx_ad_bombs_target_active_expires
  ON public.ad_bombs (target_user_id, active, expires_at DESC)
  WHERE active = true;

-- ============ FISH_CAUGHT ============
CREATE INDEX IF NOT EXISTS idx_fish_caught_user
  ON public.fish_caught (user_id);

-- تحديث إحصائيات المخطط بعد إنشاء الفهارس
ANALYZE public.notifications;
ANALYZE public.notification_reads;
ANALYZE public.messages;
ANALYZE public.ships_owned;
ANALYZE public.inventory;
ANALYZE public.ad_bombs;
ANALYZE public.fish_caught;