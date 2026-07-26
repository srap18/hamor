
CREATE TABLE IF NOT EXISTS public.paddle_purchase_items (
  paddle_transaction_id text NOT NULL,
  item_type text NOT NULL,
  item_id text NOT NULL,
  qty integer NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paddle_transaction_id, item_type, item_id)
);

GRANT SELECT ON public.paddle_purchase_items TO authenticated;
GRANT ALL ON public.paddle_purchase_items TO service_role;
ALTER TABLE public.paddle_purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct read" ON public.paddle_purchase_items;
CREATE POLICY "no direct read" ON public.paddle_purchase_items FOR SELECT USING (false);

CREATE OR REPLACE FUNCTION public.grant_pack_items(_txn_id text, _user uuid, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it jsonb;
  v_type text; v_id text; v_qty int;
  v_inserted int := 0;
  v_did_insert boolean;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'inserted', 0);
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_type := it->>'itemType';
    v_id := it->>'itemId';
    v_qty := COALESCE((it->>'qty')::int, 0);
    IF v_qty <= 0 OR v_type IS NULL OR v_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.paddle_purchase_items(paddle_transaction_id, item_type, item_id, qty)
    VALUES (_txn_id, v_type, v_id, v_qty)
    ON CONFLICT (paddle_transaction_id, item_type, item_id) DO NOTHING;

    GET DIAGNOSTICS v_did_insert = ROW_COUNT;
    IF v_did_insert THEN
      PERFORM public.grant_inventory_item(_user, v_type, v_id, v_qty);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END $$;

GRANT EXECUTE ON FUNCTION public.grant_pack_items(text, uuid, jsonb) TO authenticated, service_role;
