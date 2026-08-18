REVOKE EXECUTE ON FUNCTION public.grant_pack_items(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_pack_ships(uuid, text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_xp(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_paddle_purchase(text, integer, bigint, integer, integer, integer, integer, boolean) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname ~ '^_'
      AND pg_get_function_result(p.oid) <> 'trigger'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

UPDATE public.play_products
SET rewards = jsonb_set(
      rewards,
      '{items}',
      (SELECT jsonb_agg(
                CASE WHEN it ? 'qty:' THEN (it - 'qty:') || jsonb_build_object('qty', it->'qty:')
                     ELSE it END)
       FROM jsonb_array_elements(rewards->'items') it)
    )
WHERE sku = 'offer_frame_legendary_set'
  AND rewards->'items' @> '[{"qty:": 1}]'::jsonb;