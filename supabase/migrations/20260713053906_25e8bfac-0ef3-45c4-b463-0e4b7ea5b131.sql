CREATE OR REPLACE FUNCTION public.ship_to_storage(p_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _storage_count int;
  _storage_capacity int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _row
  FROM public.ships_owned
  WHERE id = p_ship_id AND user_id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _row.in_storage THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_stored');
  END IF;
  IF _row.at_sea THEN RAISE EXCEPTION 'ship is at sea'; END IF;
  IF _row.stealing_target_user_id IS NOT NULL THEN RAISE EXCEPTION 'ship on mission'; END IF;
  IF _row.destroyed_at IS NOT NULL
     AND _row.repair_ends_at IS NOT NULL
     AND _row.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT COALESCE(storage_capacity, 3)
  INTO _storage_capacity
  FROM public.profiles
  WHERE id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'profile not found'; END IF;

  SELECT COUNT(*) INTO _storage_count
  FROM public.ships_owned
  WHERE user_id = _uid AND in_storage = true;

  IF _storage_count >= _storage_capacity THEN
    RAISE EXCEPTION 'storage full';
  END IF;

  UPDATE public.ships_owned
  SET in_storage = true
  WHERE id = p_ship_id;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'stored',
    'stored_count', _storage_count + 1,
    'storage_capacity', _storage_capacity
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.upgrade_ship_storage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cost int := 10000;
  v_max int := 20;
  v_current int;
  v_gems bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT COALESCE(storage_capacity, 3), gems
  INTO v_current, v_gems
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'profile not found'; END IF;
  IF v_current >= v_max THEN RAISE EXCEPTION 'max storage reached'; END IF;
  IF COALESCE(v_gems, 0) < v_cost THEN RAISE EXCEPTION 'not enough gems'; END IF;

  PERFORM set_config('app.audit_source', 'ship_storage_upgrade', true);
  PERFORM set_config(
    'app.audit_reason',
    format('ترقية سعة مخزن السفن من %s إلى %s مقابل %s جوهرة', v_current, v_current + 1, v_cost),
    true
  );

  UPDATE public.profiles
  SET gems = gems - v_cost,
      storage_capacity = v_current + 1
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'new_capacity', v_current + 1,
    'gems_spent', v_cost,
    'gems_remaining', v_gems - v_cost
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.ship_to_storage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_ship_storage() TO authenticated;

DO $compensation$
DECLARE
  _user_id uuid := '869808e0-d8ef-4b07-8425-16b69cb08fe5'::uuid;
  _refund bigint := 50000;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.economy_audit
    WHERE user_id = _user_id
      AND source = 'ship_storage_defect_compensation_v2'
  ) THEN
    PERFORM set_config('app.audit_source', 'ship_storage_defect_compensation_v2', true);
    PERFORM set_config(
      'app.audit_reason',
      'إكمال رد جواهر ترقيات مخزن السفن أثناء خلل الحد الثابت؛ السعة المشتراة محفوظة',
      true
    );

    UPDATE public.profiles
    SET gems = gems + _refund
    WHERE id = _user_id;

    INSERT INTO public.notifications (recipient_id, title, body, kind, meta)
    VALUES (
      _user_id,
      '🎁 تعويض ترقية مخزن السفن',
      'تم إصلاح حد المخزن وإضافة 50,000 جوهرة. مع التعويض السابق 30,000 تم رد كامل 80,000 جوهرة، وبقيت سعتك المشتراة محفوظة وتعمل الآن.',
      'compensation',
      jsonb_build_object(
        'source', 'ship_storage_defect_compensation_v2',
        'gems', _refund,
        'total_refunded', 80000,
        'storage_capacity_kept', true
      )
    );
  END IF;
END
$compensation$;