
INSERT INTO public.device_slots(hardware_hash, slot_index, user_id, assigned_at, locked_until, fingerprint_version)
SELECT '1111111111111111111111111111111111111111111111111111111111111111', row_number() over (order by p.id)::smallint, p.id, now(), now() + interval '14 days', 1
FROM (SELECT id FROM public.profiles ORDER BY created_at DESC LIMIT 2) p
ON CONFLICT DO NOTHING;
