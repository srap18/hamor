
CREATE OR REPLACE FUNCTION public.apply_fish_price_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur numeric;
  new_cur numeric;
BEGIN
  -- Ensure row exists in fish_market_prices, then push new min/max + clamp current_price.
  SELECT current_price INTO cur FROM public.fish_market_prices WHERE fish_id = NEW.fish_id;

  IF cur IS NULL THEN
    INSERT INTO public.fish_market_prices (fish_id, min_price, max_price, current_price, trend, last_updated, forecast, history)
    VALUES (NEW.fish_id, NEW.min_price, NEW.max_price,
            round(((NEW.min_price + NEW.max_price) / 2)::numeric, 2),
            0, now(), '[]'::jsonb, '[]'::jsonb);
  ELSE
    new_cur := cur;
    IF new_cur < NEW.min_price THEN new_cur := NEW.min_price; END IF;
    IF new_cur > NEW.max_price THEN new_cur := NEW.max_price; END IF;

    UPDATE public.fish_market_prices
       SET min_price = NEW.min_price,
           max_price = NEW.max_price,
           current_price = round(new_cur::numeric, 2),
           forecast = '[]'::jsonb,
           last_updated = now()
     WHERE fish_id = NEW.fish_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_fish_price_settings ON public.fish_price_settings;
CREATE TRIGGER trg_apply_fish_price_settings
AFTER INSERT OR UPDATE ON public.fish_price_settings
FOR EACH ROW EXECUTE FUNCTION public.apply_fish_price_settings();

-- Backfill: sync existing settings to market prices right now.
UPDATE public.fish_market_prices m
SET min_price = s.min_price,
    max_price = s.max_price,
    current_price = LEAST(GREATEST(m.current_price, s.min_price), s.max_price),
    forecast = '[]'::jsonb,
    last_updated = now()
FROM public.fish_price_settings s
WHERE m.fish_id = s.fish_id
  AND (m.min_price <> s.min_price OR m.max_price <> s.max_price);
