
-- ============ 1) WEAPONS: nuke / ad bomb must really damage & destroy ============
CREATE OR REPLACE FUNCTION public.launch_nuke_impl(_target_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _attack_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
  _dmg constant integer := 70000;
  _err text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  _err := public.pvp_attacker_requirement_error(_attacker);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  _err := public.pvp_defender_requirement_error(_target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _err; END IF;
  _err := public.pvp_pair_block_error(_attacker, _target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL;

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no nuke in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  _blocked := public._try_anti_block(_target_id, 'anti_nuke', 75);

  IF _blocked THEN
    PERFORM public._upsert_anti_block_notif(_target_id, 'anti_block',          _attacker, _attacker_name, 'قنبلة ذرية', 'anti_nuke');
    PERFORM public._upsert_anti_block_notif(_attacker,  'anti_block_attacker', _target_id, _target_name,  'قنبلة ذرية', 'anti_nuke');
    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('anti_block', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
            'قنبلة ذرية', '☢️');
    INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_attacker, _target_id, 0, 0, false, 0);
    RETURN NULL;
  END IF;

  WITH targets AS (
    SELECT id, template_id,
           COALESCE(hp, max_hp, 100) AS old_hp,
           LEAST(_dmg, GREATEST(COALESCE(hp, max_hp, 100), 0)) AS applied_dmg,
           GREATEST(COALESCE(hp, max_hp, 100) - _dmg, 0) AS new_hp
      FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND destroyed_at IS NULL
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = t.new_hp,
           destroyed_at = CASE WHEN t.new_hp <= 0 THEN now() ELSE s.destroyed_at END,
           repair_ends_at = CASE WHEN t.new_hp <= 0
                                 THEN now() + make_interval(secs => public._ship_repair_seconds(t.template_id))
                                 ELSE s.repair_ends_at END,
           at_sea = CASE WHEN t.new_hp <= 0 THEN false ELSE s.at_sea END,
           fishing_started_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.fishing_started_at END,
           stealing_target_user_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_user_id END,
           stealing_target_ship_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_ship_id END,
           stealing_ends_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_ends_at END
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING t.applied_dmg AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage::int, _total_damage::int, _ships_hit > 0, 0)
  RETURNING id INTO _attack_id;

  PERFORM public.stamp_global_last_attack(_attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'), 'nuke');

  RETURN _attack_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.launch_ad_bomb_impl(_target_id uuid, _video_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _bomb_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
  _dmg constant integer := 70000;
  _err text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  _err := public.pvp_attacker_requirement_error(_attacker);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  _err := public.pvp_defender_requirement_error(_target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _err; END IF;
  _err := public.pvp_pair_block_error(_attacker, _target_id);
  IF _err IS NOT NULL THEN RAISE EXCEPTION '%', _err; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL;

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  _blocked := public._try_anti_block(_target_id, 'anti_ad_bomb', 70);

  IF _blocked THEN
    PERFORM public._upsert_anti_block_notif(_target_id, 'anti_block',          _attacker, _attacker_name, 'قنبلة إعلانية', 'anti_ad_bomb');
    PERFORM public._upsert_anti_block_notif(_attacker,  'anti_block_attacker', _target_id, _target_name,  'قنبلة إعلانية', 'anti_ad_bomb');
    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('anti_block', _attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'),
            'قنبلة إعلانية', '📺');
    INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_attacker, _target_id, 0, 0, false, 0);
    RETURN NULL;
  END IF;

  WITH targets AS (
    SELECT id, template_id,
           COALESCE(hp, max_hp, 100) AS old_hp,
           LEAST(_dmg, GREATEST(COALESCE(hp, max_hp, 100), 0)) AS applied_dmg,
           GREATEST(COALESCE(hp, max_hp, 100) - _dmg, 0) AS new_hp
      FROM public.ships_owned
     WHERE user_id = _target_id
       AND COALESCE(in_storage, false) = false
       AND destroyed_at IS NULL
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = t.new_hp,
           destroyed_at = CASE WHEN t.new_hp <= 0 THEN now() ELSE s.destroyed_at END,
           repair_ends_at = CASE WHEN t.new_hp <= 0
                                 THEN now() + make_interval(secs => public._ship_repair_seconds(t.template_id))
                                 ELSE s.repair_ends_at END,
           at_sea = CASE WHEN t.new_hp <= 0 THEN false ELSE s.at_sea END,
           fishing_started_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.fishing_started_at END,
           stealing_target_user_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_user_id END,
           stealing_target_ship_id = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_target_ship_id END,
           stealing_ends_at = CASE WHEN t.new_hp <= 0 THEN NULL ELSE s.stealing_ends_at END
      FROM targets AS t
     WHERE s.id = t.id
     RETURNING t.applied_dmg AS applied
  )
  SELECT COUNT(*)::int, COALESCE(SUM(applied),0)::bigint INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.ad_bombs(attacker_id, target_user_id, video_key, started_at, expires_at, active)
  VALUES (_attacker, _target_id, _video_key, now(), now() + interval '1 hour', true)
  RETURNING id INTO _bomb_id;

  INSERT INTO public.attacks(attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage::int, _total_damage::int, _ships_hit > 0, 0)
  RETURNING id INTO _new_id;

  PERFORM public.stamp_global_last_attack(_attacker, COALESCE(_attacker_name,'لاعب'), _target_id, COALESCE(_target_name,'لاعب'), 'ad_bomb');

  RETURN _new_id;
END
$function$;

-- ============ 2) EMAIL VERIFICATION ============
-- Accounts created from the cutoff on must verify a REAL email.
-- Legacy accounts stay exempt (previous product decision).
CREATE OR REPLACE FUNCTION public.is_email_verified(_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_created timestamptz;
  v_conf timestamptz;
  v_cutoff constant timestamptz := timestamptz '2026-08-08 14:00:00+00';
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  SELECT created_at, email_confirmed_at INTO v_created, v_conf FROM auth.users WHERE id = _uid;
  IF v_created IS NULL THEN RETURN false; END IF;
  -- legacy accounts: treated as verified (grandfathered)
  IF v_created < v_cutoff THEN RETURN true; END IF;
  IF v_conf IS NULL THEN RETURN false; END IF;
  -- auto-confirmed at signup (no real click) does not count
  IF abs(extract(epoch FROM (v_conf - v_created))) < 5 THEN RETURN false; END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_email_verified()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_email_verified(auth.uid()) THEN RETURN; END IF;
  RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '42501';
END;
$function$;

-- Gate chat for unverified new accounts
CREATE OR REPLACE FUNCTION public._msg_require_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.sender_id = auth.uid()
     AND NOT public.is_email_verified(auth.uid()) THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS msg_require_verified ON public.messages;
CREATE TRIGGER msg_require_verified BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public._msg_require_verified();

-- Gate the shop RPCs (all overloads) by injecting the assert right after BEGIN
DO $inject$
DECLARE
  r record;
  src text;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('buy_with_gems','buy_with_coins','buy_with_coins_gem_fallback')
  LOOP
    IF r.def LIKE '%assert_email_verified%' THEN CONTINUE; END IF;
    src := regexp_replace(
      r.def,
      'IF _uid IS NULL THEN RAISE EXCEPTION ''not authenticated''; END IF;',
      'IF _uid IS NULL THEN RAISE EXCEPTION ''not authenticated''; END IF; PERFORM public.assert_email_verified();',
      ''
    );
    IF src <> r.def THEN EXECUTE src; END IF;
  END LOOP;
END
$inject$;

-- ============ 3) REFERRALS ============
CREATE OR REPLACE FUNCTION public.award_pending_referral_if_qualified(_invitee uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inviter uuid;
  v_level int;
  v_clean_count int;
  v_signup_gems constant int := 500;
  v_milestone_gems constant int := 2000;
  v_milestone_target constant int := 10;
  v_awarded boolean := false;
BEGIN
  IF _invitee IS NULL THEN RETURN false; END IF;
  -- Gems only for REAL verified accounts
  IF NOT public.is_email_verified(_invitee) THEN RETURN false; END IF;
  SELECT referred_by INTO v_inviter FROM public.profiles WHERE id = _invitee;
  IF v_inviter IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.referral_earnings
              WHERE inviter_id = v_inviter AND invitee_id = _invitee AND kind = 'signup') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.referral_blocked_attempts
              WHERE inviter_id = v_inviter AND invitee_id = _invitee) THEN
    RETURN false;
  END IF;
  SELECT COALESCE(level, 1) INTO v_level FROM public.user_market WHERE user_id = _invitee;
  v_level := COALESCE(v_level, 1);
  IF v_level < 6 THEN RETURN false; END IF;

  INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
  VALUES (v_inviter, _invitee, 'signup:' || _invitee::text, 0, v_signup_gems, 'signup', 'مكافأة دعوة صديق (بريد موثّق + سوق سفن 6)')
  ON CONFLICT (txn_id, inviter_id) DO NOTHING;
  IF FOUND THEN
    UPDATE public.profiles SET gems = gems + v_signup_gems WHERE id = v_inviter;
    v_awarded := true;
  END IF;

  SELECT count(*) INTO v_clean_count
    FROM public.referral_earnings WHERE inviter_id = v_inviter AND kind = 'signup';
  IF v_clean_count >= v_milestone_target THEN
    INSERT INTO public.referral_earnings (inviter_id, invitee_id, txn_id, amount_cents, gems_awarded, kind, note)
    VALUES (v_inviter, _invitee, 'milestone:10:' || v_inviter::text, 0, v_milestone_gems, 'milestone', 'مكافأة إنجاز 10 دعوات ناجحة')
    ON CONFLICT (txn_id, inviter_id) DO NOTHING;
    IF FOUND THEN
      UPDATE public.profiles SET gems = gems + v_milestone_gems WHERE id = v_inviter;
    END IF;
  END IF;
  RETURN v_awarded;
END;
$function$;

-- Called by the app right after the user confirms their email / on app boot
CREATE OR REPLACE FUNCTION public.check_my_referral_award()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN public.award_pending_referral_if_qualified(auth.uid());
END;
$function$;
GRANT EXECUTE ON FUNCTION public.check_my_referral_award() TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_inviter uuid;
  v_current uuid;
  v_matched text;
  v_reason text;
  v_clean_count int;
  v_today_count int;
  v_lifetime_cap constant int := 10;
  v_daily_cap constant int := 3;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  IF NOT public.is_email_verified(v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_not_verified');
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) < 4 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF p_device_id IS NULL OR length(p_device_id) < 32 OR length(p_device_id) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'device_required');
  END IF;

  SELECT referred_by INTO v_current FROM public.profiles WHERE id = v_me;
  IF v_current IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_referred'); END IF;

  SELECT id INTO v_inviter FROM public.profiles WHERE upper(referral_code) = upper(trim(p_code)) LIMIT 1;
  IF v_inviter IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found'); END IF;
  IF v_inviter = v_me THEN RETURN jsonb_build_object('ok', false, 'reason', 'self_referral'); END IF;

  SELECT count(*) INTO v_clean_count
    FROM public.referral_earnings WHERE inviter_id = v_inviter AND kind = 'signup';
  IF v_clean_count >= v_lifetime_cap THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, 'lifetime_cap_reached', v_clean_count::text)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'lifetime_cap_reached');
  END IF;

  SELECT count(*) INTO v_today_count
    FROM public.referral_earnings
   WHERE inviter_id = v_inviter AND kind = 'signup'
     AND created_at >= (now() - interval '24 hours');
  IF v_today_count >= v_daily_cap THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, 'daily_cap_reached', v_today_count::text)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap_reached');
  END IF;

  INSERT INTO public.device_history(device_id, user_id, first_seen, last_seen, hits)
  VALUES (p_device_id, v_me, now(), now(), 1)
  ON CONFLICT (device_id, user_id) DO UPDATE SET last_seen = now(), hits = public.device_history.hits + 1;

  -- Strict device-only anti-abuse (exact hardware hash)
  SELECT a.device_id INTO v_matched
    FROM public.device_history a
    JOIN public.device_history b ON a.device_id = b.device_id
   WHERE a.user_id = v_inviter AND b.user_id = v_me AND length(a.device_id) >= 32
   LIMIT 1;
  IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;

  -- Resolved hardware identity (survives private/incognito windows & cleared storage)
  IF v_reason IS NULL THEN
    BEGIN
      SELECT a.device_identity_id::text INTO v_matched
        FROM public.device_identity_users a
        JOIN public.device_identity_users b ON a.device_identity_id = b.device_identity_id
       WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
    EXCEPTION WHEN undefined_column OR undefined_table THEN v_matched := NULL;
    END;
  END IF;

  -- Device slots (two accounts per device) — same physical device
  IF v_reason IS NULL THEN
    BEGIN
      SELECT a.device_id INTO v_matched
        FROM public.device_slots a
        JOIN public.device_slots b ON a.device_id = b.device_id
       WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'same_device'; END IF;
    EXCEPTION WHEN undefined_column OR undefined_table THEN v_matched := NULL;
    END;
  END IF;

  IF v_reason IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.referral_earnings e
        JOIN public.device_history dh ON dh.user_id = e.invitee_id
       WHERE e.inviter_id = v_inviter AND e.kind = 'signup'
         AND dh.device_id = p_device_id AND length(dh.device_id) >= 32
    ) THEN
      v_matched := p_device_id; v_reason := 'device_already_used';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    BEGIN
      SELECT a.provider_id INTO v_matched
        FROM public.account_links a
        JOIN public.account_links b ON a.provider = b.provider AND a.provider_id = b.provider_id
       WHERE a.user_id = v_inviter AND b.user_id = v_me LIMIT 1;
      IF v_matched IS NOT NULL THEN v_reason := 'linked_account'; END IF;
    EXCEPTION WHEN undefined_column OR undefined_table THEN v_matched := NULL;
    END;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.referral_blocked_attempts (inviter_id, invitee_id, reason, matched_value)
    VALUES (v_inviter, v_me, v_reason, v_matched)
    ON CONFLICT (inviter_id, invitee_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  UPDATE public.profiles SET referred_by = v_inviter WHERE id = v_me AND referred_by IS NULL;

  PERFORM public.award_pending_referral_if_qualified(v_me);

  RETURN jsonb_build_object('ok', true, 'pending', true);
END;
$function$;
