
CREATE OR REPLACE FUNCTION public.device_resident(_uid uuid, _device text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _uid IS NULL OR _device IS NULL OR length(trim(_device)) < 8 THEN false
    WHEN public.device_is_shared(_device) THEN false
    -- another account uses this device more than the offender: it is not his device
    WHEN EXISTS (
      SELECT 1 FROM public.device_history o
      WHERE trim(o.device_id) = trim(_device)
        AND o.user_id <> _uid
        AND COALESCE(o.hits,0) > COALESCE((
          SELECT h.hits FROM public.device_history h
          WHERE h.user_id = _uid AND trim(h.device_id) = trim(_device)
        ),0)
    ) THEN false
    ELSE (
      EXISTS (SELECT 1 FROM public.device_slots s
               WHERE s.user_id = _uid AND trim(s.hardware_hash) = trim(_device))
      OR EXISTS (SELECT 1 FROM public.device_history h
                  WHERE h.user_id = _uid AND trim(h.device_id) = trim(_device)
                    AND (COALESCE(h.hits,0) >= 3
                         OR h.last_seen - h.first_seen >= interval '24 hours'))
      OR EXISTS (SELECT 1 FROM public.device_identity_users m
                  WHERE m.user_id = _uid
                    AND trim(COALESCE(m.hardware_hash,'')) = trim(_device)
                    AND m.confidence >= 95
                    AND m.last_seen - m.first_seen >= interval '24 hours')
    )
  END;
$$;
