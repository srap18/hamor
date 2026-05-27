
-- ============ FARM GAME — ISOLATED FROM HAMOUR ============

-- 1) PLAYERS
CREATE TABLE public.farm_players (
  user_id UUID PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  coins BIGINT NOT NULL DEFAULT 200,
  gems INTEGER NOT NULL DEFAULT 10,
  energy INTEGER NOT NULL DEFAULT 50,
  max_energy INTEGER NOT NULL DEFAULT 50,
  energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  plots_unlocked INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.farm_players TO authenticated;
GRANT ALL ON public.farm_players TO service_role;
ALTER TABLE public.farm_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY fp_select ON public.farm_players FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY fp_insert ON public.farm_players FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY fp_update ON public.farm_players FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- 2) PLOTS
CREATE TABLE public.farm_plots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slot INTEGER NOT NULL,
  crop_code TEXT,
  planted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  UNIQUE(user_id, slot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_plots TO authenticated;
GRANT ALL ON public.farm_plots TO service_role;
ALTER TABLE public.farm_plots ENABLE ROW LEVEL SECURITY;
CREATE POLICY fpl_all ON public.farm_plots FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) ANIMALS
CREATE TABLE public.farm_animals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  animal_code TEXT NOT NULL,
  fed_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_animals TO authenticated;
