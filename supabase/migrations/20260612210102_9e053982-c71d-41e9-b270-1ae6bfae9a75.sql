ALTER TABLE public.ships_owned
ADD COLUMN IF NOT EXISTS stealing_started_at timestamptz;

COMMENT ON COLUMN public.ships_owned.stealing_started_at IS 'When the current steal mission started, used to track active steal duration.';