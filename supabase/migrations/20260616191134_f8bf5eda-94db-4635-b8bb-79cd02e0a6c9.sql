
CREATE OR REPLACE FUNCTION public.guard_tribes_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'postgres'
     OR current_setting('role', true) = 'service_role'
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.level IS DISTINCT FROM OLD.level
     OR NEW.treasure_coins IS DISTINCT FROM OLD.treasure_coins
     OR NEW.total_donations IS DISTINCT FROM OLD.total_donations
     OR NEW.treasure_tribe_gems IS DISTINCT FROM OLD.treasure_tribe_gems
     OR NEW.overflow_warning_until IS DISTINCT FROM OLD.overflow_warning_until
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'Not allowed to modify protected tribe columns directly';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_tribe_members_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user = 'postgres'
     OR current_setting('role', true) = 'service_role'
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.donation_coins IS DISTINCT FROM OLD.donation_coins
     OR NEW.last_donation_at IS DISTINCT FROM OLD.last_donation_at
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tribe_id IS DISTINCT FROM OLD.tribe_id THEN
    RAISE EXCEPTION 'Not allowed to modify protected tribe_member columns directly';
  END IF;

  RETURN NEW;
END;
$$;
