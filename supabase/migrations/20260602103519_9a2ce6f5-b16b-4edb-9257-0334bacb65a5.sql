ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid,
  ADD COLUMN IF NOT EXISTS reply_to_body text,
  ADD COLUMN IF NOT EXISTS reply_to_name text;