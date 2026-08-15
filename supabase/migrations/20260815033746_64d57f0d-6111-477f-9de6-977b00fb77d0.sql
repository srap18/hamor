CREATE OR REPLACE FUNCTION public.grant_referral_bonus(_user uuid, _txn_id text, _amount_cents integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RETURN; END; $function$;