GRANT ALL ON public.farm_animals TO service_role;
ALTER TABLE public.farm_animals ENABLE ROW LEVEL SECURITY;
CREATE POLICY fa_all ON public.farm_animals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4) BUILDINGS
CREATE TABLE public.farm_buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  building_code TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  recipe_code TEXT,
  started_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  UNIQUE(user_id, building_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_buildings TO authenticated;
GRANT ALL ON public.farm_buildings TO service_role;
ALTER TABLE public.farm_buildings ENABLE ROW LEVEL SECURITY;
CREATE POLICY fb_all ON public.farm_buildings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5) INVENTORY
CREATE TABLE public.farm_inventory (
  user_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_inventory TO authenticated;
GRANT ALL ON public.farm_inventory TO service_role;
ALTER TABLE public.farm_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY fi_all ON public.farm_inventory FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6) DAILY QUESTS
CREATE TABLE public.farm_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  day_key DATE NOT NULL,
  quest_code TEXT NOT NULL,
  goal INTEGER NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  reward_coins INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  claimed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(user_id, day_key, quest_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_quests TO authenticated;
GRANT ALL ON public.farm_quests TO service_role;
ALTER TABLE public.farm_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY fq_all ON public.farm_quests FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ HELPER FUNCTIONS ============

-- XP needed to reach a given level (cumulative)
CREATE OR REPLACE FUNCTION public._farm_xp_for_level(_lvl INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT (_lvl * _lvl * 50)::INTEGER;
$$;

-- Apply XP and auto-level up; returns new level
CREATE OR REPLACE FUNCTION public._farm_add_xp(_uid UUID, _xp INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur_xp INTEGER;
  cur_lvl INTEGER;
  needed INTEGER;
  bonus_coins INTEGER;
  bonus_gems INTEGER;
BEGIN
  SELECT xp, level INTO cur_xp, cur_lvl FROM farm_players WHERE user_id = _uid FOR UPDATE;
  cur_xp := cur_xp + _xp;
  LOOP
    needed := public._farm_xp_for_level(cur_lvl + 1);
    EXIT WHEN cur_xp < needed OR cur_lvl >= 100;
    cur_lvl := cur_lvl + 1;
    bonus_coins := 100 + cur_lvl * 25;
    bonus_gems := CASE WHEN cur_lvl % 5 = 0 THEN 5 ELSE 1 END;
    UPDATE farm_players
      SET coins = coins + bonus_coins,
          gems = gems + bonus_gems,
          max_energy = max_energy + 2,
          energy = max_energy + 2
        WHERE user_id = _uid;
  END LOOP;
  UPDATE farm_players SET xp = cur_xp, level = cur_lvl, updated_at = now() WHERE user_id = _uid;
END $$;

-- Refill energy based on time (1 per 3 min)
CREATE OR REPLACE FUNCTION public._farm_refill_energy(_uid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e INTEGER; me INTEGER; eu TIMESTAMPTZ; gained INTEGER;
BEGIN
  SELECT energy, max_energy, energy_updated_at INTO e, me, eu FROM farm_players WHERE user_id = _uid FOR UPDATE;
  IF e >= me THEN
    UPDATE farm_players SET energy_updated_at = now() WHERE user_id = _uid;
    RETURN;
  END IF;
  gained := FLOOR(EXTRACT(EPOCH FROM (now() - eu)) / 180)::INTEGER;
  IF gained > 0 THEN
    e := LEAST(me, e + gained);
    UPDATE farm_players SET energy = e, energy_updated_at = energy_updated_at + (gained * INTERVAL '3 minutes') WHERE user_id = _uid;
  END IF;
END $$;

-- Increment quest progress for matching quest type
CREATE OR REPLACE FUNCTION public._farm_quest_inc(_uid UUID, _code TEXT, _amount INTEGER)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.farm_quests
    SET progress = LEAST(goal, progress + _amount)
    WHERE user_id = _uid AND quest_code = _code AND day_key = (now() AT TIME ZONE 'UTC')::DATE AND NOT claimed;
$$;

-- ============ PUBLIC RPCs ============

-- INIT: ensure a player exists, with starting plots
CREATE OR REPLACE FUNCTION public.farm_init()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO farm_players(user_id) VALUES (uid) ON CONFLICT DO NOTHING;
  -- Seed initial 12 plot rows (only those <= plots_unlocked are visible client-side)
  INSERT INTO farm_plots(user_id, slot)
    SELECT uid, gs FROM generate_series(1, 12) gs
    ON CONFLICT DO NOTHING;
  -- Seed a free well building
  INSERT INTO farm_buildings(user_id, building_code) VALUES (uid, 'well') ON CONFLICT DO NOTHING;
  PERFORM public._farm_refill_energy(uid);
END $$;

-- PLANT a seed in a slot
CREATE OR REPLACE FUNCTION public.farm_plant(_slot INTEGER, _crop TEXT, _grow_seconds INTEGER, _energy_cost INTEGER, _seed_cost INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); cur_e INTEGER; cur_c BIGINT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  PERFORM public._farm_refill_energy(uid);
  SELECT energy, coins INTO cur_e, cur_c FROM farm_players WHERE user_id = uid FOR UPDATE;
  IF cur_e < _energy_cost THEN RAISE EXCEPTION 'low_energy'; END IF;
  IF cur_c < _seed_cost THEN RAISE EXCEPTION 'low_coins'; END IF;
  IF EXISTS(SELECT 1 FROM farm_plots WHERE user_id = uid AND slot = _slot AND crop_code IS NOT NULL) THEN
    RAISE EXCEPTION 'plot_busy';
  END IF;
  UPDATE farm_plots
    SET crop_code = _crop, planted_at = now(), ready_at = now() + (_grow_seconds || ' seconds')::INTERVAL
    WHERE user_id = uid AND slot = _slot;
  UPDATE farm_players SET energy = energy - _energy_cost, coins = coins - _seed_cost, updated_at = now() WHERE user_id = uid;
  RETURN jsonb_build_object('ok', true);
END $$;

-- HARVEST a ready plot
CREATE OR REPLACE FUNCTION public.farm_harvest(_slot INTEGER, _xp INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); c TEXT; r TIMESTAMPTZ;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT crop_code, ready_at INTO c, r FROM farm_plots WHERE user_id = uid AND slot = _slot FOR UPDATE;
  IF c IS NULL THEN RAISE EXCEPTION 'empty_plot'; END IF;
  IF r > now() THEN RAISE EXCEPTION 'not_ready'; END IF;
  INSERT INTO farm_inventory(user_id, item_code, qty) VALUES (uid, c, 1)
    ON CONFLICT (user_id, item_code) DO UPDATE SET qty = farm_inventory.qty + 1;
  UPDATE farm_plots SET crop_code = NULL, planted_at = NULL, ready_at = NULL WHERE user_id = uid AND slot = _slot;
  PERFORM public._farm_add_xp(uid, _xp);
  PERFORM public._farm_quest_inc(uid, 'harvest', 1);
  PERFORM public._farm_quest_inc(uid, 'harvest_' || c, 1);
  RETURN jsonb_build_object('ok', true, 'item', c);
END $$;

-- BUY: insert an animal you bought
CREATE OR REPLACE FUNCTION public.farm_buy_animal(_code TEXT, _price INTEGER, _level_req INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); cur_c BIGINT; cur_lvl INTEGER;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT coins, level INTO cur_c, cur_lvl FROM farm_players WHERE user_id = uid FOR UPDATE;
  IF cur_lvl < _level_req THEN RAISE EXCEPTION 'level_locked'; END IF;
  IF cur_c < _price THEN RAISE EXCEPTION 'low_coins'; END IF;
  INSERT INTO farm_animals(user_id, animal_code, fed_at, ready_at) VALUES (uid, _code, now(), now() + INTERVAL '20 seconds');
  UPDATE farm_players SET coins = coins - _price, updated_at = now() WHERE user_id = uid;
  RETURN jsonb_build_object('ok', true);
END $$;

-- FEED + COLLECT produce from an animal
CREATE OR REPLACE FUNCTION public.farm_collect_animal(_animal_id UUID, _produce TEXT, _xp INTEGER, _cycle_seconds INTEGER, _feed_cost INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); r TIMESTAMPTZ; cur_c BIGINT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT ready_at INTO r FROM farm_animals WHERE id = _animal_id AND user_id = uid FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r > now() THEN RAISE EXCEPTION 'not_ready'; END IF;
  SELECT coins INTO cur_c FROM farm_players WHERE user_id = uid FOR UPDATE;
  IF cur_c < _feed_cost THEN RAISE EXCEPTION 'low_coins'; END IF;
  INSERT INTO farm_inventory(user_id, item_code, qty) VALUES (uid, _produce, 1)
    ON CONFLICT (user_id, item_code) DO UPDATE SET qty = farm_inventory.qty + 1;
  UPDATE farm_animals SET fed_at = now(), ready_at = now() + (_cycle_seconds || ' seconds')::INTERVAL WHERE id = _animal_id;
  UPDATE farm_players SET coins = coins - _feed_cost, updated_at = now() WHERE user_id = uid;
  PERFORM public._farm_add_xp(uid, _xp);
  PERFORM public._farm_quest_inc(uid, 'collect', 1);
  RETURN jsonb_build_object('ok', true);
END $$;

-- BUY a building (one-time)
CREATE OR REPLACE FUNCTION public.farm_buy_building(_code TEXT, _price INTEGER, _level_req INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); cur_c BIGINT; cur_lvl INTEGER;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF EXISTS(SELECT 1 FROM farm_buildings WHERE user_id = uid AND building_code = _code) THEN
    RAISE EXCEPTION 'already_owned';
  END IF;
  SELECT coins, level INTO cur_c, cur_lvl FROM farm_players WHERE user_id = uid FOR UPDATE;
  IF cur_lvl < _level_req THEN RAISE EXCEPTION 'level_locked'; END IF;
  IF cur_c < _price THEN RAISE EXCEPTION 'low_coins'; END IF;
  INSERT INTO farm_buildings(user_id, building_code) VALUES (uid, _code);
  UPDATE farm_players SET coins = coins - _price, updated_at = now() WHERE user_id = uid;
  RETURN jsonb_build_object('ok', true);
END $$;

-- START a recipe inside a building (consumes inputs)
CREATE OR REPLACE FUNCTION public.farm_start_recipe(_building TEXT, _recipe TEXT, _seconds INTEGER, _inputs JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); k TEXT; v INTEGER; cur INTEGER;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF EXISTS(SELECT 1 FROM farm_buildings WHERE user_id = uid AND building_code = _building AND recipe_code IS NOT NULL) THEN
    RAISE EXCEPTION 'busy';
  END IF;
  -- Validate inputs
  FOR k, v IN SELECT key, (value::TEXT)::INTEGER FROM jsonb_each_text(_inputs) AS t(key, value) LOOP
    SELECT qty INTO cur FROM farm_inventory WHERE user_id = uid AND item_code = k FOR UPDATE;
    IF cur IS NULL OR cur < v THEN RAISE EXCEPTION 'low_input:%', k; END IF;
  END LOOP;
  -- Consume
  FOR k, v IN SELECT key, (value::TEXT)::INTEGER FROM jsonb_each_text(_inputs) AS t(key, value) LOOP
    UPDATE farm_inventory SET qty = qty - v WHERE user_id = uid AND item_code = k;
  END LOOP;
  UPDATE farm_buildings
    SET recipe_code = _recipe, started_at = now(), ready_at = now() + (_seconds || ' seconds')::INTERVAL
    WHERE user_id = uid AND building_code = _building;
  RETURN jsonb_build_object('ok', true);
END $$;

-- COLLECT a finished recipe
CREATE OR REPLACE FUNCTION public.farm_collect_recipe(_building TEXT, _output TEXT, _xp INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); r TIMESTAMPTZ;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT ready_at INTO r FROM farm_buildings WHERE user_id = uid AND building_code = _building FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'idle'; END IF;
  IF r > now() THEN RAISE EXCEPTION 'not_ready'; END IF;
  INSERT INTO farm_inventory(user_id, item_code, qty) VALUES (uid, _output, 1)
    ON CONFLICT (user_id, item_code) DO UPDATE SET qty = farm_inventory.qty + 1;
  UPDATE farm_buildings SET recipe_code = NULL, started_at = NULL, ready_at = NULL WHERE user_id = uid AND building_code = _building;
  PERFORM public._farm_add_xp(uid, _xp);
  PERFORM public._farm_quest_inc(uid, 'produce', 1);
  RETURN jsonb_build_object('ok', true);
END $$;

-- SELL inventory items
CREATE OR REPLACE FUNCTION public.farm_sell(_item TEXT, _qty INTEGER, _unit_price INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); cur INTEGER;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'bad_qty'; END IF;
  SELECT qty INTO cur FROM farm_inventory WHERE user_id = uid AND item_code = _item FOR UPDATE;
  IF cur IS NULL OR cur < _qty THEN RAISE EXCEPTION 'low_qty'; END IF;
  UPDATE farm_inventory SET qty = qty - _qty WHERE user_id = uid AND item_code = _item;
  UPDATE farm_players SET coins = coins + (_qty * _unit_price), updated_at = now() WHERE user_id = uid;
  PERFORM public._farm_quest_inc(uid, 'sell', _qty);
  RETURN jsonb_build_object('ok', true, 'earned', _qty * _unit_price);
END $$;

-- EXPAND plots (buy more land)
CREATE OR REPLACE FUNCTION public.farm_expand(_price INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); cur_p INTEGER; cur_c BIGINT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT plots_unlocked, coins INTO cur_p, cur_c FROM farm_players WHERE user_id = uid FOR UPDATE;
  IF cur_p >= 12 THEN RAISE EXCEPTION 'max_plots'; END IF;
  IF cur_c < _price THEN RAISE EXCEPTION 'low_coins'; END IF;
  UPDATE farm_players SET coins = coins - _price, plots_unlocked = plots_unlocked + 1, updated_at = now() WHERE user_id = uid;
  RETURN jsonb_build_object('ok', true);
END $$;

-- CLAIM a completed quest
CREATE OR REPLACE FUNCTION public.farm_claim_quest(_quest_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); g INTEGER; p INTEGER; rc INTEGER; rx INTEGER; cl BOOLEAN;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT goal, progress, reward_coins, reward_xp, claimed INTO g, p, rc, rx, cl
    FROM farm_quests WHERE id = _quest_id AND user_id = uid FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF cl THEN RAISE EXCEPTION 'already_claimed'; END IF;
  IF p < g THEN RAISE EXCEPTION 'incomplete'; END IF;
  UPDATE farm_quests SET claimed = true WHERE id = _quest_id;
  UPDATE farm_players SET coins = coins + rc, updated_at = now() WHERE user_id = uid;
  PERFORM public._farm_add_xp(uid, rx);
  RETURN jsonb_build_object('ok', true, 'coins', rc, 'xp', rx);
END $$;

-- REFRESH daily quests if today's are missing
CREATE OR REPLACE FUNCTION public.farm_ensure_quests()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); today DATE := (now() AT TIME ZONE 'UTC')::DATE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF EXISTS(SELECT 1 FROM farm_quests WHERE user_id = uid AND day_key = today) THEN RETURN; END IF;
  INSERT INTO farm_quests(user_id, day_key, quest_code, goal, reward_coins, reward_xp) VALUES
    (uid, today, 'harvest', 10, 150, 30),
    (uid, today, 'collect', 5,  120, 25),
    (uid, today, 'produce', 3,  180, 40),
    (uid, today, 'sell',    20, 200, 35),
    (uid, today, 'harvest_wheat', 5, 80, 15);
END $$;

GRANT EXECUTE ON FUNCTION public.farm_init() TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_plant(INTEGER, TEXT, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_harvest(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_buy_animal(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_collect_animal(UUID, TEXT, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_buy_building(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_start_recipe(TEXT, TEXT, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_collect_recipe(TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_sell(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_expand(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_claim_quest(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.farm_ensure_quests() TO authenticated;
