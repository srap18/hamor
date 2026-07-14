-- Only require email verification for NEW accounts created from now on.
-- Existing players keep playing without interruption.

CREATE OR REPLACE FUNCTION public.assert_email_verified()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $fn$
DECLARE
  v_confirmed timestamptz;
  v_created   timestamptz;
  v_cutoff    timestamptz := '2026-07-14 09:00:00+00';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT email_confirmed_at, created_at
    INTO v_confirmed, v_created
    FROM auth.users WHERE id = auth.uid();
  -- Grandfather all accounts created before the cutoff.
  IF v_created IS NULL OR v_created < v_cutoff THEN RETURN; END IF;
  IF v_confirmed IS NULL THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '42501';
  END IF;
END; $fn$;

-- Wire the check back onto the four gameplay RPCs.
CREATE OR REPLACE FUNCTION public.launch_nuke(_target_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.assert_email_verified(); RETURN public.launch_nuke_impl(_target_id); END; $$;

CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.assert_email_verified(); RETURN public.launch_ad_bomb_impl(_target_id, _video_key); END; $$;

CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.assert_email_verified(); RETURN public.start_steal_mission_impl(_attacker_ship_id, _target_user_id, _target_ship_id); END; $$;

CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.assert_email_verified(); RETURN public.send_support_impl(_recipient_id, _ship_id, _kind, _crew_id); END; $$;