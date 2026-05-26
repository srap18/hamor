ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_user_id_item_type_item_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_unassigned_unique
  ON public.inventory (user_id, item_type, item_id)
  WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_assigned_ship_unique
  ON public.inventory (user_id, item_type, item_id, ((meta->>'assigned_ship_id')))
  WHERE (meta->>'assigned_ship_id') IS NOT NULL;