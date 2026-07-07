-- Enable pg_net for outbound HTTP calls (used by trigger to notify webhook)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Main products table
CREATE TABLE public.play_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  title_ar text NOT NULL,
  title_en text NOT NULL,
  description_ar text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  price_micros bigint NOT NULL CHECK (price_micros >= 0),
  default_currency text NOT NULL DEFAULT 'USD',
  product_type text NOT NULL DEFAULT 'inapp' CHECK (product_type IN ('inapp','subs')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  rewards jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','ok','error')),
  sync_error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX play_products_status_idx ON public.play_products(status);
CREATE INDEX play_products_sync_status_idx ON public.play_products(sync_status);

-- Grants
GRANT SELECT ON public.play_products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.play_products TO authenticated;
GRANT ALL ON public.play_products TO service_role;

-- RLS
ALTER TABLE public.play_products ENABLE ROW LEVEL SECURITY;

-- Public: only see active products
CREATE POLICY "public read active play products"
ON public.play_products FOR SELECT
USING (status = 'active' OR public.has_role(auth.uid(), 'admin'));

-- Admin write
CREATE POLICY "admin insert play products"
ON public.play_products FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin update play products"
ON public.play_products FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin delete play products"
ON public.play_products FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.play_products_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  -- Mark as pending on content change (not on sync_status-only updates)
  IF TG_OP = 'UPDATE' AND (
    NEW.sku IS DISTINCT FROM OLD.sku OR
    NEW.title_ar IS DISTINCT FROM OLD.title_ar OR
    NEW.title_en IS DISTINCT FROM OLD.title_en OR
    NEW.description_ar IS DISTINCT FROM OLD.description_ar OR
    NEW.description_en IS DISTINCT FROM OLD.description_en OR
    NEW.price_micros IS DISTINCT FROM OLD.price_micros OR
    NEW.default_currency IS DISTINCT FROM OLD.default_currency OR
    NEW.product_type IS DISTINCT FROM OLD.product_type OR
    NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    NEW.sync_status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER play_products_touch_updated_at
BEFORE UPDATE ON public.play_products
FOR EACH ROW EXECUTE FUNCTION public.play_products_touch_updated_at();

-- Configuration table for the webhook URL + apikey
-- (avoids hardcoding secrets in the trigger function)
CREATE TABLE IF NOT EXISTS public.play_sync_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  webhook_url text NOT NULL,
  apikey text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.play_sync_config TO service_role;
ALTER TABLE public.play_sync_config ENABLE ROW LEVEL SECURITY;
-- No public policies: only service_role (bypasses RLS) reads this.

-- Seed default config (project stable URL + anon key)
INSERT INTO public.play_sync_config (id, webhook_url, apikey)
VALUES (
  1,
  'https://project--fc1f387e-db92-4515-a5c6-90044e4e7b7a.lovable.app/api/public/hooks/play-sync',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqd2Jma3B1ZHlzeHF0a2VvdXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDEyNDksImV4cCI6MjA5NTMxNzI0OX0.rs4NXx8bMPQ3k8Zgf_F3efeDPuAsxPlqS0bZ3cFE9dI'
)
ON CONFLICT (id) DO NOTHING;

-- Trigger: on INSERT or UPDATE, ping webhook to sync this row to Play
CREATE OR REPLACE FUNCTION public.play_products_notify_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg record;
BEGIN
  SELECT webhook_url, apikey INTO cfg FROM public.play_sync_config WHERE id = 1;
  IF cfg.webhook_url IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := cfg.webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', cfg.apikey
    ),
    body := jsonb_build_object('product_id', NEW.id::text, 'sku', NEW.sku)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER play_products_notify_sync
AFTER INSERT OR UPDATE ON public.play_products
FOR EACH ROW EXECUTE FUNCTION public.play_products_notify_sync();