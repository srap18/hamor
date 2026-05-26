
-- ============= ROLES SYSTEM =============
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
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

-- Auto-grant admin to specific email on signup
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

-- Grant admin to existing user if matches
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE lower(email) = 'ccx1357@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::app_role FROM auth.users
ON CONFLICT DO NOTHING;

-- Admin can update any profile (for editing coins/gems/etc)
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
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = broadcast
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
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
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_reads" ON public.notification_reads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============= DAILY QUESTS =============
CREATE TABLE public.daily_quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '🎯',
  goal_type text NOT NULL, -- 'catch_fish', 'win_pvp', 'buy_ship', 'send_ship', 'login'
  goal_count integer NOT NULL DEFAULT 1,
  reward_coins bigint NOT NULL DEFAULT 0,
  reward_xp integer NOT NULL DEFAULT 0,
  reward_gems integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_quests" ON public.daily_quests FOR SELECT USING (true);
CREATE POLICY "admin_manage_quests" ON public.daily_quests FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.quest_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_id uuid NOT NULL REFERENCES public.daily_quests(id) ON DELETE CASCADE,
  progress integer NOT NULL DEFAULT 0,
  claimed boolean NOT NULL DEFAULT false,
  day_key text NOT NULL, -- YYYY-MM-DD
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, quest_id, day_key)
);
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
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_achievements" ON public.user_achievements FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_view_user_achievements" ON public.user_achievements FOR SELECT USING (public.is_admin(auth.uid()));

-- ============= LOOT BOXES =============
CREATE TABLE public.lootbox_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon text NOT NULL DEFAULT '🎁',
  rarity text NOT NULL DEFAULT 'common', -- common, rare, epic, legendary
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
ALTER TABLE public.lootbox_owned ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_boxes" ON public.lootbox_owned FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_manage_all_boxes" ON public.lootbox_owned FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============= SEASONAL EVENTS =============
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
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_events" ON public.events FOR SELECT USING (true);
CREATE POLICY "admin_manage_events" ON public.events FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============= ITEMS CATALOG (ships, fish, backgrounds) =============
CREATE TABLE public.items_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL, -- 'ship','fish','background','frame'
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
ALTER TABLE public.items_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_view_catalog" ON public.items_catalog FOR SELECT USING (true);
CREATE POLICY "admin_manage_catalog" ON public.items_catalog FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============= ADMIN AUDIT LOG =============
CREATE TABLE public.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  target_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_audit_created ON public.admin_audit(created_at DESC);
CREATE POLICY "admin_view_audit" ON public.admin_audit FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY "admin_insert_audit" ON public.admin_audit FOR INSERT WITH CHECK (auth.uid() = admin_id AND public.is_admin(auth.uid()));

-- Seed some default content
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
