ALTER TABLE public.tribe_members
  ADD COLUMN IF NOT EXISTS donation_coins bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_donation_at timestamptz;