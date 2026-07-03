
-- Track per-type shield activation timestamps
CREATE TABLE IF NOT EXISTS public.shield_type_activations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  last_activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

GRANT SELECT ON public.shield_type_activations TO authenticated;
GRANT ALL ON public.shield_type_activations TO service_role;

ALTER TABLE public.shield_type_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own shield activations"
  ON public.shield_type_activations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Update RPC: enforce weekly per-type cooldown
CREATE OR REPLACE FUNCTION public.use_shield_from_inventory(_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_hours int;
  v_new timestamptz;
  v_qty int;
  v_cd timestamptz;
  v_last timestamptz;
  v_week_secs int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT shield_cooldown_until INTO v_cd FROM public.profiles WHERE id = v_user;
  IF v_cd IS NOT NULL AND v_cd > now() THEN
    RAISE EXCEPTION 'shield_cooldown:%', EXTRACT(EPOCH FROM (v_cd - now()))::int;
  END IF;

  v_hours := CASE _item_id
    WHEN 'shield_1h'  THEN 1
    WHEN 'shield_4h'  THEN 4
    WHEN 'shield_1d'  THEN 24
    WHEN 'shield_2d'  THEN 48
    WHEN 'shield_7d'  THEN 24 * 7
    WHEN 'shield_30d' THEN 24 * 30
    ELSE 0 END;
  IF v_hours = 0 THEN RAISE EXCEPTION 'invalid_shield'; END IF;

  -- Per-type weekly cooldown (each shield type can be activated once per 7 days)
  SELECT last_activated_at INTO v_last
    FROM public.shield_type_activations
   WHERE user_id = v_user AND item_id = _item_id
   FOR UPDATE;
  IF v_last IS NOT NULL AND v_last + interval '7 days' > now() THEN
    v_week_secs := EXTRACT(EPOCH FROM ((v_last + interval '7 days') - now()))::int;
    RAISE EXCEPTION 'shield_type_cooldown:%', v_week_secs;
  END IF;

  SELECT quantity INTO v_qty FROM public.inventory
   WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield'
   FOR UPDATE LIMIT 1;
  IF v_qty IS NULL OR v_qty < 1 THEN RAISE EXCEPTION 'not_enough'; END IF;

  IF v_qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
     WHERE user_id = v_user AND item_id = _item_id AND item_type = 'shield';
  END IF;

  SELECT GREATEST(now(), COALESCE(protection_until, now())) + make_interval(hours => v_hours)
    INTO v_new FROM public.profiles WHERE id = v_user;
  UPDATE public.profiles SET protection_until = v_new WHERE id = v_user;

  -- Record activation timestamp for this type
  INSERT INTO public.shield_type_activations (user_id, item_id, last_activated_at)
  VALUES (v_user, _item_id, now())
  ON CONFLICT (user_id, item_id)
  DO UPDATE SET last_activated_at = now();

  RETURN jsonb_build_object('ok', true, 'until', v_new, 'hours', v_hours);
END;
$function$;
