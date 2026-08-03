CREATE OR REPLACE FUNCTION public.forum_topics_validate_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  combined text;
  bad text;
  lvl int;
  banned text[] := ARRAY[
    'كلب','كلاب','حمار','حمير','خنزير','خنازير','زفت','تفو',
    'قحب','قحبة','شرموط','شرموطة','عاهر','عاهرة','منيوك','منيوكة',
    'كس','كسك','كسمك','كسختك','كسامك','طيز','طيزك','زب','زبر','زبري',
    'نيك','نياك','منيك','انيك','نياكة','نياكه',
    'لعن','لعنة','يلعن','ملعون','ابن الكلب','ابن كلب','ابن العاهرة',
    'fuck','shit','bitch','asshole','dick','pussy','whore','slut','cunt'
  ];
BEGIN
  SELECT COALESCE(level, 1) INTO lvl FROM public.user_market WHERE user_id = NEW.user_id;
  IF COALESCE(lvl, 1) < 18 THEN
    RAISE EXCEPTION 'MARKET_LEVEL_18';
  END IF;

  combined := COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.body,'');

  IF combined ~* '(https?://|www\.|\.com|\.net|\.org|\.io|\.co|\.me|t\.me|wa\.me|bit\.ly|tinyurl)' THEN
    RAISE EXCEPTION 'NO_LINKS';
  END IF;

  IF combined ~ '[A-Za-z]' THEN
    RAISE EXCEPTION 'ARABIC_ONLY';
  END IF;

  FOREACH bad IN ARRAY banned LOOP
    IF position(bad IN lower(combined)) > 0 THEN
      RAISE EXCEPTION 'PROFANITY';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;