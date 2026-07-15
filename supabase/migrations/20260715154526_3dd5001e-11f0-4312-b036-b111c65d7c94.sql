
-- ============ Global bomb attack feed ============
CREATE TABLE IF NOT EXISTS public.global_attack_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id uuid,
  attacker_name text,
  target_id uuid,
  target_name text,
  kind text NOT NULL,
  damage integer DEFAULT 70000,
  at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.global_attack_feed TO anon, authenticated;
GRANT ALL ON public.global_attack_feed TO service_role;
ALTER TABLE public.global_attack_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read attack feed"
  ON public.global_attack_feed FOR SELECT
  TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_gaf_at ON public.global_attack_feed(at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.global_attack_feed;

-- ============ Global lucky-box wins feed ============
CREATE TABLE IF NOT EXISTS public.global_lucky_wins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  player_name text,
  rarity public.lucky_box_rarity NOT NULL,
  label text,
  icon text,
  amount bigint,
  prize_type text,
  at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.global_lucky_wins TO anon, authenticated;
GRANT ALL ON public.global_lucky_wins TO service_role;
ALTER TABLE public.global_lucky_wins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read lucky wins"
  ON public.global_lucky_wins FOR SELECT
  TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_glw_at ON public.global_lucky_wins(at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.global_lucky_wins;

-- ============ Append bombs to feed on stamp ============
CREATE OR REPLACE FUNCTION public.stamp_global_last_attack(
  _attacker_id uuid, _attacker_name text,
  _target_id uuid, _target_name text, _kind text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.global_last_attack(id, attacker_id, attacker_name, target_id, target_name, kind, at)
  VALUES (true, _attacker_id, _attacker_name, _target_id, _target_name, _kind, now())
  ON CONFLICT (id) DO UPDATE
    SET attacker_id = EXCLUDED.attacker_id,
        attacker_name = EXCLUDED.attacker_name,
        target_id = EXCLUDED.target_id,
        target_name = EXCLUDED.target_name,
        kind = EXCLUDED.kind,
        at = EXCLUDED.at;

  IF _kind IN ('nuke','ad_bomb') THEN
    INSERT INTO public.global_attack_feed(attacker_id, attacker_name, target_id, target_name, kind)
    VALUES (_attacker_id, _attacker_name, _target_id, _target_name, _kind);

    DELETE FROM public.global_attack_feed
     WHERE id IN (
       SELECT id FROM public.global_attack_feed ORDER BY at DESC OFFSET 20
     );
  END IF;
END;
$$;

-- ============ Broadcast rare / legendary lucky wins ============
CREATE OR REPLACE FUNCTION public.trg_broadcast_lucky_win()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _name text;
BEGIN
  IF NEW.rarity NOT IN ('rare','legendary') THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(display_name,''), NULLIF(username,''), 'لاعب')
    INTO _name
    FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.global_lucky_wins(user_id, player_name, rarity, label, icon, amount, prize_type)
  VALUES (NEW.user_id, COALESCE(_name,'لاعب'), NEW.rarity, NEW.label, NEW.icon, NEW.amount, NEW.prize_type);

  DELETE FROM public.global_lucky_wins
   WHERE id IN (
     SELECT id FROM public.global_lucky_wins ORDER BY at DESC OFFSET 30
   );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_lucky_win_ai ON public.lucky_box_opens;
CREATE TRIGGER trg_broadcast_lucky_win_ai
AFTER INSERT ON public.lucky_box_opens
FOR EACH ROW EXECUTE FUNCTION public.trg_broadcast_lucky_win();
