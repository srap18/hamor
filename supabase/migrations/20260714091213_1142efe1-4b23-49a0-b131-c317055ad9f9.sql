SET LOCAL lock_timeout = '30s';

DROP TRIGGER IF EXISTS trg_profiles_validate_display_name ON public.profiles;
CREATE TRIGGER trg_profiles_validate_display_name
  BEFORE INSERT OR UPDATE OF display_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_display_name();

DO $wrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'launch_nuke_impl') THEN
    ALTER FUNCTION public.launch_nuke(uuid) RENAME TO launch_nuke_impl;
    EXECUTE $$CREATE OR REPLACE FUNCTION public.launch_nuke(_target_id uuid)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $body$ BEGIN PERFORM public.assert_email_verified(); RETURN public.launch_nuke_impl(_target_id); END; $body$;$$;
    GRANT EXECUTE ON FUNCTION public.launch_nuke(uuid) TO authenticated;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'launch_ad_bomb_impl') THEN
    ALTER FUNCTION public.launch_ad_bomb(uuid, text) RENAME TO launch_ad_bomb_impl;
    EXECUTE $$CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $body$ BEGIN PERFORM public.assert_email_verified(); RETURN public.launch_ad_bomb_impl(_target_id, _video_key); END; $body$;$$;
    GRANT EXECUTE ON FUNCTION public.launch_ad_bomb(uuid, text) TO authenticated;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'start_steal_mission_impl') THEN
    ALTER FUNCTION public.start_steal_mission(uuid, uuid, uuid) RENAME TO start_steal_mission_impl;
    EXECUTE $$CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $body$ BEGIN PERFORM public.assert_email_verified(); RETURN public.start_steal_mission_impl(_attacker_ship_id, _target_user_id, _target_ship_id); END; $body$;$$;
    GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'send_support_impl') THEN
    ALTER FUNCTION public.send_support(uuid, uuid, text, text) RENAME TO send_support_impl;
    EXECUTE $$CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
      AS $body$ BEGIN PERFORM public.assert_email_verified(); RETURN public.send_support_impl(_recipient_id, _ship_id, _kind, _crew_id); END; $body$;$$;
    GRANT EXECUTE ON FUNCTION public.send_support(uuid, uuid, text, text) TO authenticated;
  END IF;
END $wrap$;