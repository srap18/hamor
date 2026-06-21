
INSERT INTO public.banned_devices(device_id, user_id, reason, banned_by)
SELECT DISTINCT ON (dh.device_id) dh.device_id, b.user_id,
       COALESCE(NULLIF(b.reason,''),'حظر قوي'), b.banned_by
FROM public.bans b
JOIN public.device_history dh ON dh.user_id = b.user_id
WHERE b.active = true AND b.expires_at IS NULL
  AND dh.device_id IS NOT NULL AND dh.device_id <> ''
ORDER BY dh.device_id, dh.last_seen DESC
ON CONFLICT (device_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by;
