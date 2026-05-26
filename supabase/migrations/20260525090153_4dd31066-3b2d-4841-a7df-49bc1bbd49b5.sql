
-- Restore writes on tables we haven't yet refactored client code for.
-- The CRITICAL lock (profile currency columns) stays in place.
GRANT INSERT, UPDATE, DELETE ON public.inventory TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fish_caught TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fish_stock TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.daily_login_streaks TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.lootbox_owned TO authenticated;
-- Restore ships sensitive cols UPDATE (still requires RLS owner policy)
GRANT UPDATE (hp, max_hp, destroyed_at, repair_ends_at, template_id, catalog_code)
  ON public.ships_owned TO authenticated;
