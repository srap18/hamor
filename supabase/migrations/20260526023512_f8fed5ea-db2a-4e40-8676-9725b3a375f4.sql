ALTER TABLE public.ships_owned REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ships_owned;