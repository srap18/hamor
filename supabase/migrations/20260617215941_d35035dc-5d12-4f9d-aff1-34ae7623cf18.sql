
-- 1) shopify_products: pack_id ↔ shopify variant
CREATE TABLE public.shopify_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_id TEXT NOT NULL UNIQUE,
  shopify_product_id BIGINT NOT NULL,
  shopify_variant_id BIGINT NOT NULL,
  variant_gid TEXT NOT NULL,
  price_usd NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_products TO anon, authenticated;
GRANT ALL ON public.shopify_products TO service_role;
ALTER TABLE public.shopify_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read shopify product mapping"
  ON public.shopify_products FOR SELECT
  USING (true);

-- 2) shopify_orders: idempotent reward delivery
CREATE TABLE public.shopify_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id BIGINT NOT NULL UNIQUE,
  shopify_order_name TEXT,
  user_id UUID,
  pack_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_usd NUMERIC(10,2),
  raw_payload JSONB,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_orders TO authenticated;
GRANT ALL ON public.shopify_orders TO service_role;
ALTER TABLE public.shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own shopify orders"
  ON public.shopify_orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_shopify_products_updated_at
  BEFORE UPDATE ON public.shopify_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shopify_orders_updated_at
  BEFORE UPDATE ON public.shopify_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
