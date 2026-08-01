CREATE OR REPLACE FUNCTION public.guard_server_only_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'forbidden: % on % must go through game server logic', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS guard_server_only_user_market_state ON public.user_market_state;
CREATE TRIGGER guard_server_only_user_market_state
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_market_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_write();

DROP TRIGGER IF EXISTS guard_server_only_user_fish_market ON public.user_fish_market;
CREATE TRIGGER guard_server_only_user_fish_market
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_fish_market
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_write();

DROP TRIGGER IF EXISTS guard_server_only_daily_login_streaks ON public.daily_login_streaks;
CREATE TRIGGER guard_server_only_daily_login_streaks
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_login_streaks
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_write();

DROP TRIGGER IF EXISTS guard_server_only_player_daughter ON public.player_daughter;
CREATE TRIGGER guard_server_only_player_daughter
  BEFORE INSERT OR UPDATE OR DELETE ON public.player_daughter
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_write();

DROP TRIGGER IF EXISTS guard_server_only_support_gifts ON public.support_gifts;
CREATE TRIGGER guard_server_only_support_gifts
  BEFORE INSERT OR UPDATE OR DELETE ON public.support_gifts
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_write();

DROP TRIGGER IF EXISTS guard_server_only_tribe_achievements ON public.tribe_achievements;
CREATE TRIGGER guard_server_only_tribe_achievements
  BEFORE INSERT OR UPDATE OR DELETE ON public.tribe_achievements
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_write();

CREATE OR REPLACE FUNCTION public.protect_lootbox_owned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_privileged_caller() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'lootbox grants require server authorization' USING ERRCODE = '42501';
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.type_id := OLD.type_id;
  NEW.reward  := OLD.reward;
  NEW.acquired_at := OLD.acquired_at;
  IF COALESCE(OLD.opened, false) AND NOT COALESCE(NEW.opened, false) THEN
    NEW.opened := OLD.opened;
  END IF;
  RETURN NEW;
END;
$function$;