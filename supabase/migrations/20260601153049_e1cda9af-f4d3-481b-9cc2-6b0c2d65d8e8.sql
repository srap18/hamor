
ALTER TABLE public.profiles ALTER COLUMN vip_level SET DEFAULT 0;

-- Reset accidental defaults: only users still at level 1 with no granted expiry
UPDATE public.profiles
   SET vip_level = 0
 WHERE vip_level = 1
   AND vip_expires_at IS NULL;
