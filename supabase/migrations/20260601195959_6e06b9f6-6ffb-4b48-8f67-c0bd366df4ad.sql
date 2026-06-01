
-- ════════════════════════════════════════════════════════════════
-- 1) إخفاء الإداريين من جميع الترتيبات على مستوى قاعدة البيانات
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_currency_leaderboard(_col text, _limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, xp integer, name_frame text, avatar_frame text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _col NOT IN ('coins','gems','xp') THEN
    RAISE EXCEPTION 'invalid column';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, p.xp, p.name_frame, p.avatar_frame
     FROM public.profiles p
     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN (''admin''::app_role,''moderator''::app_role))
     ORDER BY p.%I DESC NULLS LAST LIMIT $1', _col
  ) USING _limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_fish_leaderboard(_limit integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, avatar_frame text, name_frame text, unique_fish integer, total_fish bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, p.avatar_frame, p.name_frame,
         COUNT(DISTINCT fc.fish_id)::int AS unique_fish,
         COALESCE(SUM(fc.total_caught),0)::bigint AS total_fish
    FROM public.profiles p
    LEFT JOIN public.fish_caught fc ON fc.user_id = p.id
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('admin','moderator'))
   GROUP BY p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, p.avatar_frame, p.name_frame
  HAVING COALESCE(SUM(fc.total_caught),0) > 0
   ORDER BY total_fish DESC, unique_fish DESC
   LIMIT GREATEST(1, LEAST(_limit, 100));
$function$;

CREATE OR REPLACE FUNCTION public.get_ship_market_leaderboard(_limit integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, avatar_frame text, name_frame text, market_level integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
         p.avatar_frame, p.name_frame, um.level AS market_level
    FROM public.user_market um
    JOIN public.profiles p ON p.id = um.user_id
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('admin','moderator'))
   ORDER BY um.level DESC, um.updated_at ASC
   LIMIT GREATEST(1, LEAST(_limit, 100));
$function$;


-- ════════════════════════════════════════════════════════════════
-- 2) نظام VIP المحدّث — فرق ×2، احذف أولوية الدعم
-- ════════════════════════════════════════════════════════════════

-- VIP gems daily — مضاعف ×2
CREATE OR REPLACE FUNCTION public.claim_vip_daily()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_level INTEGER;
  v_gems INTEGER;
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.effective_vip_level(v_user);
  IF v_level < 1 THEN RAISE EXCEPTION 'no_vip'; END IF;

  v_gems := CASE v_level
    WHEN 1 THEN 100   WHEN 2 THEN 250   WHEN 3 THEN 500   WHEN 4 THEN 800
    WHEN 5 THEN 1200  WHEN 6 THEN 1800  WHEN 7 THEN 2500  WHEN 8 THEN 3500
    WHEN 9 THEN 5000  WHEN 10 THEN 8000 ELSE 0 END;

  BEGIN
    INSERT INTO public.vip_daily_claims(user_id, claim_date, vip_level, gems_awarded)
    VALUES (v_user, v_today, v_level, v_gems);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_claimed_today';
  END;

  PERFORM public._mutate_currency(v_user, 0, v_gems, 0, 0);
  RETURN jsonb_build_object('ok', true, 'gems', v_gems, 'level', v_level);
END;
$function$;


-- ════════════════════════════════════════════════════════════════
-- 3) درع VIP يومي قابل للتكديس (1 ساعة لكل درع، يروح للمخزن)
--    VIP 5+: 1 درع/يوم | VIP 7+: 2 | VIP 9+: 3
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vip_shield_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  claim_date date NOT NULL,
  shields_awarded integer NOT NULL DEFAULT 1,
  vip_level integer NOT NULL,
  UNIQUE(user_id, claim_date)
);
GRANT SELECT ON public.vip_shield_claims TO authenticated;
GRANT ALL ON public.vip_shield_claims TO service_role;
ALTER TABLE public.vip_shield_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY vsc_select_own ON public.vip_shield_claims FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_vip_shield()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_level int;
  v_count int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.effective_vip_level(v_user);
  IF v_level < 5 THEN RAISE EXCEPTION 'need_vip_5'; END IF;
  v_count := CASE WHEN v_level >= 9 THEN 3 WHEN v_level >= 7 THEN 2 ELSE 1 END;

  BEGIN
    INSERT INTO public.vip_shield_claims(user_id, claim_date, shields_awarded, vip_level)
    VALUES (v_user, v_today, v_count, v_level);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_claimed_today';
  END;

  INSERT INTO public.inventory(user_id, item_id, item_type, quantity)
  VALUES (v_user, 'shield_1h', 'shield', v_count)
  ON CONFLICT (user_id, item_id, item_type) DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'count', v_count, 'level', v_level);
