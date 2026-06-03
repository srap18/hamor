
-- =========================================================
-- 1. FORUM ADMIN: bans + delete-any policy
-- =========================================================
CREATE TABLE public.forum_bans (
  user_id uuid PRIMARY KEY,
  banned_by uuid,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.forum_bans TO authenticated;
GRANT ALL ON public.forum_bans TO service_role;

ALTER TABLE public.forum_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY fb_admin_manage ON public.forum_bans
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY fb_view_own ON public.forum_bans
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Block banned users from posting topics or voting
CREATE OR REPLACE FUNCTION public.forum_check_not_banned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.forum_bans WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'FORUM_BANNED';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS forum_topics_ban_check ON public.forum_topics;
CREATE TRIGGER forum_topics_ban_check
  BEFORE INSERT ON public.forum_topics
  FOR EACH ROW EXECUTE FUNCTION public.forum_check_not_banned();

DROP TRIGGER IF EXISTS forum_votes_ban_check ON public.forum_topic_votes;
CREATE TRIGGER forum_votes_ban_check
  BEFORE INSERT ON public.forum_topic_votes
  FOR EACH ROW EXECUTE FUNCTION public.forum_check_not_banned();

-- Admin ban RPC (also deletes their topics)
CREATE OR REPLACE FUNCTION public.forum_admin_ban(_user_id uuid, _reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.forum_bans(user_id, banned_by, reason)
    VALUES (_user_id, auth.uid(), COALESCE(_reason, ''))
    ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by;
  DELETE FROM public.forum_topics WHERE user_id = _user_id;
END $$;

CREATE OR REPLACE FUNCTION public.forum_admin_unban(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.forum_bans WHERE user_id = _user_id;
END $$;

-- =========================================================
-- 2. TRIBE GEMS — currency on profiles + tribe treasury
-- =========================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tribe_gems int NOT NULL DEFAULT 0;
ALTER TABLE public.tribes   ADD COLUMN IF NOT EXISTS treasure_tribe_gems int NOT NULL DEFAULT 0;

CREATE TABLE public.tribe_gem_daily (
  user_id uuid NOT NULL,
  day date NOT NULL,
  pvp_wins int NOT NULL DEFAULT 0,
  ship_kills int NOT NULL DEFAULT 0,
  donation_gems int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

GRANT SELECT ON public.tribe_gem_daily TO authenticated;
GRANT ALL ON public.tribe_gem_daily TO service_role;

ALTER TABLE public.tribe_gem_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY tgd_select_own ON public.tribe_gem_daily
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- =========================================================
-- 3. Hook: donations grant tribe gems (1 per 1,000 coins, no cap)
-- =========================================================
CREATE OR REPLACE FUNCTION public.tribe_donation_grant_gems()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _gems int;
BEGIN
  _gems := GREATEST(0, (NEW.amount / 1000)::int);
  IF _gems > 0 THEN
    UPDATE public.profiles SET tribe_gems = tribe_gems + _gems WHERE id = NEW.user_id;
    INSERT INTO public.tribe_gem_daily(user_id, day, donation_gems)
      VALUES (NEW.user_id, (now() AT TIME ZONE 'UTC')::date, _gems)
      ON CONFLICT (user_id, day) DO UPDATE SET donation_gems = tribe_gem_daily.donation_gems + EXCLUDED.donation_gems;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tribe_donations_grant_gems ON public.tribe_donations;
CREATE TRIGGER tribe_donations_grant_gems
  AFTER INSERT ON public.tribe_donations
  FOR EACH ROW EXECUTE FUNCTION public.tribe_donation_grant_gems();

-- =========================================================
-- 4. Hook: winning attacks grant tribe gems (capped daily)
-- =========================================================
CREATE OR REPLACE FUNCTION public.attack_grant_tribe_gems()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att_lvl int; _def_lvl int; _today date := (now() AT TIME ZONE 'UTC')::date;
  _cur_wins int; _cur_kills int; _ship_lvl int := 0;
  _gain int := 0; _kill_gain int := 0;
BEGIN
  IF NEW.attacker_won IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT level INTO _att_lvl FROM public.profiles WHERE id = NEW.attacker_id;
  SELECT level INTO _def_lvl FROM public.profiles WHERE id = NEW.defender_id;

  -- Only count if defender within ±5 levels of attacker (no farming weak players)
  IF _def_lvl IS NULL OR _att_lvl IS NULL OR _def_lvl < _att_lvl - 5 THEN
    RETURN NEW;
  END IF;

  -- Determine ship level of target if destroyed
  IF NEW.target_ship_id IS NOT NULL THEN
    SELECT template_id INTO _ship_lvl FROM public.ships_owned WHERE id = NEW.target_ship_id;
    _ship_lvl := COALESCE(_ship_lvl, 0);
  END IF;

  INSERT INTO public.tribe_gem_daily(user_id, day)
    VALUES (NEW.attacker_id, _today)
    ON CONFLICT (user_id, day) DO NOTHING;
  SELECT pvp_wins, ship_kills INTO _cur_wins, _cur_kills
    FROM public.tribe_gem_daily WHERE user_id = NEW.attacker_id AND day = _today;

  IF COALESCE(_cur_wins, 0) < 5 THEN _gain := 1; END IF;

  IF _ship_lvl >= 15 AND NEW.damage_dealt > 0
     AND COALESCE(_cur_kills, 0) < 3
     AND EXISTS(SELECT 1 FROM public.ships_owned WHERE id = NEW.target_ship_id AND hp <= 0) THEN
    _kill_gain := 2;
  END IF;

  IF _gain + _kill_gain > 0 THEN
    UPDATE public.profiles SET tribe_gems = tribe_gems + _gain + _kill_gain WHERE id = NEW.attacker_id;
    UPDATE public.tribe_gem_daily
      SET pvp_wins = pvp_wins + (CASE WHEN _gain > 0 THEN 1 ELSE 0 END),
          ship_kills = ship_kills + (CASE WHEN _kill_gain > 0 THEN 1 ELSE 0 END)
      WHERE user_id = NEW.attacker_id AND day = _today;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attacks_grant_tribe_gems ON public.attacks;
CREATE TRIGGER attacks_grant_tribe_gems
  AFTER INSERT ON public.attacks
  FOR EACH ROW EXECUTE FUNCTION public.attack_grant_tribe_gems();

-- =========================================================
-- 5. Ship catalog — add tribe-only columns + 3 new ships
-- =========================================================
ALTER TABLE public.ship_catalog ADD COLUMN IF NOT EXISTS tribe_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.ship_catalog ADD COLUMN IF NOT EXISTS price_tribe_gems int NOT NULL DEFAULT 0;

INSERT INTO public.ship_catalog
  (code, name, description, market_level_required, rarity, max_hp, armor, speed, storage,
   fishing_power, attack_power, fish_pool, price_coins, price_gems, price_tribe_gems,
   tribe_only, repair_seconds, fishing_seconds, sort_order, active)
VALUES
  ('tribe-lightning', '⚡ سفينة البرق', 'سفينة القبيلة — سرعة خارقة وصيد سريع', 24, 'epic',
    20000, 80, 100, 20000, 220, 180,
    '["manta","hammerhead","orca","arowana"]'::jsonb,
    0, 0, 60, true, 240, 18, 100, true),
  ('tribe-tornado',   '🌀 سفينة الإعصار', 'سفينة القبيلة — سعة هائلة ودروع متينة', 24, 'epic',
    20000, 200, 70, 20000, 200, 200,
    '["whale","manta","goldfish","pearl"]'::jsonb,
    0, 0, 90, true, 240, 22, 101, true),
  ('tribe-fire',      '🔥 سفينة النار', 'سفينة القبيلة — قوة هجوم لا تُقهر', 24, 'legendary',
    20000, 150, 85, 20000, 240, 320,
    '["whale","orca","hammerhead","pearl"]'::jsonb,
    0, 0, 150, true, 300, 20, 102, true)
ON CONFLICT (code) DO UPDATE SET
  max_hp = EXCLUDED.max_hp, storage = EXCLUDED.storage,
  price_tribe_gems = EXCLUDED.price_tribe_gems, tribe_only = true,
  market_level_required = EXCLUDED.market_level_required,
  fish_pool = EXCLUDED.fish_pool, active = true;

-- =========================================================
-- 6. Buy tribe ship RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.buy_tribe_ship(_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _price int; _tpl int := 24; _max_hp int; _gems int; _name text; _new_id uuid;
  _market_level int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT price_tribe_gems, max_hp, name INTO _price, _max_hp, _name
    FROM public.ship_catalog WHERE code = _code AND tribe_only = true AND active = true;
  IF _price IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF COALESCE(_market_level, 1) < 24 THEN
    RAISE EXCEPTION 'يتطلب الوصول لمستوى السفن 24';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND tribe_id IS NOT NULL) THEN
    RAISE EXCEPTION 'يجب أن تكون عضواً في قبيلة';
  END IF;

  SELECT tribe_gems INTO _gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF COALESCE(_gems, 0) < _price THEN RAISE EXCEPTION 'NOT_ENOUGH_TRIBE_GEMS'; END IF;

  UPDATE public.profiles SET tribe_gems = tribe_gems - _price WHERE id = _uid;
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, hp, max_hp, in_storage)
    VALUES (_uid, _tpl, _code, _max_hp, _max_hp, true)
    RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.buy_tribe_ship(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_ban(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_unban(uuid) TO authenticated;
