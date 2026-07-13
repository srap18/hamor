
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS storage_capacity int NOT NULL DEFAULT 3;

CREATE OR REPLACE FUNCTION public.upgrade_ship_storage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cost int := 10000;
  v_max int := 20;
  v_current int;
  v_gems bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT storage_capacity, gems INTO v_current, v_gems
    FROM public.profiles WHERE user_id = v_uid FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF v_current >= v_max THEN
    RAISE EXCEPTION 'max storage reached';
  END IF;

  IF COALESCE(v_gems,0) < v_cost THEN
    RAISE EXCEPTION 'not enough gems';
  END IF;

  UPDATE public.profiles
    SET gems = gems - v_cost,
        storage_capacity = storage_capacity + 1
    WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'new_capacity', v_current + 1,
    'gems_spent', v_cost
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upgrade_ship_storage() TO authenticated;
