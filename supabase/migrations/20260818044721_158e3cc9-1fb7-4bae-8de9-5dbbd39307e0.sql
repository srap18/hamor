CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  NEW.shield_cooldown_until := OLD.shield_cooldown_until;
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
$function$;