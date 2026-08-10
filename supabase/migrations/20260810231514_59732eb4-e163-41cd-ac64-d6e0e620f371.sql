CREATE OR REPLACE FUNCTION public.sync_elite_vip6_golden_fisher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owned timestamptz;
BEGIN
  IF COALESCE(NEW.elite_vip_level, 0) >= 6
     AND (NEW.elite_vip_expires_at IS NULL OR NEW.elite_vip_expires_at > now()) THEN
    NEW.golden_fisher_until := GREATEST(
      COALESCE(NEW.golden_fisher_until, '-infinity'::timestamptz),
      COALESCE(NEW.elite_vip_expires_at, 'infinity'::timestamptz)
    );
  ELSIF COALESCE(NEW.elite_vip_level, 0) < 6
        OR (NEW.elite_vip_expires_at IS NOT NULL AND NEW.elite_vip_expires_at <= now()) THEN
    SELECT MAX(NULLIF(i.meta->>'expires_at','')::timestamptz)
      INTO v_owned
      FROM public.inventory i
     WHERE i.user_id = NEW.id
       AND i.item_type = 'crew'
       AND i.item_id = 'golden_fisher'
       AND i.meta ? 'expires_at';
    NEW.golden_fisher_until := v_owned;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_expired_elite_vip()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE public.profiles
       SET elite_vip_level = 0,
           elite_vip_expires_at = NULL
     WHERE elite_vip_level > 0
       AND elite_vip_expires_at IS NOT NULL
       AND elite_vip_expires_at <= now()
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  -- safety net: strip VIP6-granted golden fisher from anyone no longer VIP6
  UPDATE public.profiles p
     SET golden_fisher_until = (
           SELECT MAX(NULLIF(i.meta->>'expires_at','')::timestamptz)
             FROM public.inventory i
            WHERE i.user_id = p.id
              AND i.item_type = 'crew'
              AND i.item_id = 'golden_fisher'
              AND i.meta ? 'expires_at'
         )
   WHERE p.golden_fisher_until IS NOT NULL
     AND NOT public.elite_vip6_active(p.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id
          AND i.item_type = 'crew'
          AND i.item_id = 'golden_fisher'
          AND i.meta ? 'expires_at'
          AND NULLIF(i.meta->>'expires_at','')::timestamptz >= p.golden_fisher_until
     );

  RETURN v_count;
END;
$$;

SELECT public.sweep_expired_elite_vip();