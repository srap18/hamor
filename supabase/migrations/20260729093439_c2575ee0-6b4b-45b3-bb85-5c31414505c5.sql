DO $$
DECLARE
  v_max_hp int;
BEGIN
  -- Use max_hp from a reference 5/5 submarine of same owner-tier (best effort: max across all 5/5 upgrade-sub)
  SELECT MAX(max_hp) INTO v_max_hp FROM public.ships_owned WHERE catalog_code='upgrade-sub' AND stars=5 AND max_stars=5;

  UPDATE public.ships_owned
  SET stars = 5,
      max_stars = 5,
      max_hp = COALESCE(v_max_hp, max_hp),
      hp = COALESCE(v_max_hp, max_hp)
  WHERE id = 'a86089d7-0857-4b88-afe9-918a3e9fd63e'
    AND user_id = '68e7b007-6b17-4335-aceb-8198e605b80e';
END $$;