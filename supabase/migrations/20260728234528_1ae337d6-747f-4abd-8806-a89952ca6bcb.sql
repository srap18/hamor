
-- ==========================================================
-- 1) Legacy proof table (persistent source of truth)
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.legacy_cosmetics (
  user_id   uuid NOT NULL,
  item_type text NOT NULL,
  item_id   text NOT NULL,
  reason    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
);

GRANT SELECT ON public.legacy_cosmetics TO authenticated;
GRANT ALL ON public.legacy_cosmetics TO service_role;

ALTER TABLE public.legacy_cosmetics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legacy_cosmetics_read_own" ON public.legacy_cosmetics;
CREATE POLICY "legacy_cosmetics_read_own"
ON public.legacy_cosmetics FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- ==========================================================
-- 2) Populate legacy_cosmetics from every trustworthy source
-- ==========================================================
-- (a) Current inventory rows still marked as acquired before cutoff
INSERT INTO public.legacy_cosmetics (user_id, item_type, item_id, reason)
SELECT DISTINCT i.user_id, i.item_type, i.item_id, 'inventory_pre_cutoff'
FROM public.inventory i
WHERE i.item_type IN ('frame','name_frame','bubble_frame','profile_frame','background')
  AND i.acquired_at < timestamptz '2026-07-19 05:00:00+03'
ON CONFLICT DO NOTHING;

-- (b) Code redemptions proven before cutoff (survives acquired_at bugs)
INSERT INTO public.legacy_cosmetics (user_id, item_type, item_id, reason)
SELECT DISTINCT cr.user_id, rc.item_kind, rc.item_id, 'code_pre_cutoff'
FROM public.code_redemptions cr
JOIN public.redemption_codes rc ON rc.id = cr.code_id
WHERE cr.redeemed_at < timestamptz '2026-07-19 05:00:00+03'
  AND rc.reward_type = 'item'
  AND rc.item_kind IN ('frame','name_frame','bubble_frame','profile_frame','background')
  AND rc.item_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- (c) worldcup background is always permanent — every current owner qualifies
INSERT INTO public.legacy_cosmetics (user_id, item_type, item_id, reason)
SELECT DISTINCT i.user_id, 'background', 'worldcup', 'worldcup_always_permanent'
FROM public.inventory i
WHERE i.item_type = 'background' AND i.item_id = 'worldcup'
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 3) Strip expires_at from every legacy row still in inventory
-- ==========================================================
UPDATE public.inventory i
   SET meta = COALESCE(i.meta,'{}'::jsonb) - 'expires_at'
  FROM public.legacy_cosmetics lc
 WHERE i.user_id = lc.user_id
   AND i.item_type = lc.item_type
   AND i.item_id = lc.item_id
   AND (i.meta ->> 'expires_at') IS NOT NULL;

-- ==========================================================
-- 4) Restore deleted legacy items (proven via code_redemptions)
--    Insert only if the row is missing entirely.
-- ==========================================================
INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta, acquired_at)
SELECT lc.user_id, lc.item_type, lc.item_id, 1, '{}'::jsonb, timestamptz '2026-07-01 00:00:00+03'
FROM public.legacy_cosmetics lc
WHERE lc.reason IN ('code_pre_cutoff','worldcup_always_permanent')
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory i
     WHERE i.user_id = lc.user_id
       AND i.item_type = lc.item_type
       AND i.item_id = lc.item_id
  );

-- Ensure worldcup rows have no expires_at regardless of source
UPDATE public.inventory
   SET meta = COALESCE(meta,'{}'::jsonb) - 'expires_at'
 WHERE item_type = 'background' AND item_id = 'worldcup'
   AND (meta ->> 'expires_at') IS NOT NULL;

-- ==========================================================
-- 5) Harden _stamp_cosmetic_expiry: skip legacy + worldcup
-- ==========================================================
CREATE OR REPLACE FUNCTION public._stamp_cosmetic_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _days integer;
BEGIN
  -- Legacy ownership: never stamp expires_at
  IF EXISTS (
    SELECT 1 FROM public.legacy_cosmetics lc
     WHERE lc.user_id = NEW.user_id
       AND lc.item_type = NEW.item_type
       AND lc.item_id = NEW.item_id
  ) THEN
    IF NEW.meta IS NOT NULL THEN
      NEW.meta := NEW.meta - 'expires_at';
    END IF;
    RETURN NEW;
  END IF;

  _days := public._cosmetic_expiry_days(NEW.item_type, NEW.item_id);
  IF _days IS NULL THEN RETURN NEW; END IF;
  IF NEW.meta IS NULL THEN NEW.meta := '{}'::jsonb; END IF;
  IF (NEW.meta ->> 'expires_at') IS NULL THEN
    NEW.meta := NEW.meta || jsonb_build_object('expires_at', (now() + make_interval(days => _days))::text);
  END IF;
  RETURN NEW;
END; $function$;

