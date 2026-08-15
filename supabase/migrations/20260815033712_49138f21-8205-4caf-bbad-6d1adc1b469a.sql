CREATE OR REPLACE FUNCTION public.award_pending_referral_if_qualified(_invitee uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT false $function$;

CREATE OR REPLACE FUNCTION public.check_my_referral_award()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT false $function$;

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text, p_device_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT jsonb_build_object('ok', false, 'reason', 'referrals_disabled') $function$;