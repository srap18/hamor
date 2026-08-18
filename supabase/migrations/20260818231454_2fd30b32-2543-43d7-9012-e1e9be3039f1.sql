DO $mig$
DECLARE src text; src2 text;
BEGIN
  -- 1) redeem_code: raise instead of silently skipping unknown ship codes in extras
  src := pg_get_functiondef('public.redeem_code(text)'::regprocedure);
  src2 := replace(src,
'      IF v_iid IS NOT NULL AND EXISTS (SELECT 1 FROM public.ship_catalog WHERE code = v_iid) THEN
        FOR i IN 1..v_iqty LOOP',
'      IF v_iid IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.ship_catalog WHERE code = v_iid) THEN
          RAISE EXCEPTION ''invalid_ship_code:%'', v_iid;
        END IF;
        FOR i IN 1..v_iqty LOOP');
  IF src2 = src THEN RAISE EXCEPTION 'redeem_code patch target not found'; END IF;
  EXECUTE src2;

  -- 2) legacy admin grant path: validate + use _grant_ship_with_storage, allow dragon equipment
  src := pg_get_functiondef('public.admin_redeem_code_for_legacy_20260717(text,uuid)'::regprocedure);
  src2 := replace(src,
'    SELECT sort_order INTO v_template_id FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    FOR i IN 1..v_qty LOOP
      INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp)
      SELECT v_user, COALESCE(v_template_id, 1), v_row.item_id, max_hp, max_hp
        FROM public.ship_catalog WHERE code = v_row.item_id LIMIT 1;
    END LOOP;',
'    IF NOT EXISTS (SELECT 1 FROM public.ship_catalog WHERE code = v_row.item_id) THEN
      RAISE EXCEPTION ''invalid_ship_code:%'', v_row.item_id;
    END IF;
    FOR i IN 1..v_qty LOOP
      IF public._grant_ship_with_storage(v_user, v_row.item_id) IS NULL THEN
        RAISE EXCEPTION ''fleet and storage full'';
      END IF;
    END LOOP;');
  IF src2 = src THEN RAISE EXCEPTION 'legacy patch #1 target not found'; END IF;
  src := src2;
  src2 := replace(src,
'          SELECT sort_order INTO v_template_id FROM public.ship_catalog WHERE code = v_iid LIMIT 1;
          FOR i IN 1..v_iqty LOOP
            INSERT INTO public.ships_owned (user_id, template_id, catalog_code, hp, max_hp)
            SELECT v_user, COALESCE(v_template_id, 1), v_iid, max_hp, max_hp
              FROM public.ship_catalog WHERE code = v_iid LIMIT 1;
          END LOOP;',
'          IF NOT EXISTS (SELECT 1 FROM public.ship_catalog WHERE code = v_iid) THEN
            RAISE EXCEPTION ''invalid_ship_code:%'', v_iid;
          END IF;
          FOR i IN 1..v_iqty LOOP
            IF public._grant_ship_with_storage(v_user, v_iid) IS NULL THEN
              RAISE EXCEPTION ''fleet and storage full'';
            END IF;
          END LOOP;');
  IF src2 = src THEN RAISE EXCEPTION 'legacy patch #2 target not found'; END IF;
  src := src2;
  src2 := replace(src,
'  PERFORM set_config(''app.allow_reward_ship_storage_overflow'', ''true'', true);',
'  PERFORM set_config(''app.allow_reward_ship_storage_overflow'', ''true'', true);
  PERFORM set_config(''app.allow_dragon_equipment_write'', ''true'', true);');
  IF src2 = src THEN RAISE EXCEPTION 'legacy patch #3 target not found'; END IF;
  EXECUTE src2;
END
$mig$;