
-- Singleton table to track the last global bomb attack (nuke or ad_bomb)
CREATE TABLE IF NOT EXISTS public.global_last_attack (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  attacker_id uuid,
  attacker_name text,
  target_id uuid,
  target_name text,
  kind text,
  at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.global_last_attack TO anon, authenticated;
GRANT ALL ON public.global_last_attack TO service_role;

ALTER TABLE public.global_last_attack ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read last attack" ON public.global_last_attack;
CREATE POLICY "anyone can read last attack"
  ON public.global_last_attack FOR SELECT
  USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.global_last_attack;

-- Seed the singleton row
INSERT INTO public.global_last_attack (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- Helper: stamp the global ticker (security definer so it runs from within SECURITY DEFINER game funcs)
CREATE OR REPLACE FUNCTION public.stamp_global_last_attack(
  _attacker_id uuid, _attacker_name text,
  _target_id uuid, _target_name text,
  _kind text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.global_last_attack(id, attacker_id, attacker_name, target_id, target_name, kind, at)
  VALUES (true, _attacker_id, _attacker_name, _target_id, _target_name, _kind, now())
  ON CONFLICT (id) DO UPDATE
    SET attacker_id = EXCLUDED.attacker_id,
        attacker_name = EXCLUDED.attacker_name,
        target_id = EXCLUDED.target_id,
        target_name = EXCLUDED.target_name,
        kind = EXCLUDED.kind,
        at = EXCLUDED.at;
$$;
