CREATE OR REPLACE FUNCTION public.play_products_notify_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
BEGIN
  -- Performance guard: skip when only sync-status metadata changed.
  -- Content sync must still fire on INSERT and on any real content edit.
  IF TG_OP = 'UPDATE' AND NOT (
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
    RETURN NEW;
  END IF;

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
$function$;