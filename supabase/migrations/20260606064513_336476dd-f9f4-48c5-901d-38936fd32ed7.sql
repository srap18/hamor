
-- ============================================================
-- 1) Block direct UPDATE of sensitive ship fields by end-users
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_ships_owned_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow trusted contexts (SECURITY DEFINER functions run as the calling user
  -- so we additionally trust the postgres/service_role/admin contexts).
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- These columns must never change via a direct client UPDATE.
  IF NEW.template_id        IS DISTINCT FROM OLD.template_id        THEN RAISE EXCEPTION 'forbidden: template_id'; END IF;
  IF NEW.max_hp             IS DISTINCT FROM OLD.max_hp             THEN RAISE EXCEPTION 'forbidden: max_hp'; END IF;
  IF NEW.hp                 IS DISTINCT FROM OLD.hp                 THEN RAISE EXCEPTION 'forbidden: hp'; END IF;
  IF NEW.destroyed_at       IS DISTINCT FROM OLD.destroyed_at       THEN RAISE EXCEPTION 'forbidden: destroyed_at'; END IF;
  IF NEW.repair_ends_at     IS DISTINCT FROM OLD.repair_ends_at     THEN RAISE EXCEPTION 'forbidden: repair_ends_at'; END IF;
  IF NEW.fishing_started_at IS DISTINCT FROM OLD.fishing_started_at THEN RAISE EXCEPTION 'forbidden: fishing_started_at'; END IF;
  IF NEW.last_fishing_reward_at IS DISTINCT FROM OLD.last_fishing_reward_at THEN RAISE EXCEPTION 'forbidden: last_fishing_reward_at'; END IF;
  IF NEW.at_sea             IS DISTINCT FROM OLD.at_sea             THEN RAISE EXCEPTION 'forbidden: at_sea'; END IF;
  IF NEW.stealing_target_user_id IS DISTINCT FROM OLD.stealing_target_user_id THEN RAISE EXCEPTION 'forbidden: stealing_target_user_id'; END IF;
  IF NEW.stealing_target_ship_id IS DISTINCT FROM OLD.stealing_target_ship_id THEN RAISE EXCEPTION 'forbidden: stealing_target_ship_id'; END IF;
  IF NEW.stealing_ends_at   IS DISTINCT FROM OLD.stealing_ends_at   THEN RAISE EXCEPTION 'forbidden: stealing_ends_at'; END IF;
  IF NEW.user_id            IS DISTINCT FROM OLD.user_id            THEN RAISE EXCEPTION 'forbidden: user_id'; END IF;
  IF NEW.acquired_at        IS DISTINCT FROM OLD.acquired_at        THEN RAISE EXCEPTION 'forbidden: acquired_at'; END IF;

  -- Allowed: in_storage, catalog_code (cosmetic)
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_ships_owned_update ON public.ships_owned;
CREATE TRIGGER guard_ships_owned_update
BEFORE UPDATE ON public.ships_owned
FOR EACH ROW EXECUTE FUNCTION public.guard_ships_owned_update();

-- Also block direct INSERT (only RPCs should create ships)
CREATE OR REPLACE FUNCTION public.guard_ships_owned_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN RETURN NEW; END IF;
  IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'forbidden: direct ship insert not allowed';
END;$$;
DROP TRIGGER IF EXISTS guard_ships_owned_insert ON public.ships_owned;
CREATE TRIGGER guard_ships_owned_insert
BEFORE INSERT ON public.ships_owned
FOR EACH ROW EXECUTE FUNCTION public.guard_ships_owned_insert();

