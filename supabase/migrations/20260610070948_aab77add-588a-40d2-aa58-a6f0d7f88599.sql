
-- Revert fishing-event subscription system (join + attack immunity)
-- Restores record_attack overloads, get_active_competitions, get_competition_leaderboard
-- without the requires_join / participants logic, and drops the participants table.

-- 1. Drop helper RPCs
DROP FUNCTION IF EXISTS public.join_competition(uuid);
DROP FUNCTION IF EXISTS public.get_my_fishing_event();
DROP FUNCTION IF EXISTS public.active_fishing_event_user_ids();
DROP FUNCTION IF EXISTS public.is_in_active_fishing_event(uuid);

-- 2. Drop participants table
DROP TABLE IF EXISTS public.competition_participants;

-- 3. Recreate get_active_competitions without requires_join/participants/is_joined
DROP FUNCTION IF EXISTS public.get_active_competitions();
CREATE OR REPLACE FUNCTION public.get_active_competitions()
RETURNS TABLE(
  id uuid, title text, description text, banner_emoji text, banner_text text,
  banner_theme text, metric text, target_fish_id text, hide_target boolean,
  reward_coins bigint, reward_gems integer, reward_xp integer, reward_text text,
  starts_at timestamptz, ends_at timestamptz, prize_tiers jsonb,
  prizes_distributed_at timestamptz
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
    c.starts_at, c.ends_at, c.prize_tiers, c.prizes_distributed_at
  FROM public.competitions c
  WHERE c.active = true
    AND c.starts_at <= now()
    AND c.ends_at > now() - interval '1 day'
  ORDER BY c.ends_at ASC;
END $$;

-- 4. Drop requires_join column
ALTER TABLE public.competitions DROP COLUMN IF EXISTS requires_join;

-- 5. Recreate leaderboard without participant filter
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
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'explode_damage' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(a.damage_dealt),0)::bigint
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND NOT public.is_admin(p.id)
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'fish_total' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND NOT public.is_admin(p.id)
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;

  ELSIF c.metric = 'fish_specific' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.fish_id = c.target_fish_id AND NOT public.is_admin(p.id)
    GROUP BY p.id ORDER BY 6 DESC LIMIT 100;
  END IF;
END $$;

-- 6. Restore record_attack without fishing-event blocks (both overloads)
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
  _xp := GREATEST(0, LEAST(COALESCE(_xp_gain, 0), 100000));

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

  IF _xp > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp WHERE id = _uid;
  END IF;
  RETURN _id;
END $$;
