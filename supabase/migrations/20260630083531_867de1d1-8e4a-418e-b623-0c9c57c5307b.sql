CREATE OR REPLACE FUNCTION public._require_market_level(_min int)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  -- شرط مستوى سوق السفن أُزيل: أي لاعب لديه طاقم في مخزنه يقدر يستخدمه على سفنه.
  RETURN;
END $$;