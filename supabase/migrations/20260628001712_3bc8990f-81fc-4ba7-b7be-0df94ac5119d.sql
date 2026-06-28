CREATE OR REPLACE FUNCTION public._market_expert_max_price(_uid uuid, _fish_id text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p.market_expert_until IS NOT NULL
         AND p.market_expert_until > now()
    THEN GREATEST(
      COALESCE((SELECT fps.max_price FROM public.fish_price_settings fps WHERE fps.fish_id = _fish_id), 0)::numeric,
      COALESCE((SELECT fmp.max_price FROM public.fish_market_prices fmp WHERE fmp.fish_id = _fish_id), 0)::numeric
    )
    ELSE NULL
  END
  FROM public.profiles p
  WHERE p.id = _uid;
$function$;