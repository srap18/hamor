
GRANT SELECT ON public.ship_slot_layout TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ship_slot_layout TO authenticated;
GRANT ALL ON public.ship_slot_layout TO service_role;
ALTER TABLE public.ship_slot_layout REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='ship_slot_layout') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ship_slot_layout';
  END IF;
END $$;
