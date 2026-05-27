-- Safety: ensure columns referenced by the consolidated migration exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_frame text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name_frame text;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_user_item_uniq
  ON public.inventory(user_id, item_type, item_id)
  WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fish_market_prices_pkey')
   AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='fish_market_prices_fish_id_uniq') THEN
    CREATE UNIQUE INDEX fish_market_prices_fish_id_uniq ON public.fish_market_prices(fish_id);
  END IF;
END $$;

REVOKE UPDATE (coins, gems, rubies, xp, level, protection_until, tribe_id) ON public.profiles FROM authenticated, anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.lootbox_owned FROM authenticated, anon, public;
GRANT SELECT ON public.lootbox_owned TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fish_caught FROM authenticated, anon, public;
GRANT SELECT ON public.fish_caught TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_login_streaks FROM authenticated, anon, public;
GRANT SELECT ON public.daily_login_streaks TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fish_stock FROM authenticated, anon, public;
GRANT SELECT ON public.fish_stock TO authenticated;
REVOKE UPDATE (hp, max_hp, destroyed_at, repair_ends_at, template_id, catalog_code) ON public.ships_owned FROM authenticated, anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.inventory FROM authenticated, anon, public;
GRANT SELECT ON public.inventory TO authenticated;

DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self_full ON public.profiles;
CREATE POLICY profiles_select_self_full ON public.profiles FOR SELECT USING (auth.uid() = id OR is_admin(auth.uid()));

DROP VIEW IF EXISTS public.profiles_public CASCADE;
CREATE VIEW public.profiles_public WITH (security_invoker = on) AS
SELECT id, display_name, avatar_emoji, avatar_url, avatar_frame, name_frame, selected_bg_id, level, online_at, tribe_id, created_at FROM public.profiles;

DROP POLICY IF EXISTS profiles_select_public_basic ON public.profiles;
CREATE POLICY profiles_select_public_basic ON public.profiles FOR SELECT USING (true);

REVOKE SELECT (coins, gems, rubies, xp, protection_until) ON public.profiles FROM authenticated, anon, public;

CREATE OR REPLACE FUNCTION public.get_my_wallet()
RETURNS TABLE(coins bigint, gems int, rubies int, xp int, level int, protection_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coins, gems, rubies, xp, level, protection_until FROM public.profiles WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_wallet() TO authenticated;

DROP POLICY IF EXISTS ships_select_public ON public.ships_owned;
DROP POLICY IF EXISTS ships_select_public_basic ON public.ships_owned;
CREATE POLICY ships_select_public_basic ON public.ships_owned FOR SELECT USING (true);
REVOKE SELECT (hp, destroyed_at, repair_ends_at) ON public.ships_owned FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.get_my_ships() RETURNS SETOF public.ships_owned
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.ships_owned WHERE user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_ships() TO authenticated;

CREATE OR REPLACE FUNCTION public._mutate_currency(_user uuid, _coins bigint DEFAULT 0, _gems int DEFAULT 0, _rubies int DEFAULT 0, _xp int DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cur record;
BEGIN
  SELECT coins, gems, rubies, xp, level INTO _cur FROM public.profiles WHERE id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur.coins + _coins < 0 THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  IF _cur.gems + _gems < 0 THEN RAISE EXCEPTION 'insufficient gems'; END IF;
  IF _cur.rubies + _rubies < 0 THEN RAISE EXCEPTION 'insufficient rubies'; END IF;
  UPDATE public.profiles SET coins = coins + _coins, gems = gems + _gems, rubies = rubies + _rubies,
    xp = GREATEST(0, xp + _xp),
    level = GREATEST(1, FLOOR(SQRT(GREATEST(0, xp + _xp) / 100.0))::int + 1)
  WHERE id = _user;
END $$;