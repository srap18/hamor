-- 1) Raise tribe max to 8 (was 7)
CREATE OR REPLACE FUNCTION public.enforce_tribe_member_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.tribe_members WHERE tribe_id = NEW.tribe_id;
  IF v_count >= 8 THEN
    RAISE EXCEPTION 'tribe full (max 8 members)';
  END IF;
  RETURN NEW;
END; $$;

-- 2) Add warning-deadline column on tribes
ALTER TABLE public.tribes
  ADD COLUMN IF NOT EXISTS overflow_warning_until timestamptz;

-- 3) Function: warn overfull tribes (sets deadline + sends notifications)
CREATE OR REPLACE FUNCTION public.warn_overfull_tribes()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  m RECORD;
  v_count int;
  v_warned int := 0;
  v_deadline timestamptz;
BEGIN
  FOR r IN
    SELECT t.id, t.name, t.overflow_warning_until,
           (SELECT count(*) FROM public.tribe_members tm WHERE tm.tribe_id = t.id) AS cnt
    FROM public.tribes t
  LOOP
    IF r.cnt > 8 THEN
      IF r.overflow_warning_until IS NULL OR r.overflow_warning_until < now() - interval '7 days' THEN
        v_deadline := now() + interval '24 hours';
        UPDATE public.tribes SET overflow_warning_until = v_deadline WHERE id = r.id;
        FOR m IN SELECT user_id FROM public.tribe_members WHERE tribe_id = r.id LOOP
          INSERT INTO public.notifications(recipient_id, title, body, kind, created_by)
          VALUES (m.user_id,
                  '⚠️ تنبيه: قبيلتك تجاوزت 8 أعضاء',
                  'قبيلة "' || r.name || '" فيها ' || r.cnt || ' أعضاء والحد الأقصى الجديد 8. أمامكم 24 ساعة لتقليص العدد وإلا سيتم طرد الأعضاء الأقل دعمًا تلقائيًا.',
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
$$;
GRANT EXECUTE ON FUNCTION public.warn_overfull_tribes() TO service_role;

-- 4) Function: kick lowest-supporting members after deadline
CREATE OR REPLACE FUNCTION public.process_tribe_overflow_kicks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    WHILE v_count > 8 LOOP
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
              'تم طردك تلقائيًا من قبيلة "' || v_name || '" لأنها تجاوزت الحد الأقصى (8) ولم يتم تقليص العدد خلال المهلة. تم اختيار الأقل دعمًا.',
              'warning', NULL);

      v_kicked := v_kicked + 1;
      v_count := v_count - 1;
    END LOOP;

    UPDATE public.tribes SET overflow_warning_until = NULL WHERE id = r.id;
  END LOOP;

  RETURN v_kicked;
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_tribe_overflow_kicks() TO service_role;

-- 5) Schedule both via pg_cron (every 10 minutes)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('tribe-overflow-warn') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='tribe-overflow-warn');
    PERFORM cron.unschedule('tribe-overflow-kick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='tribe-overflow-kick');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('tribe-overflow-warn', '*/10 * * * *', $cron$SELECT public.warn_overfull_tribes();$cron$);
    PERFORM cron.schedule('tribe-overflow-kick', '*/10 * * * *', $cron$SELECT public.process_tribe_overflow_kicks();$cron$);
  END IF;
END $$;

-- 6) Run the warning right away for current overfull tribes
SELECT public.warn_overfull_tribes();