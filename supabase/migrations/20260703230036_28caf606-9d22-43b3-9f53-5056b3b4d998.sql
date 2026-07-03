
GRANT SELECT ON public.ship_slot_layout TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ship_slot_layout TO authenticated;
GRANT ALL ON public.ship_slot_layout TO service_role;

ALTER TABLE public.ship_slot_layout REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ship_slot_layout;
