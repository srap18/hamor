-- Remove hardcoded admin email from the new-user trigger.
-- The existing admin role assignment is preserved; future admins must be
-- granted via the admin UI or a manual user_roles insert, not by email match.
CREATE OR REPLACE FUNCTION public.handle_new_user_admin_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Intentionally a no-op. Admin role assignment is now manual to avoid
  -- exposing administrator identities in source-controlled migrations.
  RETURN NEW;
END;
$$;