
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS source_txn_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ships_owned_txn_slot_uniq
  ON public.ships_owned (user_id, source_txn_id, catalog_code, id)
  WHERE source_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ships_owned_source_txn_idx
  ON public.ships_owned (source_txn_id)
  WHERE source_txn_id IS NOT NULL;

-- Idempotent ship grant helper: inserts required ships only when the count for this txn is short.
CREATE OR REPLACE FUNCTION public.grant_pack_ships(
  _txn_id text,
  _user uuid,
  _phoenix int,
  _dragon_t1 int,
  _dragon_t2 int,
  _dragon_t3 int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_have int;
  v_missing int;
  v_total int := 0;
BEGIN
  IF _txn_id IS NULL OR _user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  -- Phoenix (template 31)
  IF COALESCE(_phoenix,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=31;
    v_missing := _phoenix - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id)
      SELECT _user, 31, 13000, 13000, false, 'ship-lvl-31', _txn_id FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  -- Dragon T1 (template 34)
  IF COALESCE(_dragon_t1,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=34;
    v_missing := _dragon_t1 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id)
      SELECT _user, 34, 20000, 20000, false, 'dragon-t1', _txn_id FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  -- Dragon T2 (template 35)
  IF COALESCE(_dragon_t2,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=35;
    v_missing := _dragon_t2 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id)
      SELECT _user, 35, 40000, 40000, false, 'dragon-t2', _txn_id FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  -- Dragon T3 (template 36)
  IF COALESCE(_dragon_t3,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=36;
    v_missing := _dragon_t3 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id)
      SELECT _user, 36, 60000, 60000, false, 'dragon-t3', _txn_id FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'inserted', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.grant_pack_ships(text, uuid, int, int, int, int) TO service_role;
