
CREATE OR REPLACE FUNCTION public.trg_attack_arena_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ws date;
  _mult numeric := 1;
  _active boolean := false;
  _ends timestamptz;
  _pts bigint;
BEGIN
  _ws := (date_trunc('week', (now() AT TIME ZONE 'UTC'))::date);
  SELECT event_active, event_multiplier, event_ends_at
    INTO _active, _mult, _ends
    FROM public.arena_settings LIMIT 1;
  IF _active IS TRUE AND (_ends IS NULL OR _ends > now()) THEN
    _mult := COALESCE(_mult, 1);
  ELSE
    _mult := 1;
  END IF;
  _pts := GREATEST(0, FLOOR(COALESCE(NEW.damage_dealt, 0)::numeric * _mult))::bigint;
  IF _pts <= 0 AND NEW.attacker_won IS NOT TRUE THEN RETURN NEW; END IF;
  INSERT INTO public.arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (NEW.attacker_id, _ws, _pts, CASE WHEN NEW.attacker_won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE
    SET score = arena_scores.score + EXCLUDED.score,
        wins  = arena_scores.wins  + EXCLUDED.wins,
        updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS t_attack_arena_score ON public.attacks;
CREATE TRIGGER t_attack_arena_score
  AFTER INSERT ON public.attacks
  FOR EACH ROW EXECUTE FUNCTION public.trg_attack_arena_score();
