-- 1) Remove the stale duplicate overload (arg order _txn_id,_user) that made
--    named-argument RPC calls ambiguous, so ship deliveries silently failed.
DROP FUNCTION IF EXISTS public.grant_pack_ships(text, uuid, integer, integer, integer, integer);

-- 2) Deliver the missing dragon T1 ships (3 each) for paid-but-undelivered txns.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.paddle_transaction_id AS txn, p.user_id
    FROM public.paddle_purchases p
    WHERE p.pack_id IN ('bd_dragon_t1','bd_dragon_t2','bd_dragon_t3','bd_phoenix_trio')
      AND NOT EXISTS (
        SELECT 1 FROM public.paddle_purchase_ships s
        WHERE s.paddle_transaction_id = p.paddle_transaction_id
      )
  LOOP
    PERFORM public.grant_pack_ships(
      _user => r.user_id,
      _txn_id => r.txn,
      _phoenix => CASE WHEN (SELECT pack_id FROM public.paddle_purchases WHERE paddle_transaction_id = r.txn) = 'bd_phoenix_trio' THEN 3 ELSE 0 END,
      _dragon_t1 => CASE WHEN (SELECT pack_id FROM public.paddle_purchases WHERE paddle_transaction_id = r.txn) = 'bd_dragon_t1' THEN 3 ELSE 0 END,
      _dragon_t2 => CASE WHEN (SELECT pack_id FROM public.paddle_purchases WHERE paddle_transaction_id = r.txn) = 'bd_dragon_t2' THEN 3 ELSE 0 END,
      _dragon_t3 => CASE WHEN (SELECT pack_id FROM public.paddle_purchases WHERE paddle_transaction_id = r.txn) = 'bd_dragon_t3' THEN 3 ELSE 0 END
    );
  END LOOP;
END $$;