SET session_replication_role = replica;

DELETE FROM public.ships_owned
WHERE catalog_code = 'submarine' OR template_id = 32;

SET session_replication_role = DEFAULT;

DELETE FROM public.ship_catalog WHERE code = 'submarine';

DELETE FROM public.fish_stock WHERE fish_id = 'abyss_titan';
DELETE FROM public.fish_caught WHERE fish_id = 'abyss_titan';
DELETE FROM public.fish_market_prices WHERE fish_id = 'abyss_titan';

UPDATE public.profiles SET
  vip_level = 0,
  vip_points = 0,
  vip_expires_at = NULL,
  vip_subs_claimed = 0;

DELETE FROM public.royal_box_claims;
DELETE FROM public.subscriptions;