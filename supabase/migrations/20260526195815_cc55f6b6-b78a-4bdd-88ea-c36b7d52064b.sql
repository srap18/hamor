-- Reset partial migration 5
DROP TABLE IF EXISTS public.inventory CASCADE;

-- Re-apply migration 5 fully

CREATE TABLE public.inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('crew', 'weapon', 'consumable', 'decoration')),
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  meta JSONB,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_type, item_id)
);
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_select_own" ON public.inventory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "inv_insert_own" ON public.inventory FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inv_update_own" ON public.inventory FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "inv_delete_own" ON public.inventory FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.fish_caught (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  fish_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fish_id)
);
ALTER TABLE public.fish_caught ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fc_select_own" ON public.fish_caught FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "fc_insert_own" ON public.fish_caught FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fc_update_own" ON public.fish_caught FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "fc_delete_own" ON public.fish_caught FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.attacks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attacker_id UUID NOT NULL,
  defender_id UUID NOT NULL,
  target_ship_id UUID,
  damage INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.attacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "atk_select_involved" ON public.attacks FOR SELECT USING (auth.uid() = attacker_id OR auth.uid() = defender_id);
CREATE POLICY "atk_insert_attacker" ON public.attacks FOR INSERT WITH CHECK (auth.uid() = attacker_id AND attacker_id <> defender_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.attacks;