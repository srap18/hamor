
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  paddle_subscription_id text not null unique,
  paddle_customer_id text not null,
  product_id text not null,
  price_id text not null,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  environment text not null default 'sandbox',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_subscriptions_user_id on public.subscriptions(user_id);
create index idx_subscriptions_paddle_id on public.subscriptions(paddle_subscription_id);
alter table public.subscriptions enable row level security;
create policy "Users can view own subscription" on public.subscriptions for select using (auth.uid() = user_id);
create policy "Service role can manage subscriptions" on public.subscriptions for all using (auth.role() = 'service_role');

create table public.paddle_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paddle_transaction_id text not null unique,
  pack_id text not null,
  status text not null default 'pending',
  amount_cents integer not null default 0,
  granted boolean not null default false,
  environment text not null default 'sandbox',
  created_at timestamptz not null default now(),
  granted_at timestamptz
);
create index idx_paddle_purchases_user_created on public.paddle_purchases(user_id, created_at desc);
create index idx_paddle_purchases_pack_user on public.paddle_purchases(pack_id, user_id, created_at desc);
alter table public.paddle_purchases enable row level security;
create policy "users_view_own_paddle_purchases" on public.paddle_purchases for select using (auth.uid() = user_id);
create policy "service_role_manage_paddle_purchases" on public.paddle_purchases for all using (auth.role() = 'service_role');

create or replace function public.grant_paddle_purchase(
  _txn_id text, _user uuid, _pack_id text, _amount_cents integer,
  _gems integer, _coins bigint, _rubies integer, _shield_days integer, _vip_days integer,
  _env text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing record;
begin
  select * into v_existing from public.paddle_purchases where paddle_transaction_id = _txn_id;
  if found and v_existing.granted then
    return jsonb_build_object('ok', true, 'already_granted', true, 'pack_id', v_existing.pack_id);
  end if;

  insert into public.paddle_purchases (user_id, paddle_transaction_id, pack_id, status, amount_cents, granted, granted_at, environment)
  values (_user, _txn_id, _pack_id, 'paid', _amount_cents, true, now(), _env)
  on conflict (paddle_transaction_id) do update set status='paid', granted=true, granted_at=now();

  if coalesce(_gems,0) > 0 or coalesce(_coins,0) > 0 or coalesce(_rubies,0) > 0 then
    update public.profiles
       set gems = gems + coalesce(_gems,0),
           coins = coins + coalesce(_coins,0),
           rubies = rubies + coalesce(_rubies,0)
     where id = _user;
  end if;

  if coalesce(_shield_days,0) > 0 then
    update public.profiles
       set protection_until = greatest(coalesce(protection_until, now()), now()) + (_shield_days || ' days')::interval
     where id = _user;
  end if;

  if coalesce(_vip_days,0) > 0 then
    update public.profiles
       set protection_until = greatest(coalesce(protection_until, now()), now()) + (_vip_days || ' days')::interval
     where id = _user;
  end if;

  return jsonb_build_object('ok', true, 'pack_id', _pack_id);
end $$;

create or replace function public.revoke_vip_protection(_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.profiles
     set protection_until = case
       when protection_until is null then null
       when protection_until - interval '30 days' < now() then now()
       else protection_until - interval '30 days'
     end
   where id = _user;
$$;
