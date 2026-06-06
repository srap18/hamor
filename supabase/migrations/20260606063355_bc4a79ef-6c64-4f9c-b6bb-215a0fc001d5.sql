
-- Reliable global banner table that all clients subscribe to via realtime.
CREATE TABLE IF NOT EXISTS public.global_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                  -- 'nuke' | 'ad_bomb' | 'admin'
  attacker_id uuid,
  attacker_name text,
  target_id uuid,
  target_name text,
  message text,
  emoji text,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.global_banners TO authenticated, anon;
GRANT ALL ON public.global_banners TO service_role;

ALTER TABLE public.global_banners ENABLE ROW LEVEL SECURITY;

-- Anyone (logged in or not) can read banners — they are intentionally global.
DROP POLICY IF EXISTS "global_banners read all" ON public.global_banners;
CREATE POLICY "global_banners read all" ON public.global_banners
  FOR SELECT TO anon, authenticated USING (true);

-- No client INSERT; only SECURITY DEFINER functions write rows.

ALTER PUBLICATION supabase_realtime ADD TABLE public.global_banners;
ALTER TABLE public.global_banners REPLICA IDENTITY FULL;

-- Helper to push a banner row (callable from other SECURITY DEFINER fns).
CREATE OR REPLACE FUNCTION public.push_global_banner(
  _kind text, _attacker_id uuid, _attacker_name text,
  _target_id uuid, _target_name text, _message text,
  _emoji text DEFAULT NULL, _title text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji, title)
  VALUES (_kind, _attacker_id, _attacker_name, _target_id, _target_name, _message, _emoji, _title);
$$;

-- Update broadcast_nuke to also write a global banner row.
CREATE OR REPLACE FUNCTION public.broadcast_nuke(_target_id uuid, _message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _attacker uuid := auth.uid(); _msg text; _recent_nuke_count int; _attacker_name text; _target_name text;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'invalid target'; END IF;
  _msg := btrim(coalesce(_message, ''));
  IF char_length(_msg) < 20 THEN RAISE EXCEPTION 'message must be at least 20 characters'; END IF;
  IF char_length(_msg) > 200 THEN _msg := substring(_msg, 1, 200); END IF;
  SELECT COUNT(*) INTO _recent_nuke_count FROM public.attacks
   WHERE attacker_id = _attacker AND defender_id = _target_id AND created_at > now() - interval '5 minutes';
  IF _recent_nuke_count = 0 THEN RAISE EXCEPTION 'no recent attack found'; END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  UPDATE public.profiles SET last_destroyer_message = _msg WHERE id = _target_id;

  INSERT INTO public.destroyer_messages (defender_id, attacker_id, attacker_name, kind, message)
  VALUES (_target_id, _attacker, _attacker_name, 'nuke', _msg);

  -- Global banner for ALL players
  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
  VALUES ('nuke', _attacker, COALESCE(_attacker_name, 'لاعب'), _target_id, COALESCE(_target_name, 'لاعب'), _msg, '☢️');
END; $function$;

-- Update launch_ad_bomb to also write a global banner row.
CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _xp_award integer;
  _attacker_name text;
  _target_name text;
  _prot timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  SELECT quantity INTO _qty FROM public.inventory
  WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
    WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  WITH hit AS (
    UPDATE public.ships_owned
    SET hp = 0, destroyed_at = now(), repair_ends_at = now() + interval '6 hours',
        at_sea = false, fishing_started_at = NULL,
        stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
    WHERE user_id = _target_id AND destroyed_at IS NULL
    RETURNING id, max_hp
  )
  SELECT count(*), COALESCE(SUM(max_hp), 0) INTO _ships_hit, _qty FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, 999999, COALESCE(_qty, 0), true);

  _xp_award := 250 * GREATEST(_ships_hit, 0);
  IF _xp_award > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp_award WHERE id = _attacker;
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;
  UPDATE public.profiles
    SET last_destroyer_id = _attacker,
        last_destroyer_name = COALESCE(_attacker_name, 'لاعب'),
        last_destroyer_kind = 'ad_bomb',
        last_destroyer_at = now()
   WHERE id = _target_id;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key, expires_at)
  VALUES (_target_id, _attacker, _video_key, now() + interval '1 hour')
  RETURNING id INTO _new_id;

  -- Global banner for ALL players
  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
  VALUES ('ad_bomb', _attacker, COALESCE(_attacker_name, 'لاعب'), _target_id, COALESCE(_target_name, 'لاعب'), NULL, '📺');

  RETURN _new_id;
END;
$function$;

-- Auto-cleanup old banner rows (keep last hour only)
CREATE OR REPLACE FUNCTION public.cleanup_global_banners() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.global_banners WHERE created_at < now() - interval '1 hour';
$$;
