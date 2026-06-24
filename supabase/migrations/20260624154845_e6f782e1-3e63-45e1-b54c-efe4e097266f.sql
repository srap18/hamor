-- Roll back all coin gains from fish sales in the last hour (compensation
-- for the golden-fisher duplication exploit period). Subtract each user's
-- total fish_sale amount from their coins balance, clamped at 0.
WITH gains AS (
  SELECT user_id, SUM(total_amount)::bigint AS total
  FROM public.transaction_logs
  WHERE kind = 'fish_sale'
    AND created_at > now() - interval '1 hour'
  GROUP BY user_id
)
UPDATE public.profiles p
   SET coins = GREATEST(0, COALESCE(p.coins, 0) - g.total)
  FROM gains g
 WHERE p.id = g.user_id;