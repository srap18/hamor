
-- 1. Add requires_join flag to competitions
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS requires_join boolean NOT NULL DEFAULT false;

-- 2. Create participants table
CREATE TABLE IF NOT EXISTS public.competition_participants (
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, user_id)
);

CREATE INDEX IF NOT EXISTS competition_participants_user_idx
  ON public.competition_participants(user_id);

GRANT SELECT, INSERT ON public.competition_participants TO authenticated;
GRANT ALL ON public.competition_participants TO service_role;

ALTER TABLE public.competition_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants_all_view" ON public.competition_participants
  FOR SELECT USING (true);

CREATE POLICY "participants_self_insert" ON public.competition_participants
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 3. Helper: is user in an active fishing event right now?
CREATE OR REPLACE FUNCTION public.is_in_active_fishing_event(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.competition_participants cp
      JOIN public.competitions c ON c.id = cp.competition_id
     WHERE cp.user_id = _user_id
       AND c.requires_join = true
       AND c.active = true
       AND c.starts_at <= now()
       AND c.ends_at > now()
  );
$$;

-- 4. RPC: join a competition (instant)
CREATE OR REPLACE FUNCTION public.join_competition(_competition_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _c RECORD;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _c FROM public.competitions WHERE id = _competition_id;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT _c.active THEN RAISE EXCEPTION 'competition not active'; END IF;
  IF _c.ends_at <= now() THEN RAISE EXCEPTION 'competition ended'; END IF;
  IF NOT _c.requires_join THEN RAISE EXCEPTION 'competition does not require join'; END IF;
  INSERT INTO public.competition_participants(competition_id, user_id)
    VALUES (_competition_id, _uid)
    ON CONFLICT DO NOTHING;
END $$;

-- 5. RPC: get my active fishing-event protection (one row or none)
CREATE OR REPLACE FUNCTION public.get_my_fishing_event()
RETURNS TABLE(competition_id uuid, title text, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.title, c.ends_at
    FROM public.competition_participants cp
    JOIN public.competitions c ON c.id = cp.competition_id
   WHERE cp.user_id = auth.uid()
     AND c.requires_join = true
     AND c.active = true
     AND c.starts_at <= now()
     AND c.ends_at > now()
   ORDER BY c.ends_at ASC
   LIMIT 1;
$$;

-- 6. RPC: list active fishing-event participant user_ids (for chat badge)
CREATE OR REPLACE FUNCTION public.active_fishing_event_user_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT cp.user_id
    FROM public.competition_participants cp
    JOIN public.competitions c ON c.id = cp.competition_id
   WHERE c.requires_join = true
     AND c.active = true
     AND c.starts_at <= now()
     AND c.ends_at > now();
$$;

-- 7. Drop & recreate get_active_competitions to include requires_join + participants_count + is_joined
DROP FUNCTION IF EXISTS public.get_active_competitions();
CREATE OR REPLACE FUNCTION public.get_active_competitions()
RETURNS TABLE(
  id uuid, title text, description text, banner_emoji text, banner_text text,
  banner_theme text, metric text, target_fish_id text, hide_target boolean,
  reward_coins bigint, reward_gems integer, reward_xp integer, reward_text text,
  starts_at timestamptz, ends_at timestamptz, prize_tiers jsonb,
  prizes_distributed_at timestamptz,
  requires_join boolean, participants_count integer, is_joined boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  BEGIN PERFORM public.finalize_due_competitions(); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN QUERY
  SELECT
    c.id, c.title, c.description, c.banner_emoji, c.banner_text, c.banner_theme,
    c.metric,
    CASE WHEN c.hide_target AND NOT is_admin(_uid) THEN NULL ELSE c.target_fish_id END,
    c.hide_target,
    c.reward_coins, c.reward_gems, c.reward_xp, c.reward_text,
    c.starts_at, c.ends_at, c.prize_tiers, c.prizes_distributed_at,
    c.requires_join,
    COALESCE((SELECT COUNT(*)::int FROM public.competition_participants p WHERE p.competition_id = c.id), 0),
    EXISTS (SELECT 1 FROM public.competition_participants p WHERE p.competition_id = c.id AND p.user_id = _uid)
  FROM public.competitions c
  WHERE c.active = true
    AND c.starts_at <= now()
    AND c.ends_at > now() - interval '1 day'
  ORDER BY c.ends_at ASC;
END $$;

-- 8. Update leaderboard: when requires_join=true, only show participants
CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(_competition_id uuid)
RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, score bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id;
  IF c IS NULL THEN RETURN; END IF;

  IF c.metric = 'explode_count' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, COUNT(*)::bigint
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND a.damage_dealt > 0 AND NOT public.is_admin(p.id)
      AND (NOT c.requires_join OR EXISTS (
        SELECT 1 FROM public.competition_participants cp
         WHERE cp.competition_id = c.id AND cp.user_id = p.id))
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'explode_damage' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(a.damage_dealt),0)::bigint
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND NOT public.is_admin(p.id)
      AND (NOT c.requires_join OR EXISTS (
        SELECT 1 FROM public.competition_participants cp
         WHERE cp.competition_id = c.id AND cp.user_id = p.id))
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'fish_total' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND NOT public.is_admin(p.id)
      AND (NOT c.requires_join OR EXISTS (
        SELECT 1 FROM public.competition_participants cp
         WHERE cp.competition_id = c.id AND cp.user_id = p.id))
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'fish_specific' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.fish_id = c.target_fish_id AND NOT public.is_admin(p.id)
      AND (NOT c.requires_join OR EXISTS (
        SELECT 1 FROM public.competition_participants cp
         WHERE cp.competition_id = c.id AND cp.user_id = p.id))
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;
  END IF;
END $$;

-- 9. Block PvP for users in active fishing event (record_attack — both overloads)
CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid, _target_ship_id uuid, _damage integer,
  _damage_dealt integer, _attacker_won boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _id uuid; _def_prot timestamptz; _def_gf timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  IF public.is_in_active_fishing_event(_uid) THEN
    RAISE EXCEPTION 'attacker_in_fishing_event';
  END IF;
  IF public.is_in_active_fishing_event(_defender_id) THEN
    RAISE EXCEPTION 'defender_in_fishing_event';
  END IF;

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf
    FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now())
     OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
    SET protection_until = NULL
    WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now()
      AND (golden_fisher_until IS NULL OR golden_fisher_until <= now());

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid, _target_ship_id uuid, _damage integer,
  _damage_dealt integer, _attacker_won boolean, _xp_gain integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _id uuid; _xp int; _def_prot timestamptz; _def_gf timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  IF public.is_in_active_fishing_event(_uid) THEN
    RAISE EXCEPTION 'attacker_in_fishing_event';
  END IF;
  IF public.is_in_active_fishing_event(_defender_id) THEN
    RAISE EXCEPTION 'defender_in_fishing_event';
  END IF;

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf
    FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now())
     OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
    SET protection_until = NULL
    WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now()
      AND (golden_fisher_until IS NULL OR golden_fisher_until <= now());

  _xp := GREATEST(0, LEAST(COALESCE(_xp_gain, 0), 10000));

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;

  IF _xp > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);
  END IF;
  RETURN _id;
