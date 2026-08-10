DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname='profiles'
      AND t.tgname='trg_prevent_lower_elite_vip_extension'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Elite VIP lower-tier extension protection is missing';
  END IF;
END;
$verify$;