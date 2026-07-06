
-- Delete older duplicate pending reports, keep newest per group
DELETE FROM public.message_reports r
USING public.message_reports r2
WHERE r.status = 'pending'
  AND r2.status = 'pending'
  AND r.reporter_id = r2.reporter_id
  AND r.reported_user_id = r2.reported_user_id
  AND r.kind = r2.kind
  AND COALESCE(r.source_id, '') = COALESCE(r2.source_id, '')
  AND r.created_at < r2.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS message_reports_dedupe_idx
  ON public.message_reports (reporter_id, reported_user_id, kind, COALESCE(source_id, ''))
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.submit_message_report(
  _reported_user_id uuid,
  _kind text,
  _source_id text DEFAULT NULL,
  _message_body text DEFAULT '',
  _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _reporter uuid := auth.uid();
  _id uuid;
  _src text := NULLIF(_source_id, '');
BEGIN
  IF _reporter IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _reported_user_id IS NULL THEN RAISE EXCEPTION 'missing_reported_user'; END IF;
  IF _reported_user_id = _reporter THEN RAISE EXCEPTION 'cannot_report_self'; END IF;
  IF _kind NOT IN ('chat', 'ad_bomb', 'destroyer') THEN RAISE EXCEPTION 'bad_report_kind'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _reporter AND COALESCE(p.reports_disabled, false) = true) THEN
    RAISE EXCEPTION 'reports_disabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.message_reports
    WHERE reporter_id = _reporter
      AND reported_user_id = _reported_user_id
      AND kind = _kind
      AND COALESCE(source_id, '') = COALESCE(_src, '')
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'already_reported';
  END IF;

  INSERT INTO public.message_reports(reporter_id, reported_user_id, kind, source_id, message_body, reason)
  VALUES (_reporter, _reported_user_id, _kind, _src, LEFT(COALESCE(_message_body, ''), 2000), NULLIF(LEFT(BTRIM(COALESCE(_reason, '')), 400), ''))
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;
