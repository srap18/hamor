-- Remove broken duplicate overload of collect_fishing_reward that returns only
-- {sailor_mult} and references a non-existent table (inventory_items).
-- This stub was sometimes resolved instead of the real function, causing
-- ships to return with zero fish for affected users.
DROP FUNCTION IF EXISTS public.collect_fishing_reward(uuid);