-- Backfill profiles for any auth user that doesn't have one
INSERT INTO public.profiles (id, display_name, avatar_emoji)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email,'@',1), 'قبطان'),
       COALESCE(u.raw_user_meta_data->>'avatar_emoji', '🧑‍✈️')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- Ensure triggers exist for new signups
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

DROP TRIGGER IF EXISTS on_auth_user_created_market ON auth.users;
CREATE TRIGGER on_auth_user_created_market
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_market();

DROP TRIGGER IF EXISTS on_auth_user_created_ship ON auth.users;
CREATE TRIGGER on_auth_user_created_ship
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_starter_ship();