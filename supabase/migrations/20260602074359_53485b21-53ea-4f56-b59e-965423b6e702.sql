CREATE OR REPLACE FUNCTION public.get_fish_stock_summary()
RETURNS TABLE(fish_id text, qty bigint, oldest_caught_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fish_id, COUNT(*)::bigint AS qty, MIN(caught_at) AS oldest_caught_at
  FROM public.fish_stock
  WHERE user_id = auth.uid()
  GROUP BY fish_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_fish_stock_summary() TO authenticated;