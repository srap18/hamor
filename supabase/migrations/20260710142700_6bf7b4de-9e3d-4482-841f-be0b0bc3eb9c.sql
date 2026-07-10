CREATE OR REPLACE FUNCTION public.grant_pack_ships(_txn_id text, _user uuid, _phoenix integer, _dragon_t1 integer, _dragon_t2 integer, _dragon_t3 integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_have int;
  v_missing int;
  v_total int := 0;
BEGIN
  IF _txn_id IS NULL OR _user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  -- Paid ships bypass fleet/storage caps enforced by _auto_route_new_ship trigger.
  PERFORM set_config('app.allow_reward_ship_storage_overflow', 'true', true);

  IF COALESCE(_phoenix,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=31;
    v_missing := _phoenix - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 31, 13000, 13000, false, 'ship-lvl-31', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  IF COALESCE(_dragon_t1,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=34;
    v_missing := _dragon_t1 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 34, 20000, 20000, false, 'dragon-t1', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  IF COALESCE(_dragon_t2,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=35;
    v_missing := _dragon_t2 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 35, 40000, 40000, false, 'dragon-t2', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  IF COALESCE(_dragon_t3,0) > 0 THEN
    SELECT count(*) INTO v_have FROM ships_owned
      WHERE user_id=_user AND source_txn_id=_txn_id AND template_id=36;
    v_missing := _dragon_t3 - v_have;
    IF v_missing > 0 THEN
      INSERT INTO ships_owned (user_id, template_id, hp, max_hp, at_sea, catalog_code, source_txn_id, in_storage)
      SELECT _user, 36, 60000, 60000, false, 'dragon-t3', _txn_id, true FROM generate_series(1, v_missing);
      v_total := v_total + v_missing;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'inserted', v_total);
END $function$;