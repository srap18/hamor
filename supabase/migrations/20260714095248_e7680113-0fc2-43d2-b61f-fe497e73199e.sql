SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.launch_nuke(_target_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN RETURN public.launch_nuke_impl(_target_id); END; $$;

CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN RETURN public.launch_ad_bomb_impl(_target_id, _video_key); END; $$;

CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN RETURN public.start_steal_mission_impl(_attacker_ship_id, _target_user_id, _target_ship_id); END; $$;

CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN RETURN public.send_support_impl(_recipient_id, _ship_id, _kind, _crew_id); END; $$;