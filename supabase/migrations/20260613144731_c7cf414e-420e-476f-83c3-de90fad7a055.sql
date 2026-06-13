
CREATE OR REPLACE FUNCTION public.get_player_dragon_public_info(_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _dragon jsonb;
  _equipment jsonb;
  _ach_unlocked int;
  _ach_total int;
BEGIN
  SELECT to_jsonb(d) - 'created_at' - 'updated_at' INTO _dragon
  FROM public.dragons d WHERE d.user_id = _uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'slot', e.slot, 'rarity', e.rarity, 'name', e.name, 'stats', e.stats
         ) ORDER BY e.slot), '[]'::jsonb)
  INTO _equipment
  FROM public.dragon_equipment e
  WHERE e.user_id = _uid AND e.equipped = true;

  SELECT COUNT(*) INTO _ach_unlocked
  FROM public.user_achievements ua
  WHERE ua.user_id = _uid AND ua.unlocked_at IS NOT NULL;

  SELECT COUNT(*) INTO _ach_total
  FROM public.achievements WHERE active = true;

  RETURN jsonb_build_object(
    'dragon', _dragon,
    'equipment', _equipment,
    'achievements_unlocked', COALESCE(_ach_unlocked, 0),
    'achievements_total', COALESCE(_ach_total, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_player_dragon_public_info(uuid) TO authenticated, anon;
