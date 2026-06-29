CREATE INDEX IF NOT EXISTS ships_owned_steal_target_active_idx
  ON public.ships_owned (stealing_target_user_id)
  WHERE stealing_target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ships_owned_steal_target_ends_idx
  ON public.ships_owned (stealing_target_user_id, stealing_ends_at)
  WHERE stealing_ends_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_user_type_idx
  ON public.inventory (user_id, item_type);

CREATE INDEX IF NOT EXISTS fish_caught_user_idx
  ON public.fish_caught (user_id);

CREATE INDEX IF NOT EXISTS friends_addressee_status_idx
  ON public.friends (addressee_id, status);

ANALYZE public.ships_owned;
ANALYZE public.inventory;
ANALYZE public.notifications;
ANALYZE public.ad_bombs;