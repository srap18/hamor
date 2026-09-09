-- 1) Hide orphaned rows from the admin inventory leaderboard
CREATE OR REPLACE FUNCTION public.admin_top_inventory_holders(_item_type text DEFAULT NULL::text, _item_id text DEFAULT NULL::text, _limit integer DEFAULT 100)
 RETURNS TABLE(user_id uuid, display_name text, username text, avatar_url text, avatar_emoji text, ship_market_level integer, total_qty bigint, breakdown jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH inv AS (
    SELECT i.user_id AS uid, i.item_type AS it, i.item_id AS iid, SUM(i.quantity)::bigint AS qty
    FROM public.inventory i
    WHERE i.quantity > 0
      AND (_item_type IS NULL OR i.item_type = _item_type)
      AND (_item_id IS NULL OR i.item_id = _item_id)
    GROUP BY 1,2,3
  ), agg AS (
    SELECT inv.uid,
           SUM(inv.qty)::bigint AS total,
           jsonb_agg(jsonb_build_object('item_type', inv.it, 'item_id', inv.iid, 'qty', inv.qty)
                     ORDER BY inv.qty DESC) AS bd
    FROM inv GROUP BY inv.uid
  )
  SELECT a.uid,
         COALESCE(p.display_name, p.username, 'لاعب'),
         p.username,
         p.avatar_url,
         p.avatar_emoji,
         COALESCE(um.level, 0),
         a.total,
         a.bd
  FROM agg a
  JOIN public.profiles p ON p.id = a.uid
  LEFT JOIN public.user_market um ON um.user_id = a.uid
  ORDER BY a.total DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
END;
$function$;

-- 2) Hard delete now sweeps tables that have a user_id column WITHOUT any FK
--    (inventory, user_market, user_market_state, user_ips, transactions,
--    transaction_logs, economy_audit, attacks, steal_log, ...)
CREATE OR REPLACE FUNCTION public.admin_hard_delete_user(_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  pass int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;
  IF auth.uid() IS NOT NULL AND _uid = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_DELETE_SELF';
  END IF;

  SET LOCAL session_replication_role = 'replica';

  -- Pass A: tables with an FK to auth.users / public.profiles
  FOR pass IN 1..2 LOOP
    FOR r IN
      SELECT c.conrelid::regclass::text AS tbl,
             a.attname                  AS col,
             a.attnotnull               AS notnull
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f'
        AND n.nspname = 'public'
        AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
        AND array_length(c.conkey, 1) = 1
    LOOP
      IF r.tbl = 'profiles' THEN
        CONTINUE;
      END IF;
      IF r.notnull THEN
        EXECUTE format('DELETE FROM %s WHERE %I = $1', r.tbl, r.col) USING _uid;
      ELSE
        EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING _uid;
      END IF;
    END LOOP;
  END LOOP;

  -- Pass B: orphan-prone tables with a user_id column but NO foreign key at all
  FOR r IN
    SELECT t.table_name AS tbl
    FROM information_schema.columns t
    WHERE t.table_schema = 'public'
      AND t.column_name = 'user_id'
      AND t.table_name <> 'profiles'
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.key_column_usage k
        JOIN information_schema.table_constraints tc
          ON tc.constraint_name = k.constraint_name
         AND tc.table_schema   = k.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND k.table_schema = 'public'
          AND k.table_name   = t.table_name
          AND k.column_name  = 'user_id'
      )
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', r.tbl) USING _uid;
  END LOOP;

  -- Self-references on profiles then the profile itself
  FOR r IN
    SELECT a.attname AS col
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.profiles'::regclass
      AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
      AND NOT a.attnotnull
  LOOP
    EXECUTE format('UPDATE public.profiles SET %I = NULL WHERE %I = $1', r.col, r.col) USING _uid;
  END LOOP;

  DELETE FROM public.profiles WHERE id = _uid;
END;
$function$;

-- 3) Clean up the known orphaned account (displayed as "لاعب" with 809 nukes)
SELECT public.admin_hard_delete_user('d245f49e-1cd6-4eb3-a06e-cd063d9fd2f2');

-- 4) Sweep any other orphaned inventory rows left behind by past deletions
DELETE FROM public.inventory i
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.user_id);

DELETE FROM public.user_market um
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = um.user_id);

DELETE FROM public.user_market_state ums
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ums.user_id);