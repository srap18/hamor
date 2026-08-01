CREATE OR REPLACE FUNCTION public.guard_inventory_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'forbidden: inventory mutations must go through server functions';
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ships_owned_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'forbidden: direct ship insert not allowed';
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ships_owned_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;

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

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_tribes_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.level IS DISTINCT FROM OLD.level
     OR NEW.treasure_coins IS DISTINCT FROM OLD.treasure_coins
     OR NEW.total_donations IS DISTINCT FROM OLD.total_donations
     OR NEW.treasure_tribe_gems IS DISTINCT FROM OLD.treasure_tribe_gems
     OR NEW.overflow_warning_until IS DISTINCT FROM OLD.overflow_warning_until
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'Not allowed to modify protected tribe columns directly';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_tribe_members_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;

  IF NEW.donation_coins IS DISTINCT FROM OLD.donation_coins
     OR NEW.last_donation_at IS DISTINCT FROM OLD.last_donation_at
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tribe_id IS DISTINCT FROM OLD.tribe_id THEN
    RAISE EXCEPTION 'Not allowed to modify protected tribe_member columns directly';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_notifications_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF current_setting('app.allow_notif', true) = 'true' THEN RETURN NEW; END IF;
  IF public.is_chat_mod(auth.uid()) AND NEW.kind = 'warning' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_messages_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN OLD; END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF OLD.sender_id = auth.uid() OR public.is_admin(auth.uid()) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'not_authorized_to_delete' USING ERRCODE = '42501';
END;
$function$;