END $$;

-- 10. Block damage at apply_ship_damage — wrap original logic with new guards.
--     We inject the two checks right after the attacker market gate.
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _owner uuid;
  _tpl int;
  _repair_secs int;
  _resulting_hp int;
  _resulting_repair timestamptz;
  _prot timestamptz;
  _attacker uuid := auth.uid();
  _prev_hp int;
  _dmg_dealt int;
  _xp_gain int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100)
    INTO _owner, _tpl, _prev_hp
    FROM public.ships_owned s
   WHERE s.id = _ship_id;

  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  -- Fishing-event protection (new)
  IF public.is_in_active_fishing_event(_attacker) THEN
    RAISE EXCEPTION 'attacker_in_fishing_event';
  END IF;
  IF public.is_in_active_fishing_event(_owner) THEN
    RAISE EXCEPTION 'defender_in_fishing_event';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;

  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _attacker AND in_storage = false AND destroyed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'attacker has destroyed ship';
  END IF;

  IF NOT public.has_fishing_ship(_attacker) THEN
    RAISE EXCEPTION 'attacker needs fishing ship: send a ship to fish first';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_owner) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'protected';
  END IF;

  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(14400, GREATEST(60,
    ROUND(60 + (LEAST(30, GREATEST(1, _tpl)) - 1) * (14400 - 60) / 29.0)::int
  ));

  UPDATE public.ships_owned AS s
     SET hp = s.max_hp, destroyed_at = NULL, repair_ends_at = NULL
   WHERE s.id = _ship_id
     AND s.destroyed_at IS NOT NULL
     AND s.repair_ends_at IS NOT NULL
     AND s.repair_ends_at <= now();

  SELECT COALESCE(hp, 100) INTO _prev_hp FROM public.ships_owned WHERE id = _ship_id;

  UPDATE public.ships_owned AS s
     SET hp = GREATEST(0, COALESCE(s.hp, 100) - _damage),
         destroyed_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
           THEN now() ELSE s.destroyed_at END,
         repair_ends_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
           THEN now() + (_repair_secs || ' seconds')::interval
           ELSE s.repair_ends_at END
   WHERE s.id = _ship_id
   RETURNING s.hp, s.repair_ends_at INTO _resulting_hp, _resulting_repair;

  RETURN QUERY SELECT _resulting_hp, (_resulting_hp = 0), _resulting_repair;
END
$function$;

-- 11. Schedule auto-finalization every 5 minutes via pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  PERFORM cron.unschedule('finalize-due-competitions');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'finalize-due-competitions',
  '*/5 * * * *',
  $$ SELECT public.finalize_due_competitions(); $$
);

-- 12. Distribute previously-stuck competition right now
SELECT public.finalize_competition('eb1d7b95-4bee-4ef3-8813-683758cfff35');
