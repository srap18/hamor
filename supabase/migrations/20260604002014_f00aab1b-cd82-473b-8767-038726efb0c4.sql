UPDATE public.ship_catalog
   SET active = false
 WHERE code IN ('tribe-fire','tribe-tornado','tribe-lightning','phoenix','submarine');

DROP FUNCTION IF EXISTS public.buy_tribe_ship(text);
DROP FUNCTION IF EXISTS public.claim_vip_submarine();
DROP FUNCTION IF EXISTS public.buy_phoenix_pack_1();
DROP FUNCTION IF EXISTS public.buy_phoenix_pack_3();

DROP FUNCTION IF EXISTS public.tg_auto_upgrade_submarines() CASCADE;
DROP FUNCTION IF EXISTS public.vip_submarine_hp(integer);

INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp, at_sea, in_storage)
SELECT user_id, 1, 'ship-lvl-1', 80, 80, false, false
  FROM public.ships_owned
 GROUP BY user_id
HAVING COUNT(*) = COUNT(*) FILTER (
   WHERE catalog_code IN ('tribe-fire','tribe-tornado','tribe-lightning','phoenix','submarine')
      OR template_id IN (31, 32)
);

DELETE FROM public.ships_owned
 WHERE catalog_code IN ('tribe-fire','tribe-tornado','tribe-lightning','phoenix','submarine')
    OR template_id IN (31, 32);

UPDATE public.profiles SET vip_subs_claimed = 0 WHERE vip_subs_claimed > 0;