CREATE OR REPLACE FUNCTION public.update_tribe_details(_tribe_id uuid, _description text, _banner text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_tribe_officer(_uid, _tribe_id) THEN
    RAISE EXCEPTION 'only officer';
  END IF;
  UPDATE public.tribes SET
    description = COALESCE(left(_description, 240), description),
    banner = CASE WHEN _banner IS NULL OR _banner = '' THEN banner ELSE left(_banner, 8) END
  WHERE id = _tribe_id;
  RETURN json_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.set_tribe_join_mode(_tribe_id uuid, _mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _mode NOT IN ('open','request') THEN RAISE EXCEPTION 'invalid mode'; END IF;
  IF NOT public.is_tribe_officer(auth.uid(), _tribe_id) THEN
    RAISE EXCEPTION 'only officer';
  END IF;
  UPDATE public.tribes SET join_mode = _mode WHERE id = _tribe_id;
END; $$;