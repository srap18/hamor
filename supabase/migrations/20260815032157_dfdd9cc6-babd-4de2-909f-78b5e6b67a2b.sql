-- Legacy VIP system removal: neutralize all perk entry points.
CREATE OR REPLACE FUNCTION public.effective_vip_level(_user uuid)
RETURNS integer LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT 0; $function$;

CREATE OR REPLACE FUNCTION public.get_my_vip()
RETURNS TABLE(vip_level integer, vip_expires_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT 0::int, NULL::timestamptz; $function$;

CREATE OR REPLACE FUNCTION public.claim_vip_daily()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RAISE EXCEPTION 'legacy_vip_removed'; END; $function$;

CREATE OR REPLACE FUNCTION public.claim_vip_shield()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RAISE EXCEPTION 'legacy_vip_removed'; END; $function$;

CREATE OR REPLACE FUNCTION public.claim_royal_box()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RAISE EXCEPTION 'legacy_vip_removed'; END; $function$;

CREATE OR REPLACE FUNCTION public.grant_cosmic_frame()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RAISE EXCEPTION 'legacy_vip_removed'; END; $function$;

CREATE OR REPLACE FUNCTION public.grant_vip(_user uuid, _level integer, _days integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RAISE EXCEPTION 'legacy_vip_removed'; END; $function$;

CREATE OR REPLACE FUNCTION public.add_vip_points(_user uuid, _pts bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RETURN; END; $function$;
