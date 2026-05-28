
DROP FUNCTION IF EXISTS public.get_profiles_public(uuid[]) CASCADE;
DROP FUNCTION IF EXISTS public.search_profiles_public(text,int) CASCADE;
DROP FUNCTION IF EXISTS public.get_online_players(int) CASCADE;

-- DAUGHTER
CREATE TABLE IF NOT EXISTS public.player_daughter (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'ابنتي',
  stage int NOT NULL DEFAULT 1,
  feed_xp int NOT NULL DEFAULT 0,
  total_fish_fed int NOT NULL DEFAULT 0,
  feed_count_today int NOT NULL DEFAULT 0,
  feed_day date,
  outfit text NOT NULL DEFAULT 'sailor',
  last_fed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.player_daughter TO authenticated;
GRANT ALL ON public.player_daughter TO service_role;
ALTER TABLE public.player_daughter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pd_select_own ON public.player_daughter;
DROP POLICY IF EXISTS pd_insert_own ON public.player_daughter;
DROP POLICY IF EXISTS pd_update_own ON public.player_daughter;
CREATE POLICY pd_select_own ON public.player_daughter FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY pd_insert_own ON public.player_daughter FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
CREATE POLICY pd_update_own ON public.player_daughter FOR UPDATE TO authenticated USING (auth.uid()=user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user_daughter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN INSERT INTO public.player_daughter(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING; RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW; END $$;
DROP TRIGGER IF EXISTS on_auth_user_created_daughter ON auth.users;
CREATE TRIGGER on_auth_user_created_daughter AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_daughter();
INSERT INTO public.player_daughter(user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public._daughter_stage_for(_fed int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _fed>=25000 THEN 10 WHEN _fed>=13000 THEN 9 WHEN _fed>=7000 THEN 8 WHEN _fed>=4000 THEN 7
    WHEN _fed>=2500 THEN 6 WHEN _fed>=1500 THEN 5 WHEN _fed>=800 THEN 4 WHEN _fed>=350 THEN 3 WHEN _fed>=100 THEN 2 ELSE 1 END;
$$;
CREATE OR REPLACE FUNCTION public.daughter_gem_cost(_from_stage int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _from_stage WHEN 1 THEN 80 WHEN 2 THEN 200 WHEN 3 THEN 500 WHEN 4 THEN 1200 WHEN 5 THEN 2800
    WHEN 6 THEN 6000 WHEN 7 THEN 13000 WHEN 8 THEN 28000 WHEN 9 THEN 60000 ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION public.get_my_daughter() RETURNS public.player_daughter LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT * FROM public.player_daughter WHERE user_id=auth.uid();
$$;
CREATE OR REPLACE FUNCTION public.rename_daughter(_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid:=auth.uid(); _n text;
BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF; _n:=btrim(coalesce(_name,''));
  IF char_length(_n)<1 OR char_length(_n)>20 THEN RAISE EXCEPTION 'bad name'; END IF;
  UPDATE public.player_daughter SET name=_n, updated_at=now() WHERE user_id=_uid; END $$;
CREATE OR REPLACE FUNCTION public.set_daughter_outfit(_outfit text) RETURNS public.player_daughter LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _row public.player_daughter;
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  IF _outfit NOT IN ('sailor','summer','captain','beach') THEN RAISE EXCEPTION 'bad outfit'; END IF;
  UPDATE public.player_daughter SET outfit=_outfit, updated_at=now() WHERE user_id=auth.uid() RETURNING * INTO _row; RETURN _row; END $$;
CREATE OR REPLACE FUNCTION public.upgrade_daughter_with_gems() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid:=auth.uid(); _s int; _c int; _g int;
BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  INSERT INTO public.player_daughter(user_id) VALUES(_uid) ON CONFLICT DO NOTHING;
  SELECT stage INTO _s FROM public.player_daughter WHERE user_id=_uid;
  IF _s>=10 THEN RAISE EXCEPTION 'max_stage'; END IF;
  _c:=public.daughter_gem_cost(_s); IF _c IS NULL THEN RAISE EXCEPTION 'no_cost'; END IF;
  SELECT gems INTO _g FROM public.profiles WHERE id=_uid FOR UPDATE;
  IF COALESCE(_g,0)<_c THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles SET gems=gems-_c WHERE id=_uid;
  UPDATE public.player_daughter SET stage=_s+1, updated_at=now() WHERE user_id=_uid;
  RETURN jsonb_build_object('old_stage',_s,'new_stage',_s+1,'gems_spent',_c); END $$;
CREATE OR REPLACE FUNCTION public._daughter_cashback_pct(_stage int) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _stage>=8 THEN 0.10 WHEN _stage>=5 THEN 0.05 WHEN _stage>=2 THEN 0.02 ELSE 0 END;
$$;
CREATE OR REPLACE FUNCTION public.daughter_apply_purchase_bonus(_spent_coins bigint,_spent_gems int) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid:=auth.uid(); _s int; _p numeric; _bc bigint:=0; _bg int:=0;
BEGIN IF _uid IS NULL THEN RETURN jsonb_build_object('coins',0,'gems',0); END IF;
  SELECT stage INTO _s FROM public.player_daughter WHERE user_id=_uid;
  IF _s IS NULL THEN RETURN jsonb_build_object('coins',0,'gems',0); END IF;
  _p:=public._daughter_cashback_pct(_s);
  IF _p=0 THEN RETURN jsonb_build_object('coins',0,'gems',0); END IF;
  _bc:=FLOOR(GREATEST(0,_spent_coins)*_p)::bigint; _bg:=FLOOR(GREATEST(0,_spent_gems)*_p)::int;
  IF _bc>0 OR _bg>0 THEN PERFORM public._mutate_currency(_uid,_bc,_bg,0,0); END IF;
  RETURN jsonb_build_object('coins',_bc,'gems',_bg); END $$;
CREATE OR REPLACE FUNCTION public.feed_daughter_caught(_fish_ids text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid:=auth.uid(); _count int:=0; _xp int:=0; _os int; _ns int; _nt int;
  _today date:=(now() AT TIME ZONE 'UTC')::date; _u int; _r int; _fid text; _h int; _price numeric;
BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  IF _fish_ids IS NULL OR array_length(_fish_ids,1) IS NULL THEN RAISE EXCEPTION 'no fish'; END IF;
  INSERT INTO public.player_daughter(user_id) VALUES(_uid) ON CONFLICT DO NOTHING;
  UPDATE public.player_daughter SET feed_count_today=CASE WHEN feed_day=_today THEN feed_count_today ELSE 0 END, feed_day=_today WHERE user_id=_uid;
  SELECT feed_count_today INTO _u FROM public.player_daughter WHERE user_id=_uid;
  _r:=GREATEST(0,10-COALESCE(_u,0));
  IF _r=0 THEN RAISE EXCEPTION 'daily_limit_reached'; END IF;
  FOREACH _fid IN ARRAY _fish_ids[1:_r] LOOP
    SELECT quantity INTO _h FROM public.fish_caught WHERE user_id=_uid AND fish_id=_fid;
    IF _h IS NULL OR _h<=0 THEN CONTINUE; END IF;
    IF _h<=1 THEN DELETE FROM public.fish_caught WHERE user_id=_uid AND fish_id=_fid;
    ELSE UPDATE public.fish_caught SET quantity=quantity-1, updated_at=now() WHERE user_id=_uid AND fish_id=_fid; END IF;
    SELECT current_price INTO _price FROM public.fish_market_prices WHERE fish_id=_fid;
    _xp:=_xp+GREATEST(1,COALESCE(_price,1)::int); _count:=_count+1;
  END LOOP;
  IF _count=0 THEN RAISE EXCEPTION 'no matching fish'; END IF;
  SELECT stage INTO _os FROM public.player_daughter WHERE user_id=_uid;
  UPDATE public.player_daughter SET feed_xp=feed_xp+_xp, total_fish_fed=total_fish_fed+_count,
    feed_count_today=feed_count_today+_count, feed_day=_today, last_fed_at=now(), updated_at=now()
    WHERE user_id=_uid RETURNING total_fish_fed INTO _nt;
  _ns:=public._daughter_stage_for(_nt);
  IF _ns<>_os THEN UPDATE public.player_daughter SET stage=_ns WHERE user_id=_uid; END IF;
  RETURN jsonb_build_object('fed_count',_count,'xp_gained',_xp,'old_stage',_os,'new_stage',_ns,
    'leveled_up',_ns>_os,'total_fish_fed',_nt,'remaining_today',GREATEST(0,10-(COALESCE(_u,0)+_count))); END $$;
GRANT EXECUTE ON FUNCTION public.get_my_daughter() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_daughter(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_daughter_outfit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_daughter_with_gems() TO authenticated;
GRANT EXECUTE ON FUNCTION public.feed_daughter_caught(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daughter_apply_purchase_bonus(bigint,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daughter_gem_cost(int) TO authenticated,anon;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='player_daughter') THEN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.player_daughter'; END IF; END $$;

-- PROFILE COLS
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bubble_frame text, ADD COLUMN IF NOT EXISTS profile_frame text;
GRANT UPDATE (online_at,display_name,avatar_emoji,avatar_url,avatar_frame,name_frame,bubble_frame,profile_frame,selected_bg_id) ON public.profiles TO authenticated;
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_item_type_check;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_item_type_check CHECK (item_type=ANY(ARRAY['crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame']));

-- VOICE ROOMS
CREATE TABLE IF NOT EXISTS public.voice_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, topic text NOT NULL DEFAULT '',
  created_by uuid NOT NULL, max_users int NOT NULL DEFAULT 8, is_active boolean NOT NULL DEFAULT true,
  empty_since timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.voice_rooms TO authenticated;
GRANT ALL ON public.voice_rooms TO service_role;
ALTER TABLE public.voice_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vr_select_all ON public.voice_rooms;
DROP POLICY IF EXISTS vr_insert_own ON public.voice_rooms;
DROP POLICY IF EXISTS vr_update_owner_or_admin ON public.voice_rooms;
DROP POLICY IF EXISTS vr_delete_owner_or_admin ON public.voice_rooms;
CREATE POLICY vr_select_all ON public.voice_rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY vr_insert_own ON public.voice_rooms FOR INSERT TO authenticated WITH CHECK (auth.uid()=created_by);
CREATE POLICY vr_update_owner_or_admin ON public.voice_rooms FOR UPDATE TO authenticated USING (auth.uid()=created_by OR is_admin(auth.uid()));
CREATE POLICY vr_delete_owner_or_admin ON public.voice_rooms FOR DELETE TO authenticated USING (auth.uid()=created_by OR is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.voice_room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, is_muted boolean NOT NULL DEFAULT false, is_speaker boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(), UNIQUE(room_id,user_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.voice_room_participants TO authenticated;
GRANT ALL ON public.voice_room_participants TO service_role;
ALTER TABLE public.voice_room_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vrp_select_all ON public.voice_room_participants;
DROP POLICY IF EXISTS vrp_insert_own ON public.voice_room_participants;
DROP POLICY IF EXISTS vrp_update_own ON public.voice_room_participants;
DROP POLICY IF EXISTS vrp_delete_own_or_room_owner ON public.voice_room_participants;
CREATE POLICY vrp_select_all ON public.voice_room_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY vrp_insert_own ON public.voice_room_participants FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
CREATE POLICY vrp_update_own ON public.voice_room_participants FOR UPDATE TO authenticated USING (auth.uid()=user_id);
CREATE POLICY vrp_delete_own_or_room_owner ON public.voice_room_participants FOR DELETE TO authenticated USING (
  auth.uid()=user_id OR EXISTS(SELECT 1 FROM public.voice_rooms r WHERE r.id=room_id AND r.created_by=auth.uid()) OR is_admin(auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_vrp_room ON public.voice_room_participants(room_id);

CREATE TABLE IF NOT EXISTS public.voice_room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.voice_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, text text, voice_url text, preset text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vrm_room ON public.voice_room_messages(room_id, created_at);
GRANT SELECT,INSERT ON public.voice_room_messages TO authenticated;
GRANT ALL ON public.voice_room_messages TO service_role;
ALTER TABLE public.voice_room_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vrm_select_all ON public.voice_room_messages;
DROP POLICY IF EXISTS vrm_insert_own ON public.voice_room_messages;
DROP POLICY IF EXISTS vrm_admin_delete ON public.voice_room_messages;
CREATE POLICY vrm_select_all ON public.voice_room_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY vrm_insert_own ON public.voice_room_messages FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
CREATE POLICY vrm_admin_delete ON public.voice_room_messages FOR DELETE TO authenticated USING (is_admin(auth.uid()));
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='voice_rooms') THEN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_rooms'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='voice_room_participants') THEN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_participants'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='voice_room_messages') THEN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_room_messages'; END IF;
END $$;
ALTER TABLE public.voice_room_messages REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public._voice_room_touch_empty() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _rid uuid; _cnt int;
BEGIN _rid:=COALESCE(NEW.room_id,OLD.room_id);
  SELECT COUNT(*) INTO _cnt FROM public.voice_room_participants WHERE room_id=_rid;
  IF _cnt=0 THEN UPDATE public.voice_rooms SET empty_since=now() WHERE id=_rid;
  ELSE UPDATE public.voice_rooms SET empty_since=NULL WHERE id=_rid AND empty_since IS NOT NULL; END IF;
  RETURN COALESCE(NEW,OLD); END $$;
DROP TRIGGER IF EXISTS trg_vrp_touch_empty_ins ON public.voice_room_participants;
DROP TRIGGER IF EXISTS trg_vrp_touch_empty_del ON public.voice_room_participants;
CREATE TRIGGER trg_vrp_touch_empty_ins AFTER INSERT ON public.voice_room_participants FOR EACH ROW EXECUTE FUNCTION public._voice_room_touch_empty();
CREATE TRIGGER trg_vrp_touch_empty_del AFTER DELETE ON public.voice_room_participants FOR EACH ROW EXECUTE FUNCTION public._voice_room_touch_empty();

CREATE OR REPLACE FUNCTION public.cleanup_empty_voice_rooms() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _n int;
BEGIN DELETE FROM public.voice_rooms WHERE empty_since IS NOT NULL AND empty_since < now()-INTERVAL '10 minutes';
GET DIAGNOSTICS _n=ROW_COUNT; RETURN _n; END $$;

INSERT INTO storage.buckets(id,name,public) VALUES('voice-notes','voice-notes',true) ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='voice notes public read') THEN
    CREATE POLICY "voice notes public read" ON storage.objects FOR SELECT USING(bucket_id='voice-notes'); END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='voice notes auth insert') THEN
    CREATE POLICY "voice notes auth insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='voice-notes'); END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='voice notes auth delete own') THEN
    CREATE POLICY "voice notes auth delete own" ON storage.objects FOR DELETE TO authenticated USING(bucket_id='voice-notes' AND owner=auth.uid()); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.deduct_gems_for_voice_change(_user_id uuid,_amount int DEFAULT 200) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cg int;
BEGIN SELECT gems INTO cg FROM public.profiles WHERE id=_user_id FOR UPDATE;
  IF cg IS NULL THEN RETURN jsonb_build_object('ok',false,'error','profile_not_found'); END IF;
  IF cg<_amount THEN RETURN jsonb_build_object('ok',false,'error','not_enough_gems'); END IF;
  UPDATE public.profiles SET gems=gems-_amount WHERE id=_user_id;
  RETURN jsonb_build_object('ok',true,'deducted',_amount,'remaining',cg-_amount); END $$;
GRANT EXECUTE ON FUNCTION public.deduct_gems_for_voice_change(uuid,int) TO authenticated,service_role;

-- AVATARS
INSERT INTO storage.buckets(id,name,public) VALUES('avatars','avatars',true) ON CONFLICT(id) DO UPDATE SET public=true;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='Avatars are publicly viewable') THEN
    CREATE POLICY "Avatars are publicly viewable" ON storage.objects FOR SELECT USING(bucket_id='avatars'); END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='Users upload own avatar') THEN
    CREATE POLICY "Users upload own avatar" ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='avatars' AND auth.uid()::text=(storage.foldername(name))[1]); END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='Users update own avatar') THEN
    CREATE POLICY "Users update own avatar" ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='avatars' AND auth.uid()::text=(storage.foldername(name))[1]); END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='Users delete own avatar') THEN
    CREATE POLICY "Users delete own avatar" ON storage.objects FOR DELETE TO authenticated USING(bucket_id='avatars' AND auth.uid()::text=(storage.foldername(name))[1]); END IF;
END $$;

-- ECONOMY HELPERS
CREATE OR REPLACE FUNCTION public._pay_coins_with_gem_fallback(_uid uuid,_coins_needed bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _cur record; _sf bigint; _gn int;
BEGIN IF _coins_needed<=0 THEN RETURN; END IF;
  SELECT coins,gems INTO _cur FROM public.profiles WHERE id=_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur.coins>=_coins_needed THEN UPDATE public.profiles SET coins=coins-_coins_needed WHERE id=_uid; RETURN; END IF;
  _sf:=_coins_needed-_cur.coins; _gn:=CEIL(_sf::numeric/1000.0)::int;
  IF _cur.gems<_gn THEN RAISE EXCEPTION 'insufficient'; END IF;
  UPDATE public.profiles SET coins=0,gems=gems-_gn WHERE id=_uid; END $$;
GRANT EXECUTE ON FUNCTION public._pay_coins_with_gem_fallback(uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_background(_bg_id text,_price bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid:=auth.uid();
BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  IF _price<0 OR _price>100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  PERFORM public._pay_coins_with_gem_fallback(_uid,_price);
  UPDATE public.profiles SET selected_bg_id=_bg_id WHERE id=_uid; END $$;
GRANT EXECUTE ON FUNCTION public.buy_background(text,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text,_template_id int,_price_coins bigint,_max_hp int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid:=auth.uid(); _nid uuid;
BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  IF _price_coins<0 OR _price_coins>100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp<50 OR _max_hp>1000000 THEN RAISE EXCEPTION 'bad hp'; END IF;
  PERFORM public._pay_coins_with_gem_fallback(_uid,_price_coins);
  INSERT INTO public.ships_owned(user_id,template_id,catalog_code,at_sea,hp,max_hp)
    VALUES(_uid,_template_id,_code,false,_max_hp,_max_hp) RETURNING id INTO _nid;
  RETURN _nid; END $$;
GRANT EXECUTE ON FUNCTION public.buy_ship_by_code(text,int,bigint,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.gift_gems(_recipient uuid,_amount int) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s uuid:=auth.uid(); _b int;
BEGIN IF _s IS NULL THEN RETURN jsonb_build_object('ok',false,'error','auth'); END IF;
  IF _s=_recipient THEN RETURN jsonb_build_object('ok',false,'error','self'); END IF;
  IF _amount IS NULL OR _amount<1 THEN RETURN jsonb_build_object('ok',false,'error','amount'); END IF;
  SELECT gems INTO _b FROM public.profiles WHERE id=_s FOR UPDATE;
  IF _b IS NULL OR _b<_amount THEN RETURN jsonb_build_object('ok',false,'error','insufficient'); END IF;
  UPDATE public.profiles SET gems=gems-_amount WHERE id=_s;
  UPDATE public.profiles SET gems=gems+_amount WHERE id=_recipient;
  RETURN jsonb_build_object('ok',true,'remaining',_b-_amount); END $$;
GRANT EXECUTE ON FUNCTION public.gift_gems(uuid,int) TO authenticated;

-- FISH CAUGHT
ALTER TABLE public.fish_caught ADD COLUMN IF NOT EXISTS total_caught int NOT NULL DEFAULT 0;
UPDATE public.fish_caught SET total_caught=GREATEST(total_caught,quantity);
CREATE OR REPLACE FUNCTION public.increment_fish_caught(_fish_id text,_qty int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid:=auth.uid();
BEGIN IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  INSERT INTO public.fish_caught(user_id,fish_id,quantity,total_caught) VALUES(_uid,_fish_id,_qty,_qty)
  ON CONFLICT(user_id,fish_id) DO UPDATE SET quantity=public.fish_caught.quantity+_qty,
    total_caught=public.fish_caught.total_caught+_qty, updated_at=now(); END $$;
GRANT EXECUTE ON FUNCTION public.increment_fish_caught(text,int) TO authenticated;

-- PUBLIC PROFILE RPCs
CREATE OR REPLACE FUNCTION public.get_profiles_public(_ids uuid[])
RETURNS TABLE(id uuid,display_name text,avatar_emoji text,avatar_url text,level int,xp int,
  name_frame text,avatar_frame text,bubble_frame text,profile_frame text,
  selected_bg_id text,tribe_id uuid,online_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id,display_name,avatar_emoji,avatar_url,level,xp,name_frame,avatar_frame,bubble_frame,profile_frame,
    selected_bg_id,tribe_id,online_at,created_at FROM public.profiles WHERE id=ANY(_ids);
$$;
GRANT EXECUTE ON FUNCTION public.get_profiles_public(uuid[]) TO authenticated,anon;

CREATE OR REPLACE FUNCTION public.search_profiles_public(_q text,_limit int DEFAULT 20)
RETURNS TABLE(id uuid,display_name text,avatar_emoji text,avatar_url text,level int,xp int,
  name_frame text,avatar_frame text,bubble_frame text,profile_frame text,
  selected_bg_id text,tribe_id uuid,online_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id,display_name,avatar_emoji,avatar_url,level,xp,name_frame,avatar_frame,bubble_frame,profile_frame,
    selected_bg_id,tribe_id,online_at,created_at FROM public.profiles
  WHERE display_name ILIKE '%'||_q||'%' AND id<>COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY level DESC NULLS LAST LIMIT _limit;
$$;
GRANT EXECUTE ON FUNCTION public.search_profiles_public(text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_online_players(_limit int DEFAULT 20)
RETURNS TABLE(id uuid,display_name text,avatar_emoji text,avatar_url text,level int,xp int,
  name_frame text,avatar_frame text,bubble_frame text,profile_frame text,
  selected_bg_id text,tribe_id uuid,online_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id,display_name,avatar_emoji,avatar_url,level,xp,name_frame,avatar_frame,bubble_frame,profile_frame,
    selected_bg_id,tribe_id,online_at,created_at FROM public.profiles
  WHERE online_at>=(now()-interval '5 minutes') AND id<>COALESCE(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY online_at DESC LIMIT _limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_online_players(int) TO authenticated,anon;

-- ZODIAC FRAMES PRICING
INSERT INTO public.client_item_prices(item_id,item_type,price_gems,price_coins)
SELECT i.prefix||z.suffix, i.kind, z.price, 0
FROM (VALUES ('aries',1000),('phoenix',5000),('virgo',8000),('leo',12000),
  ('taurus',18000),('gemini',25000),('scorpio',50000),('pisces',75000)) z(suffix,price)
CROSS JOIN (VALUES ('af_','frame'),('nf_','name_frame'),('bf_','bubble_frame'),('pf_','profile_frame')) i(prefix,kind)
ON CONFLICT(item_id,item_type) DO UPDATE SET price_gems=EXCLUDED.price_gems;
