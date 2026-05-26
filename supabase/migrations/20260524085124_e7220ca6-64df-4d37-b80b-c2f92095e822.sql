
-- Fix mutable search_path
create or replace function public.touch_online_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.online_at = now();
  return new;
end;
$$;

-- Restrict SECURITY DEFINER helpers to be callable only internally
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_tribe_member(uuid, uuid) from public, anon;
-- is_tribe_member is called inside RLS policies (which run as the policy owner)
-- so revoking from anon/public is enough; keep authenticated allowed for direct calls if needed
