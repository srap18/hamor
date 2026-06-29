
SET LOCAL session_replication_role = 'replica';

INSERT INTO public.bans (user_id, reason, active)
VALUES (
  'dd778b4e-5848-433e-b831-38fbe3eed829',
  'استغلال ثغرة لإضافة ~2,000,000,000 جوهرة و~600,000,000 عملة في 26-06-2026',
  true
);

UPDATE public.profiles
SET gems  = 0,
    coins = 11065957
WHERE id = 'dd778b4e-5848-433e-b831-38fbe3eed829';

INSERT INTO public.cheat_flags (user_id, kind, severity, details)
VALUES (
  'dd778b4e-5848-433e-b831-38fbe3eed829',
  'currency_exploit',
  5,
  jsonb_build_object(
    'gems_gained_illegit', 2050020000,
    'coins_gained_illegit', 600000000,
    'window', '2026-06-26 11:18..11:42 UTC',
    'action', 'permanent_ban_and_wallet_reset'
  )
);

INSERT INTO public.economy_audit
  (user_id, coins_delta, gems_delta, coins_before, coins_after, gems_before, gems_after, source, reason, meta)
VALUES (
  'dd778b4e-5848-433e-b831-38fbe3eed829'::uuid,
  (11065957 - 155412942),
  (0 - 47158),
  155412942, 11065957,
  47158, 0,
  'admin_action',
  'cheat_rollback_currency_exploit',
  '{"ticket":"A122 prins exploit 26-06-2026"}'::jsonb
);

SET LOCAL session_replication_role = 'origin';
