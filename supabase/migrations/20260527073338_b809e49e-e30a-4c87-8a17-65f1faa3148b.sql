
-- 1) أعمدة جديدة في profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bubble_frame text,
  ADD COLUMN IF NOT EXISTS profile_frame text;

-- 2) السماح للمستخدم بتعديل الحقول الجديدة
GRANT UPDATE (online_at, display_name, avatar_emoji, avatar_url,
              avatar_frame, name_frame, bubble_frame, profile_frame,
              selected_bg_id)
  ON public.profiles TO authenticated;

-- 3) السماح بنوعَي عنصر جديدين في المخزون
ALTER TABLE public.inventory
  DROP CONSTRAINT IF EXISTS inventory_item_type_check;
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'crew','weapon','consumable','decoration','frame','background',
    'name_frame','bubble_frame','profile_frame'
  ]));

-- 4) تحديث دوال شراء/تجهيز العناصر لقبول الأنواع الجديدة
CREATE OR REPLACE FUNCTION public.buy_with_gems(
  _item_id text, _item_type text, _price int, _meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _bal int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('error','unauth'); END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable',
                        'name_frame','bubble_frame','profile_frame') THEN
    RETURN jsonb_build_object('error','bad_type');
  END IF;
  SELECT gems INTO _bal FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF coalesce(_bal,0) < _price THEN RETURN jsonb_build_object('error','insufficient'); END IF;
  UPDATE public.profiles SET gems = gems - _price WHERE id = _uid;

  IF _item_type IN ('frame','background','name_frame','bubble_frame','profile_frame') THEN
    INSERT INTO public.inventory(user_id, item_id, item_type, meta)
    VALUES (_uid, _item_id, _item_type, coalesce(_meta,'{}'::jsonb))
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.inventory(user_id, item_id, item_type, meta)
    VALUES (_uid, _item_id, _item_type, coalesce(_meta,'{}'::jsonb));
  END IF;

  RETURN jsonb_build_object('ok',true);
END;
$$;

-- 5) تحديث الدوال العامة لإرجاع الإطارات الجديدة
CREATE OR REPLACE FUNCTION public.get_profiles_public(_ids uuid[])
RETURNS TABLE(
  id uuid, display_name text, avatar_emoji text, avatar_url text,
  level int, xp int, name_frame text, avatar_frame text,
  bubble_frame text, profile_frame text,
  selected_bg_id text, tribe_id uuid, online_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, display_name, avatar_emoji, avatar_url, level, xp,
         name_frame, avatar_frame, bubble_frame, profile_frame,
         selected_bg_id, tribe_id, online_at, created_at
  FROM public.profiles WHERE id = ANY(_ids);
$$;

CREATE OR REPLACE FUNCTION public.search_profiles_public(_q text, _limit int DEFAULT 20)
RETURNS TABLE(
  id uuid, display_name text, avatar_emoji text, avatar_url text,
  level int, xp int, name_frame text, avatar_frame text,
  bubble_frame text, profile_frame text,
  selected_bg_id text, tribe_id uuid, online_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, display_name, avatar_emoji, avatar_url, level, xp,
         name_frame, avatar_frame, bubble_frame, profile_frame,
         selected_bg_id, tribe_id, online_at, created_at
  FROM public.profiles
  WHERE display_name ILIKE '%' || _q || '%'
    AND id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY level DESC NULLS LAST
  LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.get_online_players(_limit int DEFAULT 20)
RETURNS TABLE(
  id uuid, display_name text, avatar_emoji text, avatar_url text,
  level int, xp int, name_frame text, avatar_frame text,
  bubble_frame text, profile_frame text,
  selected_bg_id text, tribe_id uuid, online_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, display_name, avatar_emoji, avatar_url, level, xp,
         name_frame, avatar_frame, bubble_frame, profile_frame,
         selected_bg_id, tribe_id, online_at, created_at
  FROM public.profiles
  WHERE online_at >= (now() - interval '5 minutes')
    AND id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY online_at DESC LIMIT _limit;
$$;
