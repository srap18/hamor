
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, display_name, avatar_emoji)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'قبطان'),
    coalesce(new.raw_user_meta_data ->> 'avatar_emoji', '🧑‍✈️')
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user_starter_ship()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.ships_owned (user_id, template_id, at_sea, hp, max_hp)
  VALUES (NEW.id, 1, false, 100, 100)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END; $function$;