-- ==========================================================
-- 6) Harden cleanup_expired_cosmetics: skip legacy rows
-- ==========================================================
CREATE OR REPLACE FUNCTION public.cleanup_expired_cosmetics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles p SET selected_bg_id = 'cove'
   WHERE p.selected_bg_id IS NOT NULL AND p.selected_bg_id <> 'cove'
     AND EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id AND i.item_type='background' AND i.item_id = p.selected_bg_id
          AND (i.meta->>'expires_at')::timestamptz <= now()
          AND NOT EXISTS (SELECT 1 FROM public.legacy_cosmetics lc WHERE lc.user_id=i.user_id AND lc.item_type=i.item_type AND lc.item_id=i.item_id)
     );

  UPDATE public.profiles p SET avatar_frame = NULL WHERE p.avatar_frame IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.inventory i
       WHERE i.user_id=p.id AND i.item_type='frame' AND i.item_id=p.avatar_frame
         AND (i.meta->>'expires_at')::timestamptz <= now()
         AND NOT EXISTS (SELECT 1 FROM public.legacy_cosmetics lc WHERE lc.user_id=i.user_id AND lc.item_type=i.item_type AND lc.item_id=i.item_id)
    );

  UPDATE public.profiles p SET name_frame = NULL WHERE p.name_frame IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.inventory i
       WHERE i.user_id=p.id AND i.item_type='name_frame' AND i.item_id=p.name_frame
         AND (i.meta->>'expires_at')::timestamptz <= now()
         AND NOT EXISTS (SELECT 1 FROM public.legacy_cosmetics lc WHERE lc.user_id=i.user_id AND lc.item_type=i.item_type AND lc.item_id=i.item_id)
    );

  UPDATE public.profiles p SET bubble_frame = NULL WHERE p.bubble_frame IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.inventory i
       WHERE i.user_id=p.id AND i.item_type='bubble_frame' AND i.item_id=p.bubble_frame
         AND (i.meta->>'expires_at')::timestamptz <= now()
         AND NOT EXISTS (SELECT 1 FROM public.legacy_cosmetics lc WHERE lc.user_id=i.user_id AND lc.item_type=i.item_type AND lc.item_id=i.item_id)
    );

  UPDATE public.profiles p SET profile_frame = NULL WHERE p.profile_frame IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.inventory i
       WHERE i.user_id=p.id AND i.item_type='profile_frame' AND i.item_id=p.profile_frame
         AND (i.meta->>'expires_at')::timestamptz <= now()
         AND NOT EXISTS (SELECT 1 FROM public.legacy_cosmetics lc WHERE lc.user_id=i.user_id AND lc.item_type=i.item_type AND lc.item_id=i.item_id)
    );

  DELETE FROM public.inventory i
   WHERE i.item_type IN ('frame','name_frame','bubble_frame','profile_frame','background')
     AND (i.meta->>'expires_at') IS NOT NULL
     AND (i.meta->>'expires_at')::timestamptz <= now()
     AND NOT EXISTS (
       SELECT 1 FROM public.legacy_cosmetics lc
        WHERE lc.user_id=i.user_id AND lc.item_type=i.item_type AND lc.item_id=i.item_id
     );
END $function$;

-- ==========================================================
-- 7) Harden buy_background_gems: never downgrade legacy ownership
-- ==========================================================
CREATE OR REPLACE FUNCTION public.buy_background_gems(_bg_id text, _gems bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _have bigint;
  _server_price bigint;
  _duration_days int;
  _is_legacy boolean;
  _has_row boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  _server_price := CASE _bg_id
    WHEN 'eiffel_night'     THEN 7000
    WHEN 'crystal_kingdom'  THEN 7000
    WHEN 'eiffel'           THEN 3500
    WHEN 'hilal'            THEN 5000
    WHEN 'spongebob'        THEN 5000
    WHEN 'elvenlake'        THEN 4000
    WHEN 'titan'            THEN 5000
    WHEN 'market_village'   THEN 5000
    WHEN 'ittihad'          THEN 5000
    WHEN 'shabab'           THEN 5000
    WHEN 'nassr'            THEN 5000
    WHEN 'ahli'             THEN 5000
    WHEN 'worldcup'         THEN 700000
    ELSE NULL
  END;
  IF _server_price IS NULL THEN RAISE EXCEPTION 'bg_not_purchasable_with_gems'; END IF;

  _duration_days := CASE WHEN _bg_id = 'worldcup' THEN NULL ELSE 7 END;

  SELECT gems INTO _have FROM public.profiles WHERE id=_uid FOR UPDATE;
  IF _have IS NULL OR _have < _server_price THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles SET gems = gems - _server_price WHERE id=_uid;

  SELECT EXISTS(
    SELECT 1 FROM public.legacy_cosmetics
     WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id
  ) INTO _is_legacy;

  SELECT EXISTS(
    SELECT 1 FROM public.inventory
     WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id
  ) INTO _has_row;

  IF _has_row THEN
    IF _is_legacy OR _duration_days IS NULL THEN
      -- Legacy or worldcup: guarantee permanent, do not touch acquired_at
      UPDATE public.inventory
         SET meta = COALESCE(meta,'{}'::jsonb) - 'expires_at'
       WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id;
    ELSE
      -- Non-legacy re-purchase: extend by 7 days from now
      UPDATE public.inventory
         SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text),
             acquired_at = now()
       WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id;
    END IF;
  ELSE
    IF _is_legacy OR _duration_days IS NULL THEN
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
      VALUES (_uid, 'background', _bg_id, 1, '{}'::jsonb);
    ELSE
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
      VALUES (_uid, 'background', _bg_id, 1,
              jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text));
    END IF;
  END IF;

  UPDATE public.profiles SET selected_bg_id = _bg_id WHERE id=_uid;
END
$function$;
