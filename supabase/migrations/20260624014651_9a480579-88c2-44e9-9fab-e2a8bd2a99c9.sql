
DO $$ BEGIN
  CREATE TYPE public.lucky_box_rarity AS ENUM ('common','rare','legendary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Prizes
CREATE TABLE public.lucky_box_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rarity public.lucky_box_rarity NOT NULL,
  prize_type text NOT NULL CHECK (prize_type IN ('coins','gems','rubies','xp','item')),
  item_type text,
  item_id text,
  amount bigint NOT NULL DEFAULT 1 CHECK (amount > 0),
  label text NOT NULL,
  icon text NOT NULL DEFAULT '🎁',
  weight int NOT NULL DEFAULT 1 CHECK (weight > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lucky_prizes_rarity ON public.lucky_box_prizes(rarity) WHERE active;

GRANT SELECT ON public.lucky_box_prizes TO anon, authenticated;
GRANT ALL    ON public.lucky_box_prizes TO service_role;

ALTER TABLE public.lucky_box_prizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lucky_prizes_read"  ON public.lucky_box_prizes FOR SELECT USING (true);
CREATE POLICY "lucky_prizes_admin" ON public.lucky_box_prizes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Settings (singleton)
CREATE TABLE public.lucky_box_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT true,
  cost_gems int NOT NULL DEFAULT 300 CHECK (cost_gems >= 0),
  pct_common int NOT NULL DEFAULT 80 CHECK (pct_common >= 0),
  pct_rare int NOT NULL DEFAULT 18 CHECK (pct_rare >= 0),
  pct_legendary int NOT NULL DEFAULT 2 CHECK (pct_legendary >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lucky_box_settings TO anon, authenticated;
GRANT ALL    ON public.lucky_box_settings TO service_role;
ALTER TABLE public.lucky_box_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lucky_settings_read"  ON public.lucky_box_settings FOR SELECT USING (true);
CREATE POLICY "lucky_settings_admin" ON public.lucky_box_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.lucky_box_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Opens log
CREATE TABLE public.lucky_box_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prize_id uuid REFERENCES public.lucky_box_prizes(id) ON DELETE SET NULL,
  rarity public.lucky_box_rarity NOT NULL,
  label text NOT NULL,
  icon text NOT NULL DEFAULT '🎁',
  prize_type text NOT NULL,
  amount bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lucky_opens_user ON public.lucky_box_opens(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.lucky_box_opens TO authenticated;
GRANT ALL ON public.lucky_box_opens TO service_role;
ALTER TABLE public.lucky_box_opens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lucky_opens_own"   ON public.lucky_box_opens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "lucky_opens_admin" ON public.lucky_box_opens FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed a few starter prizes (admin can edit anytime)
INSERT INTO public.lucky_box_prizes (rarity, prize_type, amount, label, icon, weight) VALUES
  ('common','coins',   1000, '1,000 عملة', '🪙', 5),
  ('common','coins',   3000, '3,000 عملة', '🪙', 3),
  ('common','xp',       500, '500 XP',     '⭐', 3),
  ('common','gems',      50, '50 جوهرة',   '💎', 2),
  ('rare',  'coins',  15000, '15,000 عملة','🪙', 3),
  ('rare',  'gems',     300, '300 جوهرة',  '💎', 3),
  ('rare',  'rubies',     5, '5 ياقوت',     '❤️', 2),
  ('legendary','gems',  3000, '3,000 جوهرة','💎', 3),
  ('legendary','rubies',  50, '50 ياقوت',   '❤️', 2),
  ('legendary','coins', 200000, '200,000 عملة','🪙', 1);

-- The RPC: open one box
CREATE OR REPLACE FUNCTION public.open_lucky_box()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _s public.lucky_box_settings%ROWTYPE;
  _gems int;
  _name text;
  _r numeric;
  _total int;
  _rarity public.lucky_box_rarity;
  _prize public.lucky_box_prizes%ROWTYPE;
  _opens_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO _s FROM public.lucky_box_settings WHERE id = true;
  IF _s.enabled = false THEN RAISE EXCEPTION 'lucky_box_disabled'; END IF;

  SELECT gems, display_name INTO _gems, _name
  FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _gems IS NULL OR _gems < _s.cost_gems THEN RAISE EXCEPTION 'insufficient_gems'; END IF;

  -- Pick rarity by weighted random
  _total := GREATEST(1, COALESCE(_s.pct_common,0) + COALESCE(_s.pct_rare,0) + COALESCE(_s.pct_legendary,0));
  _r := random() * _total;
  IF _r < _s.pct_common THEN
    _rarity := 'common';
  ELSIF _r < _s.pct_common + _s.pct_rare THEN
    _rarity := 'rare';
  ELSE
    _rarity := 'legendary';
  END IF;

  -- Weighted pick a prize from that rarity; fallback to any active rarity if empty
  SELECT * INTO _prize FROM public.lucky_box_prizes
   WHERE active AND rarity = _rarity
   ORDER BY random() * weight DESC
   LIMIT 1;

  IF _prize.id IS NULL THEN
    SELECT * INTO _prize FROM public.lucky_box_prizes
     WHERE active ORDER BY random() * weight DESC LIMIT 1;
  END IF;
  IF _prize.id IS NULL THEN RAISE EXCEPTION 'no_prizes_configured'; END IF;
  _rarity := _prize.rarity;

  -- Charge gems
  UPDATE public.profiles SET gems = gems - _s.cost_gems WHERE id = _uid;

  -- Grant prize
  IF _prize.prize_type = 'coins' THEN
    UPDATE public.profiles SET coins = COALESCE(coins,0) + _prize.amount WHERE id = _uid;
  ELSIF _prize.prize_type = 'gems' THEN
    UPDATE public.profiles SET gems = COALESCE(gems,0) + _prize.amount WHERE id = _uid;
  ELSIF _prize.prize_type = 'rubies' THEN
    UPDATE public.profiles SET rubies = COALESCE(rubies,0) + _prize.amount WHERE id = _uid;
  ELSIF _prize.prize_type = 'xp' THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _prize.amount,
                                weekly_xp = COALESCE(weekly_xp,0) + _prize.amount
     WHERE id = _uid;
  ELSIF _prize.prize_type = 'item' THEN
    IF _prize.item_type IS NULL OR _prize.item_id IS NULL THEN
      RAISE EXCEPTION 'invalid_item_prize';
    END IF;
    INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
    VALUES (_uid, _prize.item_type, _prize.item_id, _prize.amount)
    ON CONFLICT (user_id, item_type, item_id) WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  END IF;

  -- Log
  INSERT INTO public.lucky_box_opens (user_id, prize_id, rarity, label, icon, prize_type, amount)
  VALUES (_uid, _prize.id, _rarity, _prize.label, _prize.icon, _prize.prize_type, _prize.amount);

  SELECT count(*)::int INTO _opens_count FROM public.lucky_box_opens WHERE user_id = _uid;

  -- Global notification for rare/legendary
  IF _rarity IN ('rare','legendary') THEN
    PERFORM set_config('app.allow_notif','true', true);
    INSERT INTO public.notifications (recipient_id, title, body, kind, meta)
    VALUES (
      NULL,
      CASE WHEN _rarity = 'legendary'
           THEN '🔴🔥 جائزة نادرة جدًا من صندوق الحظ!'
           ELSE '🔵 جائزة نادرة من صندوق الحظ!'
      END,
      'اللاعب ' || COALESCE(_name, 'قرصان') || ' حصل على ' || _prize.label || ' ' || _prize.icon,
      CASE WHEN _rarity = 'legendary' THEN 'lucky_legendary' ELSE 'lucky_rare' END,
      jsonb_build_object('rarity', _rarity, 'label', _prize.label, 'icon', _prize.icon, 'user_id', _uid)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rarity', _rarity,
    'label', _prize.label,
    'icon', _prize.icon,
    'prize_type', _prize.prize_type,
    'amount', _prize.amount,
    'opens_count', _opens_count,
    'gems_left', _gems - _s.cost_gems
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.open_lucky_box() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.open_lucky_box() FROM anon, PUBLIC;
