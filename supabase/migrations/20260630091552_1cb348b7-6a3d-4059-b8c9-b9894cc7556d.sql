
SET LOCAL session_replication_role = replica;

UPDATE public.bans SET active = false
  WHERE user_id = 'dd778b4e-5848-433e-b831-38fbe3eed829' AND active = true;

DELETE FROM public.banned_emails WHERE email = 'alenzi23u@gmail.com';
DELETE FROM public.banned_devices WHERE user_id = 'dd778b4e-5848-433e-b831-38fbe3eed829';
DELETE FROM public.banned_ips WHERE user_id = 'dd778b4e-5848-433e-b831-38fbe3eed829';
DELETE FROM public.chat_mutes WHERE user_id = 'dd778b4e-5848-433e-b831-38fbe3eed829';

UPDATE public.profiles SET active_session_id = NULL
  WHERE id = 'dd778b4e-5848-433e-b831-38fbe3eed829';

UPDATE auth.users SET banned_until = NULL
  WHERE id = 'dd778b4e-5848-433e-b831-38fbe3eed829';

INSERT INTO public.admin_audit (admin_id, action, target_user_id, details)
VALUES (
  '7035f6b9-7bb2-41e2-a8b8-050d0e7f41c0',
  'admin_full_unban',
  'dd778b4e-5848-433e-b831-38fbe3eed829',
  '{"reason":"رفع الحظر الكامل عن prins","cleared":["bans","banned_emails","banned_devices","banned_ips","chat_mutes","auth.banned_until"]}'::jsonb
);

SET LOCAL session_replication_role = origin;
