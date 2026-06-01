-- Reset VIP for everyone
UPDATE public.profiles
SET vip_level = 0,
    vip_points = 0,
    vip_subs_claimed = 0,
    vip_expires_at = NULL;

-- Delete all VIP submarines previously claimed
DELETE FROM public.ships_owned
WHERE catalog_code = 'vip_submarine';
