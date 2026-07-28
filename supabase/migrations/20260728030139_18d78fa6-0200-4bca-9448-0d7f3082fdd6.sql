
CREATE OR REPLACE FUNCTION public._cosmetic_expiry_days(_item_type text, _item_id text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _item_type = 'background' AND _item_id IN ('worldcup','cove') THEN NULL
    WHEN _item_type = 'background' THEN 7
    WHEN _item_type IN ('frame','name_frame','bubble_frame','profile_frame') THEN 30
    ELSE NULL
  END;
$function$;

-- Backfill: remove any expires_at from existing cove background rows.
UPDATE public.inventory
   SET meta = CASE
     WHEN meta IS NULL THEN NULL
     ELSE (meta - 'expires_at')
   END
 WHERE item_type = 'background'
   AND item_id = 'cove'
   AND meta ? 'expires_at';
