CREATE OR REPLACE FUNCTION public.pvp_support_requirement_error(_user_id uuid, _actor_label text DEFAULT 'sender'::text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _market integer;
BEGIN
  _market := public.effective_market_level(_user_id);
  IF _market < 6 THEN
    RETURN COALESCE(_actor_label, 'sender') || ' market level under 6: current=' || _market::text;
  END IF;
  RETURN NULL;
END
$function$;

GRANT EXECUTE ON FUNCTION public.pvp_support_requirement_error(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_support_impl(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _sender_name text;
  _sender_emoji text;
  _ship_owner uuid;
  _inv_id uuid;
  _crew_qty int;
  _msg text;
  _title text;
  _body_action text;
  _expires timestamptz := now() + interval '24 hours';
  _is_fixer boolean;
  _is_fixer_legendary boolean;
  _is_trader boolean;
  _is_market_expert boolean;
  _is_golden_fisher boolean;
  _is_persistent boolean;
  _heal int := 0;
  _affected int := 0;
  _trader_ends timestamptz;
  _crew_label text;
  _gf_current timestamptz;
  _gf_new_until timestamptz;
  _req_error text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  PERFORM public._prep_pvp_checks(_me);
  PERFORM public._prep_pvp_checks(_recipient_id);

  IF public.is_banned(_me) THEN RAISE EXCEPTION 'account banned'; END IF;
  IF public.is_banned(_recipient_id) THEN RAISE EXCEPTION 'recipient banned'; END IF;

  IF NOT public.is_admin(_me) THEN
    _req_error := public.pvp_support_requirement_error(_me, 'sender');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

    _req_error := public.pvp_support_requirement_error(_recipient_id, 'recipient');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'recipient is a new player (%).', _req_error; END IF;

    IF public.users_same_device(_me, _recipient_id) THEN
      INSERT INTO public.account_links(user_a, user_b, link_type, details)
      VALUES (_me, _recipient_id, 'device', jsonb_build_object('via','send_support'))
      ON CONFLICT DO NOTHING;
      PERFORM public.flag_cheat(_me, 'same_device_support', 3,
        jsonb_build_object('recipient', _recipient_id, 'kind', _kind));
      PERFORM public.flag_cheat(_recipient_id, 'same_device_support', 3,
        jsonb_build_object('sender', _me, 'kind', _kind));
      RAISE EXCEPTION 'blocked: cannot send support to an account on the same device';
    END IF;
  END IF;

  -- Delegate to the existing implementation body for the actual work.
  PERFORM public.send_support_body(_me, _recipient_id, _ship_id, _kind, _crew_id);
END;
$function$;