SET lock_timeout = '15s';
ALTER TABLE public.competition_catches ADD COLUMN IF NOT EXISTS tribe_id uuid;