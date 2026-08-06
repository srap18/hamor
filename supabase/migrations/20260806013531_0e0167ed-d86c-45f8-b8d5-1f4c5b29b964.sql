-- retry after transient deadlock
-- 1) permanent immunity state
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pvp_immunity_lifted_at timestamptz;

-- 2) helpers
CREATE OR REPLACE FUNCTION public.pvp_is_immune(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE((SELECT p.pvp_immunity_lifted_at IS NULL FROM public.profiles p WHERE p.id = _user_id), true);
$function$;

CREATE OR REPLACE FUNCTION public.pvp_attack_ready_error(_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _m int; _n int;
BEGIN
  IF _user_id IS NULL THEN RETURN 'not authenticated'; END IF;
  IF public.is_admin(_user_id) THEN RETURN NULL; END IF;
  _m := public.effective_market_level(_user_id);
  IF _m < 15 THEN
    RETURN '🛡️ أنت داخل الحصانة: تحتاج سوق سفن مستوى 15 أو أعلى للهجوم (الحالي: ' || _m::text || ').';
  END IF;
  _n := public.pvp_eligible_ship_count(_user_id, 15);
  IF _n < 3 THEN
    RETURN '🚫 لا يمكنك الهجوم: تحتاج 3 سفن مستوى 15 أو أعلى مبحرة وغير مدمّرة (' || _n::text || '/3).';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.pvp_attacker_requirement_error(_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  RETURN public.pvp_attack_ready_error(_user_id);
END $function$;

CREATE OR REPLACE FUNCTION public.pvp_defender_requirement_error(_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF public.pvp_is_immune(_user_id) THEN
    RETURN '🛡️ هذا اللاعب داخل الحصانة ولا يمكن مهاجمته.';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.pvp_pair_block_error(_attacker uuid, _defender uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _e text;
BEGIN
  IF _attacker IS NULL OR _defender IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_attacker) THEN RETURN NULL; END IF;
  _e := public.pvp_attack_ready_error(_attacker);
  IF _e IS NOT NULL THEN RETURN _e; END IF;
  IF public.pvp_is_immune(_defender) THEN
    RETURN '🛡️ هذا اللاعب داخل الحصانة ولا يمكن مهاجمته.';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.pvp_support_pair_error(_sender uuid, _recipient uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _s int; _r int;
BEGIN
  IF _sender IS NULL OR _recipient IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_sender) THEN RETURN NULL; END IF;
  _s := public.effective_market_level(_sender);
  _r := public.effective_market_level(_recipient);
  IF _s <= 14 AND _r >= 15 THEN
    RETURN '🚫 لا يمكنك إرسال الدعم لهذا اللاعب: سوق سفنك ' || _s::text || ' (داخل الحصانة) ولا يمكنك دعم لاعب سوقه 15 أو أعلى.';
  END IF;
  RETURN NULL;
END $function$;

-- 3) rewrite the client-facing check
CREATE OR REPLACE FUNCTION public.pvp_attack_check(_defender uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE _uid uuid := auth.uid(); _err text;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not authenticated'); END IF;
  IF _defender IS NULL OR _defender = _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid defender'); END IF;

  _err := public.pvp_pair_block_error(_uid, _defender);

  RETURN jsonb_build_object(
    'ok', _err IS NULL,
    'reason', _err,
    'immune', public.pvp_is_immune(_uid),
    'target_immune', public.pvp_is_immune(_defender),
    'market_level', public.effective_market_level(_uid),
    'eligible_ships_15', public.pvp_eligible_ship_count(_uid, 15)
  );
END $function$;

-- 4) patch every enforcement point: drop old bracket/gap + market<6 protection
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid; _tpl int; _repair_secs int;
  _resulting_hp int; _resulting_repair timestamptz;
  _prot timestamptz; _attacker uuid := auth.uid();
  _prev_hp int;
  _req_error text;
  _in_storage boolean;
  _destroyed_at timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM public._prep_pvp_checks(_attacker);

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100),
         COALESCE(s.in_storage, false), s.destroyed_at
    INTO _owner, _tpl, _prev_hp, _in_storage, _destroyed_at
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  IF _destroyed_at IS NOT NULL OR _prev_hp <= 0 THEN RAISE EXCEPTION 'ship already destroyed'; END IF;
  IF _in_storage THEN RAISE EXCEPTION 'ship in storage'; END IF;

  PERFORM public._prep_pvp_checks(_owner);

  IF NOT public.is_admin(_attacker) THEN
    _req_error := public.pvp_attack_ready_error(_attacker);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

    IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

    _req_error := public.pvp_pair_block_error(_attacker, _owner);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL, shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = _attacker AND protection_until IS NOT NULL;

  _repair_secs := public._ship_repair_seconds(_tpl);
  _resulting_hp := GREATEST(0, _prev_hp - GREATEST(0, _damage));
  IF _resulting_hp <= 0 THEN
    _resulting_repair := now() + make_interval(secs => _repair_secs);
    UPDATE public.ships_owned
       SET hp = 0, destroyed_at = now(), repair_ends_at = _resulting_repair,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _ship_id;
    -- Crew timers are NEVER modified by combat.
    RETURN QUERY SELECT 0, true, _resulting_repair;
  ELSE
    UPDATE public.ships_owned
       SET hp = _resulting_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT _resulting_hp, false, NULL::timestamptz;
  END IF;
END;
$function$;

DO $mig$
DECLARE r record; src text;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc LIKE '%pvp_level_gap_error%'
       AND p.proname IN ('apply_ship_damage_v2','launch_ad_bomb_impl','launch_nuke_impl','record_attack')
  LOOP
    src := replace(r.def, 'public.pvp_level_gap_error(', 'public.pvp_pair_block_error(');
    EXECUTE src;
  END LOOP;
END $mig$;

-- support pair rule inside send_support_impl
DO $mig$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'send_support_impl';
  IF src IS NOT NULL THEN
    src := replace(src,
      'public.pvp_support_requirement_error(_me, ''sender'')',
      'public.pvp_support_pair_error(_me, _recipient_id)');
    EXECUTE src;
  END IF;
END $mig$;

-- 5) first successful attack permanently lifts immunity
CREATE OR REPLACE FUNCTION public._pvp_lift_immunity_on_attack()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.attacker_id IS NOT NULL
     AND (COALESCE(NEW.damage_dealt, 0) > 0 OR COALESCE(NEW.attacker_won, false)) THEN
    UPDATE public.profiles
       SET pvp_immunity_lifted_at = now()
     WHERE id = NEW.attacker_id AND pvp_immunity_lifted_at IS NULL;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pvp_lift_immunity ON public.attacks;
CREATE TRIGGER trg_pvp_lift_immunity
AFTER INSERT ON public.attacks
FOR EACH ROW EXECUTE FUNCTION public._pvp_lift_immunity_on_attack();

-- 6) backfill: veterans (already attacked, or market 15+) are out of immunity
UPDATE public.profiles p
   SET pvp_immunity_lifted_at = now()
 WHERE p.pvp_immunity_lifted_at IS NULL
   AND (
     EXISTS (SELECT 1 FROM public.attacks a WHERE a.attacker_id = p.id AND COALESCE(a.damage_dealt,0) > 0)
     OR public.effective_market_level(p.id) >= 15
   );

-- 7) remove the old bracket system
DROP FUNCTION IF EXISTS public.pvp_level_gap_error(uuid, uuid);
DROP FUNCTION IF EXISTS public.pvp_attack_bracket(uuid);
DROP FUNCTION IF EXISTS public.pvp_defense_bracket(uuid);
DROP FUNCTION IF EXISTS public.pvp_support_requirement_error(uuid, text);