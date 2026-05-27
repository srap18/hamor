-- chunk_0
-- 20260524085110
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_emoji text not null default '🧑‍✈️',
  level int not null default 1,
  xp int not null default 0,
  coins bigint not null default 500,
  gems int not null default 50,
  rubies int not null default 5,
  tribe_id uuid,
  online_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_update_self" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_self" on public.profiles for insert with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_emoji)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'قبطان'),
    coalesce(new.raw_user_meta_data ->> 'avatar_emoji', '🧑‍✈️')
  );
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_online_at()
returns trigger language plpgsql set search_path = public as $$
begin new.online_at = now(); return new; end; $$;

create table public.tribes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  emblem text not null default '⚔️',
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.tribes enable row level security;
create policy "tribes_select_all" on public.tribes for select using (true);
create policy "tribes_insert_auth" on public.tribes for insert with check (auth.uid() = owner_id);
create policy "tribes_update_owner" on public.tribes for update using (auth.uid() = owner_id);

create table public.tribe_members (
  tribe_id uuid not null references public.tribes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (tribe_id, user_id)
);
alter table public.tribe_members enable row level security;
create policy "tribe_members_select_all" on public.tribe_members for select using (true);
create policy "tribe_members_insert_self" on public.tribe_members for insert with check (auth.uid() = user_id);
create policy "tribe_members_delete_self" on public.tribe_members for delete using (auth.uid() = user_id);

create or replace function public.is_tribe_member(_user_id uuid, _tribe_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tribe_members where user_id = _user_id and tribe_id = _tribe_id);
$$;

alter table public.profiles add constraint profiles_tribe_fk
  foreign key (tribe_id) references public.tribes(id) on delete set null;

create table public.ships_owned (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  template_id int not null,
  at_sea boolean not null default false,
  acquired_at timestamptz not null default now()
);
alter table public.ships_owned enable row level security;
create policy "ships_select_own" on public.ships_owned for select using (auth.uid() = user_id);
create policy "ships_insert_own" on public.ships_owned for insert with check (auth.uid() = user_id);
create policy "ships_update_own" on public.ships_owned for update using (auth.uid() = user_id);
create policy "ships_delete_own" on public.ships_owned for delete using (auth.uid() = user_id);

create table public.friends (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);
alter table public.friends enable row level security;
create policy "friends_select_involved" on public.friends for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "friends_insert_requester" on public.friends for insert with check (auth.uid() = requester_id and requester_id <> addressee_id);
create policy "friends_update_addressee" on public.friends for update using (auth.uid() = addressee_id or auth.uid() = requester_id);
create policy "friends_delete_involved" on public.friends for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('public','tribe','dm')),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  tribe_id uuid references public.tribes(id) on delete cascade,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_channel_created_idx on public.messages (channel, created_at desc);
create index messages_dm_idx on public.messages (sender_id, recipient_id, created_at desc);
create index messages_tribe_idx on public.messages (tribe_id, created_at desc);
create policy "msg_select_public" on public.messages for select using (channel = 'public');
create policy "msg_select_dm" on public.messages for select using (channel = 'dm' and (auth.uid() = sender_id or auth.uid() = recipient_id));
create policy "msg_select_tribe" on public.messages for select using (channel = 'tribe' and tribe_id is not null and public.is_tribe_member(auth.uid(), tribe_id));
create policy "msg_insert_public" on public.messages for insert with check (channel = 'public' and auth.uid() = sender_id);
create policy "msg_insert_dm" on public.messages for insert with check (channel = 'dm' and auth.uid() = sender_id and recipient_id is not null);
create policy "msg_insert_tribe" on public.messages for insert with check (channel = 'tribe' and auth.uid() = sender_id and tribe_id is not null and public.is_tribe_member(auth.uid(), tribe_id));

create table public.ship_listings (
  id uuid primary key default gen_random_uuid(),
  ship_id uuid not null unique references public.ships_owned(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  template_id int not null,
  price bigint not null check (price > 0),
  status text not null default 'active' check (status in ('active','sold','cancelled')),
  buyer_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sold_at timestamptz
);
alter table public.ship_listings enable row level security;
create policy "listings_select_all" on public.ship_listings for select using (true);
create policy "listings_insert_seller" on public.ship_listings for insert with check (auth.uid() = seller_id);
create policy "listings_update_seller" on public.ship_listings for update using (auth.uid() = seller_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  amount bigint not null,
  currency text not null default 'coins',
  meta jsonb,
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;
create policy "tx_select_own" on public.transactions for select using (auth.uid() = user_id);

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.friends;
alter publication supabase_realtime add table public.ship_listings;

-- 20260524085124 + 20260524085134
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_tribe_member(uuid, uuid) from public, anon, authenticated;

-- 20260524092820
CREATE TABLE public.inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('crew', 'weapon', 'consumable', 'decoration')),
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  meta JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);