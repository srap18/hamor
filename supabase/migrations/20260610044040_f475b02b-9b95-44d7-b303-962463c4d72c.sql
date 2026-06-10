
-- 1) Add elite_vip_level column to profiles (server-managed only)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS elite_vip_level smallint NOT NULL DEFAULT 0
  CHECK (elite_vip_level >= 0 AND elite_vip_level <= 5);

-- 2) Zero out everyone (clean reset of old VIP + new Elite)
UPDATE public.profiles SET vip_level = 0, elite_vip_level = 0;

-- 3) Elite VIP tier configuration (admin-editable, server-authoritative)
CREATE TABLE IF NOT EXISTS public.elite_vip_tier_config (
  level smallint PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
  name_ar text NOT NULL,
  emoji text NOT NULL,
  monthly_price_usd numeric(10,2) NOT NULL,
  paddle_price_id text NOT NULL,
  combat_bonus_pct smallint NOT NULL,
  shop_discount_pct smallint NOT NULL,
  daily_gems int NOT NULL,
  name_color text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.elite_vip_tier_config TO anon, authenticated;
GRANT ALL ON public.elite_vip_tier_config TO service_role;
ALTER TABLE public.elite_vip_tier_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "elite_vip_config_public_read" ON public.elite_vip_tier_config
  FOR SELECT USING (true);
CREATE POLICY "elite_vip_config_admin_write" ON public.elite_vip_tier_config
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.elite_vip_tier_config
  (level, name_ar, emoji, monthly_price_usd, paddle_price_id, combat_bonus_pct, shop_discount_pct, daily_gems, name_color)
VALUES
  (1, 'المرساة البرونزية', '⚓', 19.00,  'elite_vip_1_monthly',  5,  5,  50, ''),
  (2, 'الدرع الفضي',       '🛡️', 29.00, 'elite_vip_2_monthly', 10, 10, 120, ''),
  (3, 'التاج الذهبي',      '👑', 49.00, 'elite_vip_3_monthly', 15, 15, 250, ''),
  (4, 'السفينة الملكية',   '⛵', 79.00, 'elite_vip_4_monthly', 20, 20, 450, '#FFD700'),
  (5, 'التنين الأسطوري',   '🐉', 99.00, 'elite_vip_5_monthly', 30, 30, 800, '#FF6B35')
ON CONFLICT (level) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  emoji = EXCLUDED.emoji,
  monthly_price_usd = EXCLUDED.monthly_price_usd,
  paddle_price_id = EXCLUDED.paddle_price_id,
  combat_bonus_pct = EXCLUDED.combat_bonus_pct,
  shop_discount_pct = EXCLUDED.shop_discount_pct,
  daily_gems = EXCLUDED.daily_gems,
  name_color = EXCLUDED.name_color,
  updated_at = now();

-- 4) Server-side helpers (SECURITY DEFINER, sole source of truth)

-- Get the authoritative elite vip level for a user (NEVER trust client input)
CREATE OR REPLACE FUNCTION public.get_elite_vip_level(_user_id uuid)
RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(elite_vip_level, 0)::smallint
  FROM public.profiles
  WHERE id = _user_id;
$$;

-- Effective combat stat multiplier (e.g. 1.15 for level 3)
CREATE OR REPLACE FUNCTION public.get_combat_multiplier(_user_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 1.0 + COALESCE(
    (SELECT combat_bonus_pct::numeric / 100.0
     FROM public.elite_vip_tier_config
     WHERE level = public.get_elite_vip_level(_user_id)),
    0
  );
$$;

-- Effective shop price (applies discount based on real DB vip level)
CREATE OR REPLACE FUNCTION public.get_effective_shop_price(_user_id uuid, _base_price numeric)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT GREATEST(0, _base_price * (1.0 - COALESCE(
    (SELECT shop_discount_pct::numeric / 100.0
     FROM public.elite_vip_tier_config
     WHERE level = public.get_elite_vip_level(_user_id)),
    0
  )));
$$;

-- 5) Realtime broadcast table for VIP 3+ global login overlay
CREATE TABLE IF NOT EXISTS public.elite_vip_login_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  elite_vip_level smallint NOT NULL,
  avatar_emoji text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.elite_vip_login_broadcasts TO authenticated, anon;
GRANT ALL ON public.elite_vip_login_broadcasts TO service_role;
ALTER TABLE public.elite_vip_login_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "elite_vip_login_broadcasts_read_all" ON public.elite_vip_login_broadcasts
  FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_elite_login_broadcasts_created
  ON public.elite_vip_login_broadcasts(created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.elite_vip_login_broadcasts;

-- Auto-cleanup old broadcasts (older than 5 minutes)
CREATE OR REPLACE FUNCTION public.cleanup_elite_login_broadcasts()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.elite_vip_login_broadcasts WHERE created_at < now() - interval '5 minutes';
$$;

-- Trigger: post a login broadcast (server-only). Called by the
-- update_my_online_at RPC when transitioning from offline → online for VIP 3+.
CREATE OR REPLACE FUNCTION public.post_elite_vip_login_broadcast()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO _profile FROM public.profiles WHERE id = auth.uid();
  IF _profile.id IS NULL OR COALESCE(_profile.elite_vip_level, 0) < 3 THEN
    RETURN;
  END IF;

  -- Throttle: don't broadcast if user already broadcast in last 10 minutes
  IF EXISTS (
    SELECT 1 FROM public.elite_vip_login_broadcasts
    WHERE user_id = _profile.id AND created_at > now() - interval '10 minutes'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.elite_vip_login_broadcasts
    (user_id, display_name, elite_vip_level, avatar_emoji, avatar_url)
  VALUES
    (_profile.id, _profile.display_name, _profile.elite_vip_level,
     _profile.avatar_emoji, _profile.avatar_url);

  PERFORM public.cleanup_elite_login_broadcasts();
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_elite_vip_login_broadcast() TO authenticated;
