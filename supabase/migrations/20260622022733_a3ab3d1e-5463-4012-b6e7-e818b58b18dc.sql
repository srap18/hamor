
CREATE OR REPLACE FUNCTION public.normalize_ar(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(
    translate(
      regexp_replace(coalesce(p,''), '[\u064B-\u0652\u0670\u0640]', '', 'g'),
      'أإآٱىةؤئ',
      'اااايهوي'
    ),
    '\s+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.is_disallowed_religious_name(p_name text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n text;
  core text;
  allowed_prefixes text[] := ARRAY[
    'بسم الله','سبحان الله','حسبي الله','لا اله الا الله','الحمد لله','ماشاء الله','استغفر الله'
  ];
  divine_words text[] := ARRAY[
    'سميع','بصير','عليم','قدير','حكيم','رحيم','رحمن','كريم','عظيم','جليل','جبار','قهار',
    'ملك','قدوس','سلام','مؤمن','مهيمن','عزيز','متكبر','خالق','بارئ','مصور','غفار','وهاب',
    'رزاق','فتاح','قابض','باسط','خافض','رافع','معز','مذل','حكم','عدل','لطيف','خبير','حليم',
    'شكور','علي','كبير','حفيظ','مقيت','حسيب','مجيد','باعث','شهيد','حق','وكيل','قوي','متين',
    'ولي','حميد','محصي','مبدئ','معيد','محيي','مميت','حي','قيوم','واجد','ماجد','واحد','احد',
    'صمد','قادر','مقتدر','مقدم','مؤخر','اول','اخر','ظاهر','باطن','والي','متعالي','بر','تواب',
    'منتقم','عفو','رؤوف','مالك','مقسط','جامع','غني','مغني','مانع','ضار','نافع','نور','هادي',
    'بديع','باقي','وارث','رشيد','صبور',
    'اسد','سيف','حبيب','نبي','رسول','روح','كليم','خليل','وجه','يد','عبد','جند','حزب','انصار',
    'حجة','اية'
  ];
  w text;
BEGIN
  IF p_name IS NULL THEN RETURN false; END IF;
  n := lower(public.normalize_ar(p_name));
  core := btrim(regexp_replace(n, '[^\u0621-\u064Aa-z0-9 ]', ' ', 'g'));
  core := regexp_replace(core, '\s+', ' ', 'g');
  IF core = '' THEN RETURN false; END IF;

  FOREACH w IN ARRAY allowed_prefixes LOOP
    IF core = w OR core LIKE (w || ' %') OR core LIKE ('% ' || w) OR core LIKE ('% ' || w || ' %') THEN
      RETURN false;
    END IF;
  END LOOP;

  IF core !~ '(^|\s)(الله|لله|اله)(\s|$)' THEN
    RETURN false;
  END IF;

  FOREACH w IN ARRAY divine_words LOOP
    IF core ~ ('(^|\s)' || w || '\s+(الله|لله)(\s|$)')
       OR core ~ ('(^|\s)(الله|لله)\s+' || w || '(\s|$)') THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_ar(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_disallowed_religious_name(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_display_name_length()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.display_name IS NOT NULL AND char_length(NEW.display_name) > 15 THEN
    RAISE EXCEPTION 'display_name too long (max 15 characters)';
  END IF;
  IF NEW.display_name IS NOT NULL AND public.is_disallowed_religious_name(NEW.display_name) THEN
    RAISE EXCEPTION 'display_name_disallowed_religious';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  r record;
  new_name text;
BEGIN
  FOR r IN
    SELECT id, display_name FROM public.profiles
    WHERE public.is_disallowed_religious_name(display_name)
  LOOP
    new_name := 'لاعب-' || substr(replace(r.id::text,'-',''), 1, 5);
    UPDATE public.profiles
      SET display_name = new_name,
          username_changed_at = NULL
      WHERE id = r.id;
    INSERT INTO public.notifications (recipient_id, kind, title, body, meta)
    VALUES (
      r.id,
      'warning',
      'تنبيه: تم تغيير اسمك',
      'تم تغيير اسمك "' || r.display_name || '" لأنه يتعارض مع سياسة الأسماء (استخدام صفات/أسماء دينية مع لفظ الجلالة). الرجاء اختيار اسم جديد من صفحة الملف الشخصي. أمثلة مسموحة: بسم الله، سبحان الله، حسبي الله، لا إله إلا الله.',
      jsonb_build_object('old_name', r.display_name, 'new_name', new_name, 'reason','disallowed_religious_name')
    );
  END LOOP;
END $$;
