ALTER TABLE public.fish_ship_max_level DROP CONSTRAINT IF EXISTS fish_ship_max_level_max_ship_level_check;
ALTER TABLE public.fish_ship_max_level ADD CONSTRAINT fish_ship_max_level_max_ship_level_check CHECK (max_ship_level BETWEEN 1 AND 31);

INSERT INTO public.fish_ship_max_level (fish_id, max_ship_level, rarity_rank) VALUES
('sardine',5,1),('anchovy',5,1),('herring',5,1),('smelt',5,1),
('minnow',5,1),('mullet',5,1),('shrimp',5,1),('crab_small',5,1),
('mackerel',10,2),('bass',10,2),('cod',10,2),('snapper',10,2),
('trout',10,2),('salmon',10,2),('squid',10,2),
('tuna',15,3),('grouper',15,3),('octopus',15,3),('lobster',15,3),
('eel',15,3),('flounder',15,3),('carp',15,3),
('marlin',20,4),('swordfish',20,4),('sailfish',20,4),('barracuda',20,4),
('stingray',20,4),('shark',20,4),('tang_blue',20,4),('koi',20,4),
('manta',25,5),('hammerhead',25,5),('whale',25,5),('orca',25,5),
('arowana',25,5),('goldfish',25,5),('pearl',25,5),
('kraken',30,6),('leviathan',30,6),('megalodon',30,6),('sea_dragon',30,6),
('poseidon',30,6),('black_pearl',30,6),('golden_koi',30,6),
('phoenix',31,6)
ON CONFLICT (fish_id) DO UPDATE
  SET max_ship_level = EXCLUDED.max_ship_level,
      rarity_rank    = EXCLUDED.rarity_rank;

SELECT public.recompute_fish_prices();