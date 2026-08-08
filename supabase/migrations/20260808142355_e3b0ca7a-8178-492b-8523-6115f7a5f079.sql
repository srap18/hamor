CREATE OR REPLACE FUNCTION public.admin_top_inventory_holders(
  _item_type text DEFAULT NULL,
  _item_id text DEFAULT NULL,
  _limit integer DEFAULT 100
)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  avatar_emoji text,
  ship_market_level integer,
  total_qty bigint,
  breakdown jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH inv AS (
    SELECT i.user_id AS uid, i.item_type AS it, i.item_id AS iid, SUM(i.quantity)::bigint AS qty
    FROM public.inventory i
    WHERE i.quantity > 0
      AND (_item_type IS NULL OR i.item_type = _item_type)
      AND (_item_id IS NULL OR i.item_id = _item_id)
    GROUP BY 1,2,3
  ), agg AS (
    SELECT inv.uid,
           SUM(inv.qty)::bigint AS total,
           jsonb_agg(jsonb_build_object('item_type', inv.it, 'item_id', inv.iid, 'qty', inv.qty)
                     ORDER BY inv.qty DESC) AS bd
    FROM inv GROUP BY inv.uid
  )
  SELECT a.uid,
         COALESCE(p.display_name, p.username, 'لاعب'),
         p.username,
         p.avatar_url,
         p.avatar_emoji,
         COALESCE(p.ship_market_level, 0),
         a.total,
         a.bd
  FROM agg a
  LEFT JOIN public.profiles p ON p.id = a.uid
  ORDER BY a.total DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_top_inventory_holders(text, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_top_inventory_holders(text, text, integer) TO authenticated;