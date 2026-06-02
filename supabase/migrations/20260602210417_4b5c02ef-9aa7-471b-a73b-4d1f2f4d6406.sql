
CREATE OR REPLACE FUNCTION public.admin_recent_chat_senders(_limit int DEFAULT 10)
RETURNS TABLE (
  sender_id uuid,
  display_name text,
  avatar_url text,
  last_body text,
  last_at timestamptz,
  msg_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT m.sender_id, m.body, m.created_at,
           ROW_NUMBER() OVER (PARTITION BY m.sender_id ORDER BY m.created_at DESC) AS rn,
           COUNT(*) OVER (PARTITION BY m.sender_id) AS cnt,
           MAX(m.created_at) OVER (PARTITION BY m.sender_id) AS max_at
    FROM public.messages m
    WHERE m.channel = 'public'
      AND m.created_at > now() - interval '7 days'
  )
  SELECT r.sender_id,
         COALESCE(p.display_name, 'بحّار'),
         p.avatar_url,
         r.body,
         r.created_at,
         r.cnt
  FROM ranked r
  LEFT JOIN public.profiles p ON p.id = r.sender_id
  WHERE r.rn = 1
  ORDER BY r.max_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 100));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recent_chat_senders(int) TO authenticated;
