
CREATE OR REPLACE FUNCTION public.enforce_tribe_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.tribe_members WHERE tribe_id = NEW.tribe_id;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'tribe full (max 10 members)';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.warn_overfull_tribes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  m RECORD;
  v_warned int := 0;
  v_deadline timestamptz;
BEGIN
  FOR r IN
    SELECT t.id, t.name, t.overflow_warning_until,
           (SELECT count(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id) AS cnt
    FROM public.tribes t
  LOOP
    IF r.cnt > 10 THEN
      IF r.overflow_warning_until IS NULL OR r.overflow_warning_until < now() - interval '7 days' THEN
        v_deadline := now() + interval '24 hours';
        UPDATE public.tribes SET overflow_warning_until = v_deadline WHERE id = r.id;
        FOR m IN SELECT user_id FROM public.tribe_members WHERE tribe_id = r.id LOOP
          INSERT INTO public.notifications(recipient_id, title, body, kind, created_by)
          VALUES (m.user_id,
                  '⚠️ تنبيه: قبيلتك تجاوزت 10 أعضاء',
                  'قبيلة "' || r.name || '" فيها ' || r.cnt || ' أعضاء والحد الأقصى 10. أمامكم 24 ساعة لتقليص العدد وإلا سيتم طرد الأعضاء الأقل دعمًا تلقائيًا.',
                  'warning', NULL);
        END LOOP;
        v_warned := v_warned + 1;
      END IF;
    ELSE
      IF r.overflow_warning_until IS NOT NULL THEN
        UPDATE public.tribes SET overflow_warning_until = NULL WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
  RETURN v_warned;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_tribe_overflow_kicks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  victim uuid;
  v_count int;
  v_kicked int := 0;
  v_owner uuid;
  v_name text;
BEGIN
  FOR r IN
    SELECT t.id, t.name, t.owner_id,
           (SELECT count(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id) AS cnt
    FROM public.tribes t
    WHERE t.overflow_warning_until IS NOT NULL
      AND t.overflow_warning_until <= now()
  LOOP
    v_count := r.cnt;
    v_owner := r.owner_id;
    v_name := r.name;

    WHILE v_count > 10 LOOP
      SELECT tm.user_id INTO victim
      FROM public.tribe_members tm
      LEFT JOIN (
        SELECT user_id, COALESCE(SUM(amount),0) AS total
        FROM public.tribe_donations
        WHERE tribe_id = r.id
        GROUP BY user_id
      ) d ON d.user_id = tm.user_id
      WHERE tm.tribe_id = r.id
        AND tm.user_id <> v_owner
        AND COALESCE(tm.role,'member') <> 'owner'
      ORDER BY COALESCE(d.total, 0) ASC, tm.joined_at DESC NULLS LAST
      LIMIT 1;

      EXIT WHEN victim IS NULL;

      DELETE FROM public.tribe_members WHERE tribe_id = r.id AND user_id = victim;
      UPDATE public.profiles SET tribe_id = NULL WHERE id = victim AND tribe_id = r.id;

      INSERT INTO public.notifications(recipient_id, title, body, kind, created_by)
      VALUES (victim,
              '🚪 تم طردك من القبيلة',
              'تم طردك تلقائيًا من قبيلة "' || v_name || '" لأنها تجاوزت الحد الأقصى (10) ولم يتم تقليص العدد خلال المهلة. تم اختيار الأقل دعمًا.',
              'warning', NULL);

      v_kicked := v_kicked + 1;
      v_count := v_count - 1;
    END LOOP;

    UPDATE public.tribes SET overflow_warning_until = NULL WHERE id = r.id;
  END LOOP;

  RETURN v_kicked;
END;
$function$;

-- Clear stale overflow warnings for tribes now within the new 10-member limit
UPDATE public.tribes t
SET overflow_warning_until = NULL
WHERE overflow_warning_until IS NOT NULL
  AND (SELECT count(*) FROM public.tribe_members m WHERE m.tribe_id = t.id) <= 10;
