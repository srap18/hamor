-- ============= ROLES SYSTEM =============
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','moderator'))
$$;

CREATE POLICY "users_view_own_roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "admin_manage_roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  IF lower(NEW.email) = 'ccx1357@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE lower(email) = 'ccx1357@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::app_role FROM auth.users
ON CONFLICT DO NOTHING;

CREATE POLICY "admin_update_profiles" ON public.profiles FOR UPDATE USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============= BANS =============
CREATE TABLE public.bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  banned_by uuid REFERENCES auth.users(id),
  banned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.bans TO authenticated;
GRANT ALL ON public.bans TO service_role;
ALTER TABLE public.bans ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_bans_user_active ON public.bans(user_id) WHERE active = true;

CREATE POLICY "users_view_own_bans" ON public.bans FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "admin_manage_bans" ON public.bans FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.is_banned(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.bans WHERE user_id = _user_id AND active = true AND (expires_at IS NULL OR expires_at > now()))
$$;

-- ============= NOTIFICATIONS =============
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_notifs_recipient ON public.notifications(recipient_id, created_at DESC);

CREATE POLICY "users_view_own_notifs" ON public.notifications FOR SELECT USING (recipient_id IS NULL OR recipient_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "admin_send_notifs" ON public.notifications FOR INSERT WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin_delete_notifs" ON public.notifications FOR DELETE USING (public.is_admin(auth.uid()));

CREATE TABLE public.notification_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_reads" ON public.notification_reads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============= DAILY QUESTS =============
CREATE TABLE public.daily_quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '🎯',
  goal_type text NOT NULL,
  goal_count integer NOT NULL DEFAULT 1,
  reward_coins bigint NOT NULL DEFAULT 0,
  reward_xp integer NOT NULL DEFAULT 0,
  reward_gems integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.daily_quests TO anon, authenticated;
GRANT ALL ON public.daily_quests TO service_role;
ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_quests" ON public.daily_quests FOR SELECT USING (true);
CREATE POLICY "admin_manage_quests" ON public.daily_quests FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.quest_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_id uuid NOT NULL REFERENCES public.daily_quests(id) ON DELETE CASCADE,
  progress integer NOT NULL DEFAULT 0,
  claimed boolean NOT NULL DEFAULT false,
  day_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, quest_id, day_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quest_progress TO authenticated;
GRANT ALL ON public.quest_progress TO service_role;
ALTER TABLE public.quest_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_progress" ON public.quest_progress FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_view_progress" ON public.quest_progress FOR SELECT USING (public.is_admin(auth.uid()));

-- ============= ACHIEVEMENTS =============
CREATE TABLE public.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '🏆',
  goal_type text NOT NULL,
  goal_count integer NOT NULL DEFAULT 1,
  reward_coins bigint NOT NULL DEFAULT 0,
  reward_xp integer NOT NULL DEFAULT 0,
  reward_gems integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.achievements TO anon, authenticated;
GRANT ALL ON public.achievements TO service_role;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_achievements" ON public.achievements FOR SELECT USING (true);
CREATE POLICY "admin_manage_achievements" ON public.achievements FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.user_achievements (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  progress integer NOT NULL DEFAULT 0,
  unlocked_at timestamptz,
  claimed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, achievement_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_achievements TO authenticated;
GRANT ALL ON public.user_achievements TO service_role;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_achievements" ON public.user_achievements FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_view_user_achievements" ON public.user_achievements FOR SELECT USING (public.is_admin(auth.uid()));

-- ============= LOOT BOXES =============
CREATE TABLE public.lootbox_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon text NOT NULL DEFAULT '🎁',
  rarity text NOT NULL DEFAULT 'common',
  cost_coins bigint NOT NULL DEFAULT 0,
  cost_gems integer NOT NULL DEFAULT 0,
  min_coins bigint NOT NULL DEFAULT 0,
  max_coins bigint NOT NULL DEFAULT 100,
  min_gems integer NOT NULL DEFAULT 0,
  max_gems integer NOT NULL DEFAULT 0,
  min_xp integer NOT NULL DEFAULT 0,
  max_xp integer NOT NULL DEFAULT 50,
  active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.lootbox_types TO anon, authenticated;
GRANT ALL ON public.lootbox_types TO service_role;
ALTER TABLE public.lootbox_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_lootboxes" ON public.lootbox_types FOR SELECT USING (true);
CREATE POLICY "admin_manage_lootboxes" ON public.lootbox_types FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.lootbox_owned (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES public.lootbox_types(id) ON DELETE CASCADE,
  opened boolean NOT NULL DEFAULT false,
  reward jsonb,
  acquired_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lootbox_owned TO authenticated;
GRANT ALL ON public.lootbox_owned TO service_role;
ALTER TABLE public.lootbox_owned ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_boxes" ON public.lootbox_owned FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_manage_all_boxes" ON public.lootbox_owned FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============= EVENTS =============
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  banner text NOT NULL DEFAULT '🎉',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  xp_multiplier numeric NOT NULL DEFAULT 1.0,
  coin_multiplier numeric NOT NULL DEFAULT 1.0,
  active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_events" ON public.events FOR SELECT USING (true);
CREATE POLICY "admin_manage_events" ON public.events FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============= ITEMS CATALOG =============
CREATE TABLE public.items_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '⚓',
  price_coins bigint NOT NULL DEFAULT 0,
  price_gems integer NOT NULL DEFAULT 0,
  rarity text NOT NULL DEFAULT 'common',
  stats jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, code)
);
GRANT SELECT ON public.items_catalog TO anon, authenticated;
GRANT ALL ON public.items_catalog TO service_role;
ALTER TABLE public.items_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_catalog" ON public.items_catalog FOR SELECT USING (true);
CREATE POLICY "admin_manage_catalog" ON public.items_catalog FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============= ADMIN AUDIT =============
CREATE TABLE public.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  target_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.admin_audit TO authenticated;
GRANT ALL ON public.admin_audit TO service_role;
ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_audit_created ON public.admin_audit(created_at DESC);
CREATE POLICY "admin_view_audit" ON public.admin_audit FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY "admin_insert_audit" ON public.admin_audit FOR INSERT WITH CHECK (auth.uid() = admin_id AND public.is_admin(auth.uid()));

INSERT INTO public.daily_quests (title, description, icon, goal_type, goal_count, reward_coins, reward_xp) VALUES
('سجّل دخولك', 'افتح اللعبة اليوم', '📅', 'login', 1, 100, 20),
('اصطد 5 أسماك', 'اصطد 5 أسماك أي نوع', '🐟', 'catch_fish', 5, 250, 50),
('انتصار في PvP', 'افز بمعركة واحدة', '⚔️', 'win_pvp', 1, 500, 100);

INSERT INTO public.achievements (code, title, description, icon, goal_type, goal_count, reward_coins, reward_xp, sort_order) VALUES
('first_ship', 'البحار المبتدئ', 'امتلك أول سفينة', '⛵', 'own_ship', 1, 200, 50, 1),
('fleet_5', 'صاحب الأسطول', 'امتلك 5 سفن', '🚢', 'own_ship', 5, 1000, 200, 2),
('warrior_10', 'محارب البحار', 'افز في 10 معارك', '⚔️', 'win_pvp', 10, 2000, 500, 3),
('fisher_100', 'صياد محترف', 'اصطد 100 سمكة', '🎣', 'catch_fish', 100, 1500, 300, 4),
('rich_10k', 'تاجر ثري', 'امتلك 10,000 عملة', '💰', 'coins_held', 10000, 500, 100, 5);

INSERT INTO public.lootbox_types (name, icon, rarity, cost_coins, min_coins, max_coins, min_xp, max_xp) VALUES
('صندوق برونزي', '📦', 'common', 200, 100, 500, 10, 50),
('صندوق فضي', '🎁', 'rare', 1000, 500, 2500, 50, 200),
('صندوق ذهبي', '🏆', 'epic', 5000, 2500, 12000, 200, 800);

-- ============= USER MARKET =============
CREATE TABLE IF NOT EXISTS public.user_market (
  user_id UUID PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 30),
  upgrading_to INTEGER,
  upgrade_started_at TIMESTAMPTZ,
  upgrade_ends_at TIMESTAMPTZ,
  upgrade_cost_coins BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_market TO authenticated;
GRANT ALL ON public.user_market TO service_role;
ALTER TABLE public.user_market ENABLE ROW LEVEL SECURITY;
CREATE POLICY um_select_self_or_admin ON public.user_market FOR SELECT USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY um_insert_self ON public.user_market FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY um_update_self ON public.user_market FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY um_admin_all ON public.user_market FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ============= SHIP CATALOG =============
CREATE TABLE IF NOT EXISTS public.ship_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  market_level_required INTEGER NOT NULL DEFAULT 1,
  rarity TEXT NOT NULL DEFAULT 'common',
  max_hp INTEGER NOT NULL DEFAULT 100,
  armor INTEGER NOT NULL DEFAULT 0,
  speed INTEGER NOT NULL DEFAULT 10,
  storage INTEGER NOT NULL DEFAULT 10,
  fishing_power INTEGER NOT NULL DEFAULT 10,
  attack_power INTEGER NOT NULL DEFAULT 10,
  fish_pool JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_coins BIGINT NOT NULL DEFAULT 0,
  price_gems INTEGER NOT NULL DEFAULT 0,
  repair_seconds INTEGER NOT NULL DEFAULT 300,
  fishing_seconds INTEGER NOT NULL DEFAULT 30,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ship_catalog TO anon, authenticated;
GRANT ALL ON public.ship_catalog TO service_role;
ALTER TABLE public.ship_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY sc_all_view ON public.ship_catalog FOR SELECT USING (true);
CREATE POLICY sc_admin_manage ON public.ship_catalog FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ============= EXTEND ships_owned =============
ALTER TABLE public.ships_owned
  ADD COLUMN IF NOT EXISTS catalog_code TEXT,
  ADD COLUMN IF NOT EXISTS hp INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_hp INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS destroyed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS repair_ends_at TIMESTAMPTZ;

-- ============= FISH STOCK =============
CREATE TABLE IF NOT EXISTS public.fish_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  fish_id TEXT NOT NULL,
  ship_id UUID,
  caught_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  base_value BIGINT NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fish_stock TO authenticated;
GRANT ALL ON public.fish_stock TO service_role;
ALTER TABLE public.fish_stock ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fish_stock_user ON public.fish_stock(user_id);
CREATE INDEX IF NOT EXISTS idx_fish_stock_caught ON public.fish_stock(caught_at);
CREATE POLICY fs_select_own ON public.fish_stock FOR SELECT USING (auth.uid() = user_id OR is_admin(auth.uid()));
CREATE POLICY fs_insert_own ON public.fish_stock FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY fs_update_own ON public.fish_stock FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY fs_delete_own ON public.fish_stock FOR DELETE USING (auth.uid() = user_id);

-- ============= FISH MARKET PRICES =============
CREATE TABLE IF NOT EXISTS public.fish_market_prices (
  fish_id TEXT PRIMARY KEY,
  current_price BIGINT NOT NULL DEFAULT 0,
  min_price BIGINT NOT NULL DEFAULT 0,
  max_price BIGINT NOT NULL DEFAULT 0,
  trend NUMERIC NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fish_market_prices TO anon, authenticated;
GRANT ALL ON public.fish_market_prices TO service_role;
ALTER TABLE public.fish_market_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY fmp_all_view ON public.fish_market_prices FOR SELECT USING (true);
CREATE POLICY fmp_admin_manage ON public.fish_market_prices FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.attacks
  ADD COLUMN IF NOT EXISTS damage_dealt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attacker_won BOOLEAN,
  ADD COLUMN IF NOT EXISTS loot_coins BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.market_upgrade_cost(_level INTEGER)
RETURNS TABLE(cost_coins BIGINT, seconds INTEGER)
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT (500 * POWER(1.45, _level))::BIGINT,
    CASE WHEN _level <= 2 THEN 30 WHEN _level <= 4 THEN 120 WHEN _level <= 7 THEN 900
         WHEN _level <= 10 THEN 3600 WHEN _level <= 15 THEN 14400 WHEN _level <= 20 THEN 43200
         WHEN _level <= 25 THEN 86400 ELSE 259200 END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_market_upgrades()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.user_market SET level = upgrading_to, upgrading_to = NULL,
    upgrade_started_at = NULL, upgrade_ends_at = NULL, updated_at = now()
  WHERE upgrade_ends_at IS NOT NULL AND upgrade_ends_at <= now() AND upgrading_to IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_market()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_market (user_id, level) VALUES (NEW.id, 1) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_market ON auth.users;
CREATE TRIGGER on_auth_user_created_market AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_market();

INSERT INTO public.user_market (user_id, level) SELECT id, 1 FROM auth.users ON CONFLICT DO NOTHING;

-- ============= TRIBE JOIN REQUESTS / WARS / GIFTS =============
CREATE TABLE public.tribe_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tribe_id uuid NOT NULL, user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tribe_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tribe_join_requests TO authenticated;
GRANT ALL ON public.tribe_join_requests TO service_role;
ALTER TABLE public.tribe_join_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tribe_officer(_user_id uuid, _tribe_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tribe_members WHERE user_id = _user_id AND tribe_id = _tribe_id AND role IN ('owner','moderator'));
$$;

CREATE POLICY tjr_insert_self ON public.tribe_join_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY tjr_select_involved ON public.tribe_join_requests FOR SELECT USING (auth.uid() = user_id OR public.is_tribe_officer(auth.uid(), tribe_id));
CREATE POLICY tjr_update_officer ON public.tribe_join_requests FOR UPDATE USING (public.is_tribe_officer(auth.uid(), tribe_id));
CREATE POLICY tjr_delete_self_or_officer ON public.tribe_join_requests FOR DELETE USING (auth.uid() = user_id OR public.is_tribe_officer(auth.uid(), tribe_id));

CREATE POLICY tm_update_officer ON public.tribe_members FOR UPDATE USING (public.is_tribe_officer(auth.uid(), tribe_id)) WITH CHECK (public.is_tribe_officer(auth.uid(), tribe_id));
CREATE POLICY tm_delete_officer ON public.tribe_members FOR DELETE USING (public.is_tribe_officer(auth.uid(), tribe_id));

CREATE TABLE public.tribe_wars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declarer_id uuid NOT NULL, target_id uuid NOT NULL,
  declarer_tribe_id uuid, target_tribe_id uuid,
  status text NOT NULL DEFAULT 'active', message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.tribe_wars TO authenticated;
GRANT ALL ON public.tribe_wars TO service_role;
ALTER TABLE public.tribe_wars ENABLE ROW LEVEL SECURITY;
CREATE POLICY tw_insert_self ON public.tribe_wars FOR INSERT WITH CHECK (auth.uid() = declarer_id AND declarer_id <> target_id);
CREATE POLICY tw_select_all ON public.tribe_wars FOR SELECT USING (true);
CREATE POLICY tw_update_involved ON public.tribe_wars FOR UPDATE USING (auth.uid() = declarer_id OR auth.uid() = target_id);

CREATE TABLE public.support_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL, recipient_id uuid NOT NULL,
  kind text NOT NULL, amount bigint NOT NULL DEFAULT 0,
  ship_id uuid, claimed boolean NOT NULL DEFAULT false,
  message text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.support_gifts TO authenticated;
GRANT ALL ON public.support_gifts TO service_role;
ALTER TABLE public.support_gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY sg_insert_sender ON public.support_gifts FOR INSERT WITH CHECK (auth.uid() = sender_id AND sender_id <> recipient_id);
CREATE POLICY sg_select_involved ON public.support_gifts FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY sg_update_recipient ON public.support_gifts FOR UPDATE USING (auth.uid() = recipient_id);

CREATE POLICY "ships_select_public" ON public.ships_owned FOR SELECT USING (true);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS selected_bg_id text NOT NULL DEFAULT 'harbor';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS protection_until timestamptz;

-- ============= SHIP DAMAGE / REPAIR =============
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage int)
RETURNS TABLE(new_hp int, destroyed boolean, repair_ends_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _new_hp int; _owner uuid; _tpl int; _repair_secs int; _repair_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, template_id INTO _owner, _tpl FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = auth.uid() THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;
  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(86400, GREATEST(300, _tpl * _tpl * 96));
  UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp,100) - _damage),
        destroyed_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND destroyed_at IS NULL THEN now() ELSE destroyed_at END,
        repair_ends_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND repair_ends_at IS NULL THEN now() + make_interval(secs => _repair_secs) ELSE repair_ends_at END
  WHERE id = _ship_id
  RETURNING hp, ships_owned.repair_ends_at INTO _new_hp, _repair_ends;
  RETURN QUERY SELECT _new_hp, _new_hp = 0, _repair_ends;
