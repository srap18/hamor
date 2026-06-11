
-- Helper: privileged caller = admin or no JWT (service role / SQL)
CREATE OR REPLACE FUNCTION public.is_privileged_caller()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN RETURN true; END IF;
  BEGIN RETURN public.is_admin(_uid);
  EXCEPTION WHEN OTHERS THEN RETURN false;
  END;
END;
$$;

-- profiles: whitelist cosmetic columns, revert everything else
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  NEW.id := OLD.id;
  NEW.level := OLD.level;
  NEW.xp := OLD.xp;
  NEW.coins := OLD.coins;
  NEW.gems := OLD.gems;
  NEW.rubies := OLD.rubies;
  NEW.tribe_id := OLD.tribe_id;
  NEW.protection_until := OLD.protection_until;
  NEW.steal_blocked_until := OLD.steal_blocked_until;
  NEW.vip_level := OLD.vip_level;
  NEW.vip_points := OLD.vip_points;
  NEW.vip_expires_at := OLD.vip_expires_at;
  NEW.vip_subs_claimed := OLD.vip_subs_claimed;
  NEW.bg_burned_until := OLD.bg_burned_until;
  NEW.armor_last_bought_at := OLD.armor_last_bought_at;
  NEW.last_destroyer_id := OLD.last_destroyer_id;
  NEW.last_destroyer_name := OLD.last_destroyer_name;
  NEW.last_destroyer_kind := OLD.last_destroyer_kind;
  NEW.last_destroyer_at := OLD.last_destroyer_at;
  NEW.last_destroyer_message := OLD.last_destroyer_message;
  NEW.tribe_gems := OLD.tribe_gems;
  NEW.username := OLD.username;
  NEW.username_changed_at := OLD.username_changed_at;
  NEW.media_banned := OLD.media_banned;
  NEW.weekly_xp := OLD.weekly_xp;
  NEW.referral_code := OLD.referral_code;
  NEW.referred_by := OLD.referred_by;
  NEW.referral_locked_at := OLD.referral_locked_at;
  NEW.golden_fisher_until := OLD.golden_fisher_until;
  NEW.golden_fisher_last_activated_at := OLD.golden_fisher_last_activated_at;
  NEW.elite_vip_level := OLD.elite_vip_level;
  NEW.elite_vip_expires_at := OLD.elite_vip_expires_at;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
BEFORE UPDATE ON public.profiles FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- inventory
CREATE OR REPLACE FUNCTION public.protect_inventory()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'inventory inserts require server authorization';
  END IF;
  NEW.item_id := OLD.item_id;
  NEW.item_type := OLD.item_type;
  NEW.user_id := OLD.user_id;
  NEW.meta := OLD.meta;
  IF COALESCE(NEW.quantity,0) > COALESCE(OLD.quantity,0) THEN
    NEW.quantity := OLD.quantity;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_inventory_iu ON public.inventory;
CREATE TRIGGER trg_protect_inventory_iu
BEFORE INSERT OR UPDATE ON public.inventory FOR EACH ROW
EXECUTE FUNCTION public.protect_inventory();

-- ships_owned: block ALL user writes (server-only)
CREATE OR REPLACE FUNCTION public.protect_ships_owned()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'ship purchases require server authorization';
  END IF;
  -- Block all user updates by returning OLD
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_ships_owned_iu ON public.ships_owned;
CREATE TRIGGER trg_protect_ships_owned_iu
BEFORE INSERT OR UPDATE ON public.ships_owned FOR EACH ROW
EXECUTE FUNCTION public.protect_ships_owned();

-- dragons: server-only
CREATE OR REPLACE FUNCTION public.protect_dragons()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'dragon creation requires server authorization';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_dragons_iu ON public.dragons;
CREATE TRIGGER trg_protect_dragons_iu
BEFORE INSERT OR UPDATE ON public.dragons FOR EACH ROW
EXECUTE FUNCTION public.protect_dragons();

-- dragon_equipment: server-only
CREATE OR REPLACE FUNCTION public.protect_dragon_equipment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'dragon equipment requires server authorization';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_dragon_equipment_iu ON public.dragon_equipment;
CREATE TRIGGER trg_protect_dragon_equipment_iu
BEFORE INSERT OR UPDATE ON public.dragon_equipment FOR EACH ROW
EXECUTE FUNCTION public.protect_dragon_equipment();

-- lootbox_owned: server-only inserts; quantity may only decrease
CREATE OR REPLACE FUNCTION public.protect_lootbox_owned()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'lootbox grants require server authorization';
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.box_type := OLD.box_type;
  IF COALESCE(NEW.quantity,0) > COALESCE(OLD.quantity,0) THEN
    NEW.quantity := OLD.quantity;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_lootbox_owned_iu ON public.lootbox_owned;
CREATE TRIGGER trg_protect_lootbox_owned_iu
BEFORE INSERT OR UPDATE ON public.lootbox_owned FOR EACH ROW
EXECUTE FUNCTION public.protect_lootbox_owned();

-- user_market / user_fish_market: server-only inserts, no quantity inflation
CREATE OR REPLACE FUNCTION public.protect_user_market_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new jsonb := to_jsonb(NEW);
  _old jsonb := to_jsonb(OLD);
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'market listings require server authorization';
  END IF;
  -- Block identity changes if those columns exist
  IF _new ? 'user_id'   AND _new->>'user_id'   IS DISTINCT FROM _old->>'user_id'   THEN NEW.user_id   := OLD.user_id;   END IF;
  IF _new ? 'item_id'   AND _new->>'item_id'   IS DISTINCT FROM _old->>'item_id'   THEN NEW.item_id   := OLD.item_id;   END IF;
  IF _new ? 'item_type' AND _new->>'item_type' IS DISTINCT FROM _old->>'item_type' THEN NEW.item_type := OLD.item_type; END IF;
  IF _new ? 'quantity' THEN
    IF COALESCE((_new->>'quantity')::numeric,0) > COALESCE((_old->>'quantity')::numeric,0) THEN
      NEW.quantity := OLD.quantity;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_user_market_iu ON public.user_market;
CREATE TRIGGER trg_protect_user_market_iu
BEFORE INSERT OR UPDATE ON public.user_market FOR EACH ROW
EXECUTE FUNCTION public.protect_user_market_row();

DROP TRIGGER IF EXISTS trg_protect_user_fish_market_iu ON public.user_fish_market;
CREATE TRIGGER trg_protect_user_fish_market_iu
BEFORE INSERT OR UPDATE ON public.user_fish_market FOR EACH ROW
EXECUTE FUNCTION public.protect_user_market_row();
