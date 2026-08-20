
CREATE OR REPLACE FUNCTION public.device_resident(_uid uuid, _device text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT COALESCE(MAX(h.hits),0) AS hits,
           COALESCE(MAX(EXTRACT(epoch FROM (h.last_seen - h.first_seen))),0) AS span
    FROM public.device_history h
    WHERE h.user_id = _uid AND trim(h.device_id) = trim(_device)
  ), others AS (
    SELECT COALESCE(MAX(o.hits),0) AS hits, count(*) AS n
    FROM public.device_history o
    WHERE trim(o.device_id) = trim(_device) AND o.user_id <> _uid
  )
  SELECT CASE
    WHEN _uid IS NULL OR _device IS NULL OR length(trim(_device)) < 8 THEN false
    WHEN public.device_is_shared(_device) THEN false
    WHEN (SELECT n FROM others) > 0
         AND ((SELECT hits FROM me) < 3 OR (SELECT hits FROM me) <= (SELECT hits FROM others))
      THEN false
    ELSE (
      EXISTS (SELECT 1 FROM public.device_slots s
               WHERE s.user_id = _uid AND trim(s.hardware_hash) = trim(_device))
      OR (SELECT hits FROM me) >= 3
      OR (SELECT span FROM me) >= 86400
      OR EXISTS (SELECT 1 FROM public.device_identity_users m
                  WHERE m.user_id = _uid
                    AND trim(COALESCE(m.hardware_hash,'')) = trim(_device)
                    AND m.confidence >= 95
                    AND m.last_seen - m.first_seen >= interval '24 hours')
    )
  END;
$$;
