-- Give every new user a starter ship + starter coins so they can begin playing immediately.
CREATE OR REPLACE FUNCTION public.handle_new_user_starter_ship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ships_owned (user_id, template_id, at_sea, hp, max_hp)
  VALUES (NEW.id, 1, false, 100, 100);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_starter_ship ON auth.users;
CREATE TRIGGER on_auth_user_created_starter_ship
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_starter_ship();

-- Bump default starting coins to 1000 so new captains have buying power.
ALTER TABLE public.profiles ALTER COLUMN coins SET DEFAULT 1000;

-- Backfill: any existing account with no ships gets a starter ship now.
INSERT INTO public.ships_owned (user_id, template_id, at_sea, hp, max_hp)
SELECT p.id, 1, false, 100, 100
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.ships_owned s WHERE s.user_id = p.id);