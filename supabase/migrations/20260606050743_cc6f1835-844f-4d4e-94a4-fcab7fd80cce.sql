
-- SECURITY FIX: remove broad SELECT on redemption_codes.
-- The redeem_code() function is SECURITY DEFINER and does not need this policy.
-- Admins keep full access via rc_admin_manage (ALL).
DROP POLICY IF EXISTS rc_authenticated_view ON public.redemption_codes;
