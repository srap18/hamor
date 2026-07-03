CREATE TABLE public.ship_slot_layout (
  bg_id text NOT NULL,
  slot_index int NOT NULL CHECK (slot_index >= 0 AND slot_index < 10),
  mode text NOT NULL CHECK (mode IN ('dock','sea')),
  top_pct numeric NOT NULL,
  left_pct numeric NOT NULL,
  scale numeric NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bg_id, slot_index, mode)
);

GRANT SELECT ON public.ship_slot_layout TO anon, authenticated;
GRANT ALL ON public.ship_slot_layout TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.ship_slot_layout TO authenticated;

ALTER TABLE public.ship_slot_layout ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ship_slot_layout_public_read"
  ON public.ship_slot_layout FOR SELECT
  USING (true);

CREATE POLICY "ship_slot_layout_admin_write"
  ON public.ship_slot_layout FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));