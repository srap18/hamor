CREATE OR REPLACE FUNCTION public.season_frame_earned(_uid uuid, _frame_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _frame_id IS NULL OR _frame_id !~ '^sf_([1-9]|10)$' THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.season_results r
      WHERE r.user_id = _uid
        AND r.frame_tier >= substring(_frame_id from 4)::int
    ) OR EXISTS (
      SELECT 1 FROM public.season_damage d
      WHERE d.user_id = _uid
        AND d.damage_total >= substring(_frame_id from 4)::bigint * 100000000
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.season_frame_earned(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._enforce_cosmetic_selection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ok boolean;
BEGIN
  IF NEW.selected_bg_id IS NOT NULL AND NEW.selected_bg_id <> 'cove'
     AND (OLD.selected_bg_id IS DISTINCT FROM NEW.selected_bg_id) THEN
    SELECT EXISTS (SELECT 1 FROM public.inventory i
      WHERE i.user_id=NEW.id AND i.item_type='background' AND i.item_id=NEW.selected_bg_id
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > now())) INTO _ok;
    IF NOT _ok THEN NEW.selected_bg_id := 'cove'; END IF;
  END IF;
  IF NEW.avatar_frame IS NOT NULL AND (OLD.avatar_frame IS DISTINCT FROM NEW.avatar_frame) THEN
    SELECT public.season_frame_earned(NEW.id, NEW.avatar_frame) OR EXISTS (SELECT 1 FROM public.inventory i
      WHERE i.user_id=NEW.id AND i.item_type='frame' AND i.item_id=NEW.avatar_frame
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > now())) INTO _ok;
    IF NOT _ok THEN NEW.avatar_frame := NULL; END IF;
  END IF;
  IF NEW.name_frame IS NOT NULL AND (OLD.name_frame IS DISTINCT FROM NEW.name_frame) THEN
    SELECT EXISTS (SELECT 1 FROM public.inventory i
      WHERE i.user_id=NEW.id AND i.item_type='name_frame' AND i.item_id=NEW.name_frame
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > now())) INTO _ok;
    IF NOT _ok THEN NEW.name_frame := NULL; END IF;
  END IF;
  IF NEW.bubble_frame IS NOT NULL AND (OLD.bubble_frame IS DISTINCT FROM NEW.bubble_frame) THEN
    SELECT EXISTS (SELECT 1 FROM public.inventory i
      WHERE i.user_id=NEW.id AND i.item_type='bubble_frame' AND i.item_id=NEW.bubble_frame
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > now())) INTO _ok;
    IF NOT _ok THEN NEW.bubble_frame := NULL; END IF;
  END IF;
  IF NEW.profile_frame IS NOT NULL AND (OLD.profile_frame IS DISTINCT FROM NEW.profile_frame) THEN
    SELECT EXISTS (SELECT 1 FROM public.inventory i
      WHERE i.user_id=NEW.id AND i.item_type='profile_frame' AND i.item_id=NEW.profile_frame
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > now())) INTO _ok;
    IF NOT _ok THEN NEW.profile_frame := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;