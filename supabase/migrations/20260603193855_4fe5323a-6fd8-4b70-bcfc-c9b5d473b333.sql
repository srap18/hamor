
-- Dragons table
CREATE TABLE public.dragons (
  user_id UUID PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'تنيني',
  stage INTEGER NOT NULL DEFAULT 1,
  dp BIGINT NOT NULL DEFAULT 0,
  total_boss_damage BIGINT NOT NULL DEFAULT 0,
  pvp_wins INTEGER NOT NULL DEFAULT 0,
  pvp_losses INTEGER NOT NULL DEFAULT 0,
  element TEXT NOT NULL DEFAULT 'fire',
  hatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.dragons TO authenticated;
GRANT ALL ON public.dragons TO service_role;
GRANT SELECT ON public.dragons TO anon;

ALTER TABLE public.dragons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dragons_select_all" ON public.dragons FOR SELECT USING (true);
CREATE POLICY "dragons_insert_own" ON public.dragons FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dragons_update_own" ON public.dragons FOR UPDATE USING (auth.uid() = user_id);

-- Dragon equipment table
CREATE TABLE public.dragon_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('weapon','armor','talisman')),
  rarity TEXT NOT NULL DEFAULT 'common' CHECK (rarity IN ('common','rare','epic','legendary','divine')),
  name TEXT NOT NULL,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  equipped BOOLEAN NOT NULL DEFAULT false,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dragon_equipment_user ON public.dragon_equipment(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dragon_equipment TO authenticated;
GRANT ALL ON public.dragon_equipment TO service_role;

ALTER TABLE public.dragon_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deq_select_own" ON public.dragon_equipment FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "deq_insert_own" ON public.dragon_equipment FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "deq_update_own" ON public.dragon_equipment FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "deq_delete_own" ON public.dragon_equipment FOR DELETE USING (auth.uid() = user_id);

-- Get or init dragon function
CREATE OR REPLACE FUNCTION public.get_or_init_dragon()
RETURNS public.dragons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID;
  _d public.dragons;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid;
  IF NOT FOUND THEN
    INSERT INTO public.dragons (user_id) VALUES (_uid)
    RETURNING * INTO _d;
  END IF;
  RETURN _d;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_init_dragon() TO authenticated;
