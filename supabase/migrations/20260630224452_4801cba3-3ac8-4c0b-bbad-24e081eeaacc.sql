CREATE OR REPLACE FUNCTION public.fire_disabler(_target_id uuid, _disabler_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker UUID := auth.uid();
  _qty int;
  _anti_id text;
  _name text;
  _attacker_name text;
  _target_name text;
  _until TIMESTAMPTZ;
  _cur TIMESTAMPTZ;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target_id IS NULL OR _target_id = _attacker THEN RAISE EXCEPTION 'bad_target'; END IF;

  CASE _disabler_id
    WHEN 'disabler_rocket'  THEN _anti_id := 'anti_rocket';   _name := 'مضاد الصواريخ';
    WHEN 'disabler_nuke'    THEN _anti_id := 'anti_nuke';     _name := 'مضاد القنبلة الذرية';
    WHEN 'disabler_ad_bomb' THEN _anti_id := 'anti_ad_bomb';  _name := 'مضاد القنبلة الإعلانية';
    ELSE RAISE EXCEPTION 'unknown_disabler';
  END CASE;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target_id) THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id
    FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'not_enough'; END IF;

  IF _qty = 1 THEN
    DELETE FROM public.inventory
      WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
      WHERE user_id = _attacker AND item_type = 'disabler' AND item_id = _disabler_id;
  END IF;

  SELECT disabled_until INTO _cur FROM public.anti_disabled_state
    WHERE user_id = _target_id AND anti_id = _anti_id FOR UPDATE;
  _until := GREATEST(COALESCE(_cur, now()), now()) + interval '10 minutes';

  INSERT INTO public.anti_disabled_state(user_id, anti_id, disabled_until)
  VALUES (_target_id, _anti_id, _until)
  ON CONFLICT (user_id, anti_id) DO UPDATE SET disabled_until = EXCLUDED.disabled_until;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
  VALUES (_target_id, _attacker, 'anti_disabled',
    '⚡ تم تعطيل ' || _name,
    'اللاعب ' || COALESCE(_attacker_name,'لاعب') || ' عطّل ' || _name || ' لمدة 10 دقائق.',
    jsonb_build_object('anti_id', _anti_id, 'attacker_id', _attacker, 'disabled_until', _until));

  INSERT INTO public.notifications(recipient_id, created_by, kind, title, body, meta)
  VALUES (_attacker, _attacker, 'anti_disabled_attacker',
    '⚡ ' || _name || ' معطّل',
    'عطّلت ' || _name || ' لدى ' || COALESCE(_target_name,'لاعب') || ' لمدة 10 دقائق.',
    jsonb_build_object('anti_id', _anti_id, 'defender_id', _target_id, 'disabled_until', _until));

  RETURN jsonb_build_object('ok', true, 'disabled_until', _until);
END;
$function$;