DROP FUNCTION IF EXISTS public.start_steal_mission(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.claim_steal_mission(uuid, boolean);
DROP FUNCTION IF EXISTS public.cancel_steal_mission(uuid);

CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'نظام السرقة معطّل مؤقتًا'; END; $$;

CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid, _force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'نظام السرقة معطّل مؤقتًا'; END; $$;

CREATE OR REPLACE FUNCTION public.cancel_steal_mission(_attacker_ship_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  -- Allow cancelling any in-flight steal so players aren't stuck
  UPDATE public.ships_owned
     SET steal_target_user = NULL,
         steal_target_ship = NULL,
         steal_started_at = NULL,
         at_sea = false
   WHERE id = _attacker_ship_id AND user_id = _uid;
  RETURN jsonb_build_object('ok', true, 'cancelled', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_steal_mission(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) TO authenticated;