-- ============================================================
-- 2) Block direct UPDATE of economy fields on profiles
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_profiles_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN RETURN NEW; END IF;
  IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF;

  -- Economy / progression must come from server-side RPCs only.
  IF NEW.xp                  IS DISTINCT FROM OLD.xp                  THEN RAISE EXCEPTION 'forbidden: xp'; END IF;
  IF NEW.coins               IS DISTINCT FROM OLD.coins               THEN RAISE EXCEPTION 'forbidden: coins'; END IF;
  IF NEW.gems                IS DISTINCT FROM OLD.gems                THEN RAISE EXCEPTION 'forbidden: gems'; END IF;
  IF NEW.level               IS DISTINCT FROM OLD.level               THEN RAISE EXCEPTION 'forbidden: level'; END IF;
  IF NEW.weekly_xp           IS DISTINCT FROM OLD.weekly_xp           THEN RAISE EXCEPTION 'forbidden: weekly_xp'; END IF;
  IF NEW.tribe_gems          IS DISTINCT FROM OLD.tribe_gems          THEN RAISE EXCEPTION 'forbidden: tribe_gems'; END IF;
  IF NEW.vip_points          IS DISTINCT FROM OLD.vip_points          THEN RAISE EXCEPTION 'forbidden: vip_points'; END IF;
  IF NEW.vip_level           IS DISTINCT FROM OLD.vip_level           THEN RAISE EXCEPTION 'forbidden: vip_level'; END IF;
  IF NEW.vip_expires_at      IS DISTINCT FROM OLD.vip_expires_at      THEN RAISE EXCEPTION 'forbidden: vip_expires_at'; END IF;
  IF NEW.vip_subs_claimed    IS DISTINCT FROM OLD.vip_subs_claimed    THEN RAISE EXCEPTION 'forbidden: vip_subs_claimed'; END IF;
  IF NEW.steal_blocked_until IS DISTINCT FROM OLD.steal_blocked_until THEN RAISE EXCEPTION 'forbidden: steal_blocked_until'; END IF;
  IF NEW.armor_last_bought_at IS DISTINCT FROM OLD.armor_last_bought_at THEN RAISE EXCEPTION 'forbidden: armor_last_bought_at'; END IF;
  IF NEW.last_destroyer_id    IS DISTINCT FROM OLD.last_destroyer_id    THEN RAISE EXCEPTION 'forbidden: last_destroyer_id'; END IF;
  IF NEW.last_destroyer_name  IS DISTINCT FROM OLD.last_destroyer_name  THEN RAISE EXCEPTION 'forbidden: last_destroyer_name'; END IF;
  IF NEW.last_destroyer_kind  IS DISTINCT FROM OLD.last_destroyer_kind  THEN RAISE EXCEPTION 'forbidden: last_destroyer_kind'; END IF;
  IF NEW.last_destroyer_at    IS DISTINCT FROM OLD.last_destroyer_at    THEN RAISE EXCEPTION 'forbidden: last_destroyer_at'; END IF;
  IF NEW.last_destroyer_message IS DISTINCT FROM OLD.last_destroyer_message THEN RAISE EXCEPTION 'forbidden: last_destroyer_message'; END IF;
  IF NEW.bg_burned_until     IS DISTINCT FROM OLD.bg_burned_until     THEN RAISE EXCEPTION 'forbidden: bg_burned_until'; END IF;
  IF NEW.media_banned        IS DISTINCT FROM OLD.media_banned        THEN RAISE EXCEPTION 'forbidden: media_banned'; END IF;
  IF NEW.username            IS DISTINCT FROM OLD.username            THEN
    -- username changes should go through the dedicated RPC that enforces rate limits
    RAISE EXCEPTION 'forbidden: username (use change_username RPC)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_update ON public.profiles;
CREATE TRIGGER guard_profiles_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_update();

-- ============================================================
-- 3) Block direct INSERT/UPDATE of inventory by end-users
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_inventory_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN RETURN NEW; END IF;
  IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'forbidden: inventory mutations must go through server functions';
END;
$$;

DROP TRIGGER IF EXISTS guard_inventory_insert ON public.inventory;
CREATE TRIGGER guard_inventory_insert BEFORE INSERT ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_write();

DROP TRIGGER IF EXISTS guard_inventory_update ON public.inventory;
CREATE TRIGGER guard_inventory_update BEFORE UPDATE ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_write();

-- ============================================================
-- 4) Admin RPC to wipe ill-gotten progress from a player
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_wipe_exploit(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _deleted_stock int := 0; _deleted_caught int := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;

  DELETE FROM public.fish_stock  WHERE user_id = _user_id;
  GET DIAGNOSTICS _deleted_stock = ROW_COUNT;

  DELETE FROM public.fish_caught WHERE user_id = _user_id;
  GET DIAGNOSTICS _deleted_caught = ROW_COUNT;

  UPDATE public.profiles
     SET xp = 0, weekly_xp = 0, level = 1,
         coins = 0, gems = 0, vip_points = 0
   WHERE id = _user_id;

  UPDATE public.arena_scores SET score = 0, wins = 0 WHERE user_id = _user_id;
  DELETE FROM public.competition_catches WHERE user_id = _user_id;
  DELETE FROM public.boss_hits WHERE user_id = _user_id;

  RETURN jsonb_build_object('ok', true, 'fish_stock_deleted', _deleted_stock, 'fish_caught_deleted', _deleted_caught);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_wipe_exploit(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_wipe_exploit(uuid) TO authenticated;
