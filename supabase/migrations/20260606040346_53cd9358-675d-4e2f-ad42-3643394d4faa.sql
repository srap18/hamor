DROP FUNCTION IF EXISTS public.admin_recent_chat_senders(integer, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.admin_recent_chat_senders(
  _limit integer DEFAULT 10,
  _since timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(
  sender_id uuid,
  display_name text,
  avatar_url text,
  last_body text,
  last_at timestamp with time zone,
  msg_count bigint,
  distinct_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _from timestamptz := COALESCE(_since, now() - interval '7 days');
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT m.sender_id,
           m.body,
           m.created_at,
           lower(regexp_replace(COALESCE(m.body, ''), '\s+', '', 'g')) AS norm_body
    FROM public.messages m
    WHERE m.channel = 'public'
      AND m.created_at >= _from
  ),
  agg AS (
    SELECT b.sender_id,
           COUNT(*) AS cnt,
           COUNT(DISTINCT b.norm_body) AS distinct_cnt,
           MAX(b.created_at) AS max_at
    FROM base b
    GROUP BY b.sender_id
  ),
  ranked AS (
    SELECT b.sender_id, b.body, b.created_at,
           ROW_NUMBER() OVER (PARTITION BY b.sender_id ORDER BY b.created_at DESC) AS rn
    FROM base b
  )
  SELECT a.sender_id,
         COALESCE(p.display_name, 'بحّار'),
         p.avatar_url,
         r.body,
         r.created_at,
         a.cnt,
         a.distinct_cnt
  FROM agg a
  JOIN ranked r ON r.sender_id = a.sender_id AND r.rn = 1
  LEFT JOIN public.profiles p ON p.id = a.sender_id
  WHERE NOT (a.cnt >= 2 AND a.distinct_cnt <= 1)
  ORDER BY a.max_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 100));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_recent_chat_senders(integer, timestamp with time zone) TO authenticated;