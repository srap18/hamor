ALTER TABLE public.competitions
ADD COLUMN IF NOT EXISTS prize_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.competitions.prize_tiers IS 'Array of prize tier objects: [{rank:1, coins:0, gems:0, xp:0, text:""}, ...]';