create or replace function public.email_has_existing_account(_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(_email))
  )
$$;

revoke all on function public.email_has_existing_account(text) from public, anon, authenticated;
grant execute on function public.email_has_existing_account(text) to service_role;