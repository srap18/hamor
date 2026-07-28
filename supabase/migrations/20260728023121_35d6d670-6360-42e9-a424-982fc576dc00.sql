CREATE OR REPLACE FUNCTION public._cosmetic_expiry_days(_item_type text, _item_id text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _item_type = 'background' AND _item_id = 'worldcup' THEN NULL
    WHEN _item_type = 'background' THEN 7
    WHEN _item_type IN ('frame','name_frame','bubble_frame','profile_frame') THEN 30
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public._stamp_cosmetic_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _days integer;
BEGIN
  _days := public._cosmetic_expiry_days(NEW.item_type, NEW.item_id);
  IF _days IS NULL THEN RETURN NEW; END IF;
  IF NEW.meta IS NULL THEN NEW.meta := '{}'::jsonb; END IF;
  IF (NEW.meta ->> 'expires_at') IS NULL THEN
    NEW.meta := NEW.meta || jsonb_build_object('expires_at', (now() + make_interval(days => _days))::text);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_stamp_cosmetic_expiry ON public.inventory;
CREATE TRIGGER trg_stamp_cosmetic_expiry
  BEFORE INSERT ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public._stamp_cosmetic_expiry();

CREATE OR REPLACE FUNCTION public._enforce_cosmetic_selection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    SELECT EXISTS (SELECT 1 FROM public.inventory i
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
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_cosmetic_selection ON public.profiles;
CREATE TRIGGER trg_enforce_cosmetic_selection
  BEFORE UPDATE OF selected_bg_id, avatar_frame, name_frame, bubble_frame, profile_frame
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._enforce_cosmetic_selection();

CREATE OR REPLACE FUNCTION public.cleanup_expired_cosmetics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles p SET selected_bg_id = 'cove'
   WHERE p.selected_bg_id IS NOT NULL AND p.selected_bg_id <> 'cove'
     AND EXISTS (SELECT 1 FROM public.inventory i
       WHERE i.user_id=p.id AND i.item_type='background' AND i.item_id=p.selected_bg_id
         AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles p SET avatar_frame = NULL WHERE p.avatar_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=p.id AND i.item_type='frame' AND i.item_id=p.avatar_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles p SET name_frame = NULL WHERE p.name_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=p.id AND i.item_type='name_frame' AND i.item_id=p.name_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles p SET bubble_frame = NULL WHERE p.bubble_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=p.id AND i.item_type='bubble_frame' AND i.item_id=p.bubble_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles p SET profile_frame = NULL WHERE p.profile_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=p.id AND i.item_type='profile_frame' AND i.item_id=p.profile_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  DELETE FROM public.inventory
   WHERE item_type IN ('frame','name_frame','bubble_frame','profile_frame','background')
     AND (meta->>'expires_at') IS NOT NULL AND (meta->>'expires_at')::timestamptz <= now();
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_my_expired_cosmetics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  UPDATE public.profiles SET selected_bg_id='cove'
   WHERE id=_uid AND selected_bg_id IS NOT NULL AND selected_bg_id<>'cove'
     AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='background' AND i.item_id=selected_bg_id AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles SET avatar_frame=NULL WHERE id=_uid AND avatar_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='frame' AND i.item_id=avatar_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles SET name_frame=NULL WHERE id=_uid AND name_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='name_frame' AND i.item_id=name_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles SET bubble_frame=NULL WHERE id=_uid AND bubble_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='bubble_frame' AND i.item_id=bubble_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles SET profile_frame=NULL WHERE id=_uid AND profile_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='profile_frame' AND i.item_id=profile_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  DELETE FROM public.inventory
   WHERE user_id=_uid
     AND item_type IN ('frame','name_frame','bubble_frame','profile_frame','background')
     AND (meta->>'expires_at') IS NOT NULL AND (meta->>'expires_at')::timestamptz <= now();
END $$;

DROP FUNCTION IF EXISTS public.buy_with_gems(text, text, integer, jsonb);