EXCEPTION WHEN unique_violation THEN
  -- fallback لو ما في UNIQUE constraint على المخزن
  UPDATE public.inventory SET quantity = quantity + v_count
   WHERE user_id = v_user AND item_id = 'shield_1h' AND item_type = 'shield';
  IF NOT FOUND THEN
    INSERT INTO public.inventory(user_id, item_id, item_type, quantity)
    VALUES (v_user, 'shield_1h', 'shield', v_count);
  END IF;
  RETURN jsonb_build_object('ok', true, 'count', v_count, 'level', v_level);
END;
$function$;

-- استعمال درع من المخزن
CREATE OR REPLACE FUNCTION public.use_shield_from_inventory(_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_hours int;
  v_new timestamptz;
  v_qty int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_hours := CASE _item_id
    WHEN 'shield_1h' THEN 1
    WHEN 'shield_4h' THEN 4
    WHEN 'shield_1d' THEN 24
    WHEN 'shield_2d' THEN 48
    ELSE 0 END;
  IF v_hours = 0 THEN RAISE EXCEPTION 'invalid_shield'; END IF;

  SELECT quantity INTO v_qty FROM public.inventory
   WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield' LIMIT 1;
  IF v_qty IS NULL OR v_qty < 1 THEN RAISE EXCEPTION 'not_enough'; END IF;

  -- خصم 1
  IF v_qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
     WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield';
  END IF;

  SELECT GREATEST(now(), COALESCE(protection_until, now())) + make_interval(hours => v_hours)
    INTO v_new FROM public.profiles WHERE id = v_user;
  UPDATE public.profiles SET protection_until = v_new WHERE id = v_user;

  RETURN jsonb_build_object('ok', true, 'until', v_new, 'hours', v_hours);
END;
$function$;


-- ════════════════════════════════════════════════════════════════
-- 4) صندوق ملكي يومي (VIP 9+) — كل الطواقم + كل الصواريخ للمخزن
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.royal_box_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  claim_date date NOT NULL,
  contents jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(user_id, claim_date)
);
GRANT SELECT ON public.royal_box_claims TO authenticated;
GRANT ALL ON public.royal_box_claims TO service_role;
ALTER TABLE public.royal_box_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY rbc_select_own ON public.royal_box_claims FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_royal_box()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_level int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_crews text[] := ARRAY['luck','thief','police','trader','guide','sailor','fixer_1','fixer_2','fixer_3','fixer_4'];
  v_weapons text[] := ARRAY['rocket_small','rocket_medium','rocket_large','nuke'];
  v_item text;
  v_contents jsonb := '{}'::jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.effective_vip_level(v_user);
  IF v_level < 9 THEN RAISE EXCEPTION 'need_vip_9'; END IF;

  BEGIN
    INSERT INTO public.royal_box_claims(user_id, claim_date, contents) VALUES (v_user, v_today, '{}');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_claimed_today';
  END;

  -- إضافة كل طاقم
  FOREACH v_item IN ARRAY v_crews LOOP
    UPDATE public.inventory SET quantity = quantity + 1
     WHERE user_id = v_user AND item_id = v_item AND item_type = 'crew';
    IF NOT FOUND THEN
      INSERT INTO public.inventory(user_id, item_id, item_type, quantity) VALUES (v_user, v_item, 'crew', 1);
    END IF;
    v_contents := v_contents || jsonb_build_object(v_item, 1);
  END LOOP;

  -- إضافة كل صاروخ
  FOREACH v_item IN ARRAY v_weapons LOOP
    UPDATE public.inventory SET quantity = quantity + 1
     WHERE user_id = v_user AND item_id = v_item AND item_type = 'weapon';
    IF NOT FOUND THEN
      INSERT INTO public.inventory(user_id, item_id, item_type, quantity) VALUES (v_user, v_item, 'weapon', 1);
    END IF;
    v_contents := v_contents || jsonb_build_object(v_item, 1);
  END LOOP;

  UPDATE public.royal_box_claims SET contents = v_contents WHERE user_id = v_user AND claim_date = v_today;
  RETURN jsonb_build_object('ok', true, 'contents', v_contents);
END;
$function$;


-- ════════════════════════════════════════════════════════════════
-- 5) إطار كوني VIP حصري — يتم منحه تلقائياً للمستوى 10
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.grant_cosmic_frame()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid(); v_level int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.effective_vip_level(v_user);
  IF v_level < 10 THEN RAISE EXCEPTION 'need_vip_10'; END IF;

  INSERT INTO public.inventory(user_id, item_id, item_type, quantity)
  SELECT v_user, 'af_cosmic_vip', 'frame', 1
   WHERE NOT EXISTS (SELECT 1 FROM public.inventory
                      WHERE user_id = v_user AND item_id = 'af_cosmic_vip' AND item_type = 'frame');
  RETURN jsonb_build_object('ok', true);
END;
$function$;
