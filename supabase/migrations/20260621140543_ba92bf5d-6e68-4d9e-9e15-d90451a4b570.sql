
GRANT SELECT ON public.daily_quests TO anon, authenticated;
GRANT SELECT ON public.achievements TO anon, authenticated;
GRANT SELECT ON public.quest_progress TO authenticated;
GRANT SELECT ON public.user_achievements TO authenticated;
GRANT ALL ON public.quest_progress TO service_role;
GRANT ALL ON public.user_achievements TO service_role;

CREATE OR REPLACE FUNCTION public.qa_day_key()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'Asia/Riyadh')::date, 'YYYY-MM-DD')
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='quest_progress_user_quest_day_uk') THEN
    CREATE UNIQUE INDEX quest_progress_user_quest_day_uk
      ON public.quest_progress(user_id, quest_id, day_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='user_achievements_user_ach_uk') THEN
    CREATE UNIQUE INDEX user_achievements_user_ach_uk
      ON public.user_achievements(user_id, achievement_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bump_quest_progress(_user uuid, _goal_type text, _delta int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _day text := public.qa_day_key();
BEGIN
  IF _user IS NULL OR _delta IS NULL OR _delta <= 0 THEN RETURN; END IF;
  INSERT INTO public.quest_progress (user_id, quest_id, progress, claimed, day_key)
  SELECT _user, q.id, LEAST(_delta, q.goal_count), false, _day
    FROM public.daily_quests q
   WHERE q.active = true AND q.goal_type = _goal_type
  ON CONFLICT (user_id, quest_id, day_key) DO UPDATE
    SET progress = LEAST(public.quest_progress.progress + _delta,
                         (SELECT goal_count FROM public.daily_quests WHERE id = public.quest_progress.quest_id)),
        updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.bump_achievement_progress(_user uuid, _goal_type text, _delta int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user IS NULL OR _delta IS NULL OR _delta <= 0 THEN RETURN; END IF;
  INSERT INTO public.user_achievements (user_id, achievement_id, progress, claimed)
  SELECT _user, a.id, LEAST(_delta, a.goal_count), false
    FROM public.achievements a
   WHERE a.active = true AND a.goal_type = _goal_type
  ON CONFLICT (user_id, achievement_id) DO UPDATE
    SET progress = LEAST(public.user_achievements.progress + _delta,
                         (SELECT goal_count FROM public.achievements WHERE id = public.user_achievements.achievement_id));
END $$;

CREATE OR REPLACE FUNCTION public.qa_award(_user uuid, _xp int, _coins bigint, _gems int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
     SET xp = COALESCE(xp,0) + COALESCE(_xp,0),
         weekly_xp = COALESCE(weekly_xp,0) + COALESCE(_xp,0),
         coins = COALESCE(coins,0) + COALESCE(_coins,0),
         gems = COALESCE(gems,0) + COALESCE(_gems,0)
   WHERE id = _user;
END $$;

CREATE OR REPLACE FUNCTION public.claim_daily_quest(_quest_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _day text := public.qa_day_key(); _q record; _p record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO _q FROM public.daily_quests WHERE id = _quest_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'quest not found'; END IF;
  SELECT * INTO _p FROM public.quest_progress
   WHERE user_id = _uid AND quest_id = _quest_id AND day_key = _day;
  IF NOT FOUND OR _p.progress < _q.goal_count THEN RAISE EXCEPTION 'not completed'; END IF;
  IF _p.claimed THEN RAISE EXCEPTION 'already claimed'; END IF;
  UPDATE public.quest_progress SET claimed = true, updated_at = now()
   WHERE user_id = _uid AND quest_id = _quest_id AND day_key = _day;
  PERFORM public.qa_award(_uid, _q.reward_xp, _q.reward_coins, _q.reward_gems);
  RETURN jsonb_build_object('xp', _q.reward_xp, 'coins', _q.reward_coins, 'gems', _q.reward_gems);
END $$;

CREATE OR REPLACE FUNCTION public.claim_achievement(_ach_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _a record; _u record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO _a FROM public.achievements WHERE id = _ach_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'achievement not found'; END IF;
  IF _a.goal_type = 'level_reach' THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, progress, claimed)
    VALUES (_uid, _ach_id, (SELECT level FROM public.profiles WHERE id = _uid), false)
    ON CONFLICT (user_id, achievement_id) DO UPDATE
      SET progress = (SELECT level FROM public.profiles WHERE id = _uid);
  END IF;
  SELECT * INTO _u FROM public.user_achievements WHERE user_id = _uid AND achievement_id = _ach_id;
  IF NOT FOUND OR _u.progress < _a.goal_count THEN RAISE EXCEPTION 'not completed'; END IF;
  IF _u.claimed THEN RAISE EXCEPTION 'already claimed'; END IF;
  UPDATE public.user_achievements SET claimed = true, unlocked_at = now()
   WHERE user_id = _uid AND achievement_id = _ach_id;
  PERFORM public.qa_award(_uid, _a.reward_xp, _a.reward_coins, _a.reward_gems);
  RETURN jsonb_build_object('xp', _a.reward_xp, 'coins', _a.reward_coins, 'gems', _a.reward_gems);
END $$;

GRANT EXECUTE ON FUNCTION public.claim_daily_quest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_achievement(uuid) TO authenticated;

-- Triggers for auto-progress
CREATE OR REPLACE FUNCTION public.trg_fish_caught_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _delta int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _delta := COALESCE(NEW.total_caught, NEW.quantity, 0);
  ELSE
    _delta := COALESCE(NEW.total_caught,0) - COALESCE(OLD.total_caught,0);
    IF _delta <= 0 THEN
      _delta := GREATEST(COALESCE(NEW.quantity,0) - COALESCE(OLD.quantity,0), 0);
    END IF;
  END IF;
  IF _delta > 0 THEN
    PERFORM public.bump_quest_progress(NEW.user_id, 'fish', _delta);
    PERFORM public.bump_achievement_progress(NEW.user_id, 'fish', _delta);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t_fish_caught_progress ON public.fish_caught;
CREATE TRIGGER t_fish_caught_progress
AFTER INSERT OR UPDATE ON public.fish_caught
FOR EACH ROW EXECUTE FUNCTION public.trg_fish_caught_progress();

CREATE OR REPLACE FUNCTION public.trg_attack_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.attacker_id IS NOT NULL THEN
    PERFORM public.bump_quest_progress(NEW.attacker_id, 'attack', 1);
    PERFORM public.bump_achievement_progress(NEW.attacker_id, 'attack', 1);
    IF NEW.attacker_won THEN
      PERFORM public.bump_quest_progress(NEW.attacker_id, 'win', 1);
      PERFORM public.bump_achievement_progress(NEW.attacker_id, 'win', 1);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t_attack_progress ON public.attacks;
CREATE TRIGGER t_attack_progress
AFTER INSERT ON public.attacks
FOR EACH ROW EXECUTE FUNCTION public.trg_attack_progress();

CREATE OR REPLACE FUNCTION public.trg_boss_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d bigint;
BEGIN
  _d := COALESCE(NEW.total_damage,0) - COALESCE(OLD.total_damage,0);
  IF TG_OP = 'INSERT' THEN _d := COALESCE(NEW.total_damage,0); END IF;
  IF _d > 0 THEN
    PERFORM public.bump_quest_progress(NEW.user_id, 'boss_dmg', LEAST(_d,2000000000)::int);
    PERFORM public.bump_achievement_progress(NEW.user_id, 'boss_dmg', LEAST(_d,2000000000)::int);
  END IF;
  PERFORM public.bump_quest_progress(NEW.user_id, 'boss_hit', 1);
  PERFORM public.bump_achievement_progress(NEW.user_id, 'boss_hit', 1);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t_boss_progress ON public.boss_hits;
CREATE TRIGGER t_boss_progress
AFTER INSERT OR UPDATE ON public.boss_hits
FOR EACH ROW EXECUTE FUNCTION public.trg_boss_progress();

-- Seed daily quests
INSERT INTO public.daily_quests (title, description, icon, goal_type, goal_count, reward_xp, reward_coins, reward_gems, active) VALUES
('صياد اليوم','اصطد 50 سمكة اليوم','🎣','fish',50,200,500,1,true),
('صياد محترف','اصطد 200 سمكة اليوم','🐟','fish',200,600,2000,3,true),
('سيد البحار','اصطد 1000 سمكة اليوم','🐠','fish',1000,2000,10000,10,true),
('مقاتل اليوم','هاجم 5 لاعبين','⚔️','attack',5,250,800,1,true),
('غازي','هاجم 20 لاعب اليوم','🗡️','attack',20,700,3000,4,true),
('منتصر','حقق 3 انتصارات','🏆','win',3,300,1000,2,true),
('بطل اليوم','حقق 10 انتصارات','👑','win',10,1000,4000,5,true),
('صائد البوس','اضرب البوس 3 مرات','🐉','boss_hit',3,200,500,1,true),
('مدمر البوس','الحق 100,000 ضرر بالبوس','💥','boss_dmg',100000,800,2500,3,true);

-- Seed achievements
INSERT INTO public.achievements (code, title, description, icon, goal_type, goal_count, reward_xp, reward_coins, reward_gems, active, sort_order) VALUES
('fish_100','صياد مبتدئ','اصطد 100 سمكة','🐟','fish',100,500,1000,2,true,10),
('fish_1k','صياد ماهر','اصطد 1,000 سمكة','🐟','fish',1000,1500,5000,5,true,11),
('fish_10k','صياد محترف','اصطد 10,000 سمكة','🐠','fish',10000,5000,20000,15,true,12),
('fish_100k','سيد الصيد','اصطد 100,000 سمكة','🦈','fish',100000,15000,80000,40,true,13),
('fish_500k','أسطورة البحار','اصطد 500,000 سمكة','🐳','fish',500000,40000,250000,100,true,14),
('fish_1m','إمبراطور المحيط','اصطد مليون سمكة','🌊','fish',1000000,80000,600000,250,true,15),
('atk_10','مقاتل ناشئ','هاجم 10 مرات','⚔️','attack',10,400,1000,2,true,20),
('atk_100','مقاتل مخضرم','هاجم 100 مرة','⚔️','attack',100,1500,5000,6,true,21),
('atk_1k','محارب','هاجم 1,000 مرة','🗡️','attack',1000,6000,25000,20,true,22),
('atk_10k','جنرال','هاجم 10,000 مرة','🛡️','attack',10000,20000,100000,60,true,23),
('win_10','منتصر','اربح 10 معارك','🏆','win',10,500,1500,3,true,30),
('win_100','بطل','اربح 100 معركة','🏆','win',100,2000,8000,10,true,31),
('win_1k','أسطورة المعارك','اربح 1,000 معركة','👑','win',1000,8000,40000,30,true,32),
('win_5k','ملك القراصنة','اربح 5,000 معركة','👑','win',5000,25000,150000,90,true,33),
('boss_hit_10','صائد بوس','اضرب البوس 10 مرات','🐉','boss_hit',10,500,1500,3,true,40),
('boss_hit_100','مطارد التنانين','اضرب البوس 100 مرة','🐲','boss_hit',100,2500,10000,12,true,41),
('boss_dmg_1m','مدمر','الحق مليون ضرر للبوس','💥','boss_dmg',1000000,3000,12000,15,true,42),
('boss_dmg_10m','مذبحة','الحق 10 ملايين ضرر','💥','boss_dmg',10000000,10000,50000,40,true,43),
('boss_dmg_100m','قاهر التنانين','الحق 100 مليون ضرر','💀','boss_dmg',100000000,30000,200000,120,true,44),
('lvl_10','رفعة','وصول للمستوى 10','⭐','level_reach',10,500,1500,3,true,50),
('lvl_25','نجم صاعد','المستوى 25','🌟','level_reach',25,1500,5000,8,true,51),
('lvl_50','محنك','المستوى 50','💫','level_reach',50,4000,15000,20,true,52),
('lvl_100','أسطوري','المستوى 100','✨','level_reach',100,12000,50000,60,true,53),
('lvl_200','خرافي','المستوى 200','🔥','level_reach',200,30000,150000,150,true,54),
('lvl_500','إله البحار','المستوى 500','👁️','level_reach',500,80000,500000,400,true,55),
('lvl_1000','الأقدم','المستوى الأقصى 1000','♾️','level_reach',1000,200000,2000000,1000,true,56)
ON CONFLICT (code) DO NOTHING;
