-- Consolidate any duplicate inventory rows (sum quantities, keep oldest id),
-- then add the unique constraint that open_lucky_box's ON CONFLICT relies on.

WITH ranked AS (
  SELECT id, user_id, item_type, item_id, quantity,
         ROW_NUMBER() OVER (PARTITION BY user_id, item_type, item_id ORDER BY id) AS rn,
         SUM(quantity) OVER (PARTITION BY user_id, item_type, item_id) AS total_qty
  FROM public.inventory
),
keepers AS (
  UPDATE public.inventory inv
     SET quantity = r.total_qty
    FROM ranked r
   WHERE inv.id = r.id AND r.rn = 1 AND inv.quantity <> r.total_qty
  RETURNING inv.id
)
DELETE FROM public.inventory inv
 USING ranked r
 WHERE inv.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_user_item_uniq
  ON public.inventory (user_id, item_type, item_id);