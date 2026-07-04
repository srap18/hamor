
DO $$
DECLARE
  r record;
  cleared int := 0;
BEGIN
  FOR r IN
    SELECT u.id AS user_id, lower(u.email) AS email
    FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.bans b WHERE b.user_id = u.id AND b.active = true)
      AND (
        (u.email IS NOT NULL AND EXISTS(SELECT 1 FROM public.banned_emails be WHERE be.email = lower(u.email)))
        OR EXISTS(SELECT 1 FROM public.banned_devices bd WHERE bd.user_id = u.id)
        OR EXISTS(SELECT 1 FROM public.banned_ips bi WHERE bi.user_id = u.id)
        OR (u.banned_until IS NOT NULL AND u.banned_until > now())
      )
  LOOP
    IF r.email IS NOT NULL THEN
      DELETE FROM public.banned_emails WHERE email = r.email;
    END IF;
    DELETE FROM public.banned_devices WHERE user_id = r.user_id;
    DELETE FROM public.banned_ips WHERE user_id = r.user_id;
    UPDATE auth.users SET banned_until = NULL WHERE id = r.user_id;
    cleared := cleared + 1;
  END LOOP;

  RAISE NOTICE 'Fully unbanned % accounts', cleared;
END $$;
