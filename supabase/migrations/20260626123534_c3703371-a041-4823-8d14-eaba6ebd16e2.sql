
-- 1) Close the exploit: qa_award had no auth check and was SECURITY DEFINER
DROP FUNCTION IF EXISTS public.qa_award(uuid, integer, bigint, integer);

-- 2) Revoke any other risky exposure: ensure admin_* functions can only be called via SECURITY DEFINER body (they already check is_admin internally; no change needed)

-- 3) Reset balances of clearly-hacked accounts
--    Anyone with > 200,000 gems OR > 2,000,000,000 coins is reset to a reasonable cap tied to level.
WITH suspects AS (
  SELECT id, level, gems, coins
  FROM public.profiles
  WHERE gems > 200000 OR coins > 2000000000
),
fixed AS (
  UPDATE public.profiles p
  SET gems  = LEAST(p.gems,  GREATEST(1000, p.level * 500)),
      coins = LEAST(p.coins, GREATEST(10000, p.level::bigint * 50000))
  FROM suspects s
  WHERE p.id = s.id
  RETURNING p.id, s.gems AS old_gems, p.gems AS new_gems, s.coins AS old_coins, p.coins AS new_coins
)
INSERT INTO public.economy_audit (user_id, coins_delta, gems_delta, coins_before, coins_after, gems_before, gems_after, source, reason, meta)
SELECT id,
       (new_coins - old_coins)::bigint,
       (new_gems  - old_gems)::bigint,
       old_coins, new_coins,
       old_gems,  new_gems,
       'security_fix', 'qa_award_exploit_rollback',
       jsonb_build_object('reason','closed qa_award SECURITY DEFINER hole')
FROM fixed;
