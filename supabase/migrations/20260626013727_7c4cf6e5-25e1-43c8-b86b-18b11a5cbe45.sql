
DROP FUNCTION IF EXISTS public.boss_award_pearls(bigint);
DROP TABLE IF EXISTS public.dragon_boss_pearl_claims;

CREATE TABLE public.dragon_boss_pearl_claims (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  boss_id  uuid NOT NULL,
  pearls   integer NOT NULL DEFAULT 20,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, boss_id)
);

GRANT SELECT ON public.dragon_boss_pearl_claims TO authenticated;
GRANT ALL    ON public.dragon_boss_pearl_claims TO service_role;

ALTER TABLE public.dragon_boss_pearl_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dbpc_select_own"
  ON public.dragon_boss_pearl_claims FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.boss_award_pearls(_boss_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _new int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  IF _boss_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_args'); END IF;

  INSERT INTO public.dragon_boss_pearl_claims(user_id, boss_id, pearls)
  VALUES (_uid, _boss_id, 20)
  ON CONFLICT (user_id, boss_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT pearls INTO _new FROM public.dragons WHERE user_id = _uid;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed', 'pearls', COALESCE(_new, 0));
  END IF;

  UPDATE public.dragons
     SET pearls = pearls + 20,
         updated_at = now()
   WHERE user_id = _uid
  RETURNING pearls INTO _new;
  IF _new IS NULL THEN
    INSERT INTO public.dragons(user_id, pearls) VALUES (_uid, 20)
    ON CONFLICT (user_id) DO UPDATE SET pearls = public.dragons.pearls + 20;
    SELECT pearls INTO _new FROM public.dragons WHERE user_id = _uid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'pearls', _new, 'awarded', 20);
END;
$$;
GRANT EXECUTE ON FUNCTION public.boss_award_pearls(uuid) TO authenticated;
