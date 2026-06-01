
-- ============================================================
-- 1. PROFILE CURRENCY LOCK TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public._protect_profile_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow when running via SECURITY DEFINER server functions
  -- (current_user becomes the function owner, not the calling role)
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.coins      IS DISTINCT FROM OLD.coins
  OR NEW.gems       IS DISTINCT FROM OLD.gems
  OR NEW.rubies     IS DISTINCT FROM OLD.rubies
  OR NEW.xp         IS DISTINCT FROM OLD.xp
  OR NEW.level      IS DISTINCT FROM OLD.level
  OR NEW.vip_level  IS DISTINCT FROM OLD.vip_level
  OR NEW.vip_points IS DISTINCT FROM OLD.vip_points THEN
    RAISE EXCEPTION 'currency / progression columns are read-only from the client; use the server RPCs';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_profile_currency ON public.profiles;
CREATE TRIGGER protect_profile_currency
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public._protect_profile_currency();

-- ============================================================
-- 2. LEDGER LOGGING IN _mutate_currency
-- ============================================================
CREATE OR REPLACE FUNCTION public._mutate_currency(
  _user uuid, _coins bigint DEFAULT 0, _gems integer DEFAULT 0,
  _rubies integer DEFAULT 0, _xp integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _cur record;
BEGIN
  SELECT coins, gems, rubies, xp, level INTO _cur FROM public.profiles WHERE id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur.coins + _coins < 0 THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  IF _cur.gems  + _gems  < 0 THEN RAISE EXCEPTION 'insufficient gems'; END IF;
  IF _cur.rubies + _rubies < 0 THEN RAISE EXCEPTION 'insufficient rubies'; END IF;

  UPDATE public.profiles SET
    coins = coins + _coins,
    gems  = gems  + _gems,
    rubies = rubies + _rubies,
    xp    = GREATEST(0, xp + _xp),
    level = GREATEST(1, FLOOR(SQRT(GREATEST(0, xp + _xp) / 100.0))::int + 1)
  WHERE id = _user;

  -- Tracked ledger entries (one row per non-zero currency delta)
  IF _coins <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _coins, 'coins', 'mutate');
  END IF;
  IF _gems <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _gems, 'gems', 'mutate');
  END IF;
  IF _rubies <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _rubies, 'rubies', 'mutate');
  END IF;
END $$;

-- ============================================================
-- 3. BACKFILL GENESIS LEDGER ENTRIES FOR EXISTING PLAYERS
--    (so current legit balances are not flagged as untracked)
-- ============================================================
INSERT INTO public.transactions(user_id, amount, currency, kind, meta)
SELECT p.id, p.coins, 'coins', 'genesis_backfill', '{"source":"anti_cheat_migration"}'::jsonb
FROM public.profiles p
WHERE p.coins <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = p.id AND t.currency = 'coins' AND t.kind = 'genesis_backfill'
  );

INSERT INTO public.transactions(user_id, amount, currency, kind, meta)
SELECT p.id, p.gems, 'gems', 'genesis_backfill', '{"source":"anti_cheat_migration"}'::jsonb
FROM public.profiles p
WHERE p.gems <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = p.id AND t.currency = 'gems' AND t.kind = 'genesis_backfill'
  );

-- ============================================================
-- 4. ADMIN AUDIT FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_player_currency(_uid uuid)
RETURNS TABLE(
  player_id uuid,
  display_name text,
  current_coins bigint,
  ledger_coins bigint,
  coins_diff bigint,
  current_gems integer,
  ledger_gems bigint,
  gems_diff bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    p.coins,
    COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p.id AND currency='coins'), 0)::bigint,
    p.coins - COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p.id AND currency='coins'), 0)::bigint,
    p.gems,
    COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p.id AND currency='gems'), 0)::bigint,
    p.gems::bigint - COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p.id AND currency='gems'), 0)::bigint
  FROM public.profiles p
  WHERE p.id = _uid;
END $$;

-- ============================================================
-- 5. ADMIN PURGE FUNCTION — reset to ledger sum and flag cheat
-- ============================================================
CREATE OR REPLACE FUNCTION public.reset_player_to_ledger(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ledger_coins bigint;
  _ledger_gems  bigint;
  _old_coins    bigint;
  _old_gems     integer;
  _diff_coins   bigint;
  _diff_gems    bigint;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT coins, gems INTO _old_coins, _old_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;

  _ledger_coins := COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = _uid AND currency='coins'), 0);
  _ledger_gems  := COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = _uid AND currency='gems'),  0);

  _ledger_coins := GREATEST(_ledger_coins, 0);
  _ledger_gems  := GREATEST(_ledger_gems,  0);

  _diff_coins := _old_coins - _ledger_coins;
  _diff_gems  := _old_gems::bigint - _ledger_gems;

  UPDATE public.profiles
  SET coins = _ledger_coins, gems = _ledger_gems::int
  WHERE id = _uid;

  IF _diff_coins > 0 OR _diff_gems > 0 THEN
    INSERT INTO public.cheat_flags(user_id, kind, severity, details)
    VALUES (
      _uid, 'untracked_currency_purge', 5,
      jsonb_build_object(
        'removed_coins', _diff_coins,
        'removed_gems',  _diff_gems,
        'by_admin',      auth.uid()
      )
    );
    INSERT INTO public.admin_audit(admin_id, action, target_user_id, details)
    VALUES (
      auth.uid(), 'reset_player_to_ledger', _uid,
      jsonb_build_object('removed_coins', _diff_coins, 'removed_gems', _diff_gems)
    );
  END IF;

  RETURN jsonb_build_object(
    'removed_coins', _diff_coins,
    'removed_gems',  _diff_gems,
    'new_coins',     _ledger_coins,
    'new_gems',      _ledger_gems
  );
END $$;

GRANT EXECUTE ON FUNCTION public.audit_player_currency(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_player_to_ledger(uuid) TO authenticated;

-- ============================================================
-- 6. CREW SHOP PRICES — sync to current client catalog so all
--    crews can actually be purchased again.
-- ============================================================
DELETE FROM public.client_item_prices WHERE item_type = 'crew';
INSERT INTO public.client_item_prices(item_type, item_id, price_gems, price_coins) VALUES
  ('crew','luck',    50, 0),
  ('crew','guide',   0,  600000),
  ('crew','thief',   30, 0),
  ('crew','sailor',  0,  600000),
  ('crew','trader',  50, 0),
  ('crew','police',  30, 0),
  ('crew','fixer_1', 0,  200000),
  ('crew','fixer_2', 0,  700000),
  ('crew','fixer_3', 0,  3500000),
  ('crew','fixer_4', 80, 0);
