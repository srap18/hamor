
-- Disable triggers temporarily so we can insert directly as DB owner
ALTER TABLE public.bans DISABLE TRIGGER trg_guard_bans_insert;

INSERT INTO public.bans(user_id, reason, expires_at, active)
VALUES ('dd778b4e-5848-433e-b831-38fbe3eed829', 'hacker / cheater — permanent ban', NULL, true);

ALTER TABLE public.bans ENABLE TRIGGER trg_guard_bans_insert;

INSERT INTO public.banned_devices(device_id, user_id, reason)
SELECT device_id, 'dd778b4e-5848-433e-b831-38fbe3eed829', 'hacker — permanent device ban'
  FROM (
    SELECT device_id FROM public.device_accounts WHERE user_id='dd778b4e-5848-433e-b831-38fbe3eed829'
    UNION
    SELECT device_id FROM public.device_history  WHERE user_id='dd778b4e-5848-433e-b831-38fbe3eed829'
  ) d
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO public.banned_ips(ip, user_id, reason)
SELECT ip::text, 'dd778b4e-5848-433e-b831-38fbe3eed829', 'hacker — permanent ip ban'
  FROM public.user_ips WHERE user_id='dd778b4e-5848-433e-b831-38fbe3eed829'
ON CONFLICT (ip) DO NOTHING;

INSERT INTO public.banned_emails(email, reason)
SELECT lower(email), 'hacker — permanent email ban'
  FROM auth.users WHERE id='dd778b4e-5848-433e-b831-38fbe3eed829' AND email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

DELETE FROM auth.sessions WHERE user_id='dd778b4e-5848-433e-b831-38fbe3eed829';
DELETE FROM auth.refresh_tokens WHERE user_id::text='dd778b4e-5848-433e-b831-38fbe3eed829';

UPDATE auth.users
   SET banned_until = '2999-12-31 23:59:59+00'
 WHERE id='dd778b4e-5848-433e-b831-38fbe3eed829';