END; $$;
GRANT EXECUTE ON FUNCTION public.apply_ship_damage(uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_ship_repairs()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ships_owned SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
  WHERE destroyed_at IS NOT NULL AND repair_ends_at IS NOT NULL AND repair_ends_at <= now();
$$;
GRANT EXECUTE ON FUNCTION public.finalize_ship_repairs() TO anon, authenticated;

-- ============= DAILY LOGIN STREAKS =============
CREATE TABLE IF NOT EXISTS public.daily_login_streaks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  last_claim_date date, total_claims integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.daily_login_streaks TO authenticated;
GRANT ALL ON public.daily_login_streaks TO service_role;
ALTER TABLE public.daily_login_streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dls_select_own" ON public.daily_login_streaks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "dls_insert_own" ON public.daily_login_streaks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dls_update_own" ON public.daily_login_streaks FOR UPDATE USING (auth.uid() = user_id);

-- ============= STEAL FISH =============
CREATE OR REPLACE FUNCTION public.steal_fish(_defender_id uuid, _max_count integer DEFAULT 5, _attacker_ship_id uuid DEFAULT NULL, _target_ship_id uuid DEFAULT NULL)
RETURNS TABLE(stolen_count integer, total_value bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _attacker uuid := auth.uid(); _moved integer := 0; _value bigint := 0; _prot timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _defender_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF _max_count IS NULL OR _max_count < 1 THEN _max_count := 1; END IF;
  IF _max_count > 20 THEN _max_count := 20; END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _defender_id;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'target is protected until %', _prot; END IF;
  WITH picked AS (
    SELECT id, base_value FROM public.fish_stock WHERE user_id = _defender_id
    ORDER BY base_value DESC, caught_at ASC LIMIT _max_count FOR UPDATE SKIP LOCKED
  ), moved AS (
    UPDATE public.fish_stock fs SET user_id = _attacker, caught_at = now(), ship_id = NULL
    FROM picked WHERE fs.id = picked.id RETURNING fs.id, picked.base_value AS v
  )
  SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;
  RETURN QUERY SELECT _moved, _value;
END; $$;

-- ============= MESSAGES VOICE =============
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_duration_ms int;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_body_check
  CHECK (length(body) <= 500 AND (length(body) >= 1 OR audio_url IS NOT NULL));

INSERT INTO storage.buckets (id, name, public) VALUES ('chat-audio', 'chat-audio', true) ON CONFLICT (id) DO NOTHING;

-- ============= STARTER SHIP =============
CREATE OR REPLACE FUNCTION public.handle_new_user_starter_ship()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ships_owned (user_id, template_id, at_sea, hp, max_hp) VALUES (NEW.id, 1, false, 100, 100);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_starter_ship ON auth.users;
CREATE TRIGGER on_auth_user_created_starter_ship AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_starter_ship();

ALTER TABLE public.profiles ALTER COLUMN coins SET DEFAULT 1000;

INSERT INTO public.ships_owned (user_id, template_id, at_sea, hp, max_hp)
SELECT p.id, 1, false, 100, 100 FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.ships_owned s WHERE s.user_id = p.id);

CREATE OR REPLACE FUNCTION public.prevent_last_ship_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _remaining int;
BEGIN
  SELECT COUNT(*) INTO _remaining FROM public.ships_owned WHERE user_id = OLD.user_id AND id <> OLD.id;
  IF _remaining < 1 THEN RAISE EXCEPTION 'cannot sell last ship'; END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_prevent_last_ship_delete ON public.ships_owned;
CREATE TRIGGER trg_prevent_last_ship_delete BEFORE DELETE ON public.ships_owned
FOR EACH ROW EXECUTE FUNCTION public.prevent_last_ship_delete();

-- ============= PROFILE BACKFILL TRIGGERS =============
INSERT INTO public.profiles (id, display_name, avatar_emoji)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email,'@',1), 'قبطان'),
       COALESCE(u.raw_user_meta_data->>'avatar_emoji', '🧑‍✈️')
FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE p.id IS NULL;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============= USER BLOCKS =============
CREATE TABLE public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL, blocked_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id), CHECK (blocker_id <> blocked_id)
);
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ub_select_any ON public.user_blocks FOR SELECT TO authenticated USING (true);
CREATE POLICY ub_insert_own ON public.user_blocks FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY ub_delete_own ON public.user_blocks FOR DELETE TO authenticated USING (auth.uid() = blocker_id);
CREATE INDEX idx_user_blocks_blocker ON public.user_blocks(blocker_id);
CREATE INDEX idx_user_blocks_blocked ON public.user_blocks(blocked_id);

-- ============= REALTIME =============
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.friends; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_blocks; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.fish_stock; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.ships_owned; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.friends REPLICA IDENTITY FULL;
ALTER TABLE public.user_blocks REPLICA IDENTITY FULL;
ALTER TABLE public.fish_stock REPLICA IDENTITY FULL;
ALTER TABLE public.ships_owned REPLICA IDENTITY FULL;
ALTER TABLE public.inventory REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.broadcast_nuke(_target_id uuid, _message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _attacker uuid := auth.uid(); _msg text; _recent_nuke_count int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;
  _msg := btrim(coalesce(_message, ''));
  IF char_length(_msg) < 20 THEN RAISE EXCEPTION 'message must be at least 20 characters'; END IF;
  IF char_length(_msg) > 200 THEN _msg := substring(_msg, 1, 200); END IF;
  SELECT COUNT(*) INTO _recent_nuke_count FROM public.attacks
   WHERE attacker_id = _attacker AND defender_id = _target_id AND created_at > now() - interval '5 minutes';
  IF _recent_nuke_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.broadcast_nuke(uuid, text) TO authenticated;