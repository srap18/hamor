DROP TABLE IF EXISTS public.farm_quests CASCADE;
DROP TABLE IF EXISTS public.farm_inventory CASCADE;
DROP TABLE IF EXISTS public.farm_buildings CASCADE;
DROP TABLE IF EXISTS public.farm_animals CASCADE;
DROP TABLE IF EXISTS public.farm_plots CASCADE;
DROP TABLE IF EXISTS public.farm_players CASCADE;

DROP FUNCTION IF EXISTS public.farm_init() CASCADE;
DROP FUNCTION IF EXISTS public.farm_ensure_quests() CASCADE;
DROP FUNCTION IF EXISTS public.farm_plant(integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.farm_harvest(integer) CASCADE;
DROP FUNCTION IF EXISTS public.farm_buy_animal(text) CASCADE;
DROP FUNCTION IF EXISTS public.farm_collect_animal(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.farm_buy_building(text) CASCADE;
DROP FUNCTION IF EXISTS public.farm_start_recipe(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.farm_collect_recipe(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.farm_sell(text, integer) CASCADE;
DROP FUNCTION IF EXISTS public.farm_expand() CASCADE;
DROP FUNCTION IF EXISTS public.farm_claim_quest(uuid) CASCADE;