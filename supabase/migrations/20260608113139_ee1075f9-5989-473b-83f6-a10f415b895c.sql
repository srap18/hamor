REVOKE EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_fish_sale_by_qty(text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sell_fish_by_qty(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sell_fish_by_qty(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.sell_fish_by_qty(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_fish_by_qty(text, integer) TO service_role;