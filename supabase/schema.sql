-- FamilyMoney V2: chạy một lần trong Supabase SQL Editor của project mới.
-- Hỗ trợ: Supabase Auth + PostgreSQL RLS, nhóm gia đình, lời mời email, ví chung/riêng.
-- Hệ thống tiền tệ: VNĐ, số nguyên bigint. KHÔNG dùng service_role trong frontend.

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Thành viên' check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','member')) default 'member',
  joined_at timestamptz not null default now(),
  primary key (household_id,user_id)
);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null check (char_length(email) between 5 and 254),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now()+interval '14 days'),
  created_at timestamptz not null default now(),
  unique (household_id,email)
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 1 and 80),
  scope text not null check (scope in ('common','private')),
  opening_balance bigint not null default 0 check (opening_balance between -900000000000000 and 900000000000000),
  created_at timestamptz not null default now(),
  unique (id,household_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  wallet_id uuid not null,
  to_wallet_id uuid,
  type text not null check (type in ('income','expense','transfer')),
  category text not null check (char_length(category) between 1 and 60),
  amount bigint not null check (amount between 1 and 900000000000000),
  note text not null default '' check (char_length(note)<=250),
  tx_date date not null default current_date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (wallet_id,household_id) references public.wallets(id,household_id),
  foreign key (to_wallet_id,household_id) references public.wallets(id,household_id),
  constraint valid_destination check (
    (type='transfer' and to_wallet_id is not null and wallet_id<>to_wallet_id)
    or (type in ('income','expense') and to_wallet_id is null)
  )
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category text not null check (char_length(category) between 1 and 60),
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  amount bigint not null check (amount>0),
  unique (household_id,category,month)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  target bigint not null check (target>0),
  saved bigint not null default 0 check (saved>=0),
  due_date date,
  created_at timestamptz not null default now()
);

create index on public.household_members(user_id);
create index on public.household_invites(email);
create index on public.wallets(household_id,scope);
create index on public.transactions(household_id,tx_date desc);
create index on public.transactions(wallet_id);
create index on public.budgets(household_id,month);
create index on public.goals(household_id);

-- Privileged internal helpers (NOT in exposed API schema).
create function private.is_member(p_hid uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.household_members m where m.household_id=p_hid and m.user_id=(select auth.uid())); $$;

create function private.is_admin(p_hid uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.household_members m where m.household_id=p_hid and m.user_id=(select auth.uid()) and m.role='admin'); $$;

create function private.is_verified_invitee(p_email text) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from auth.users u where u.id=(select auth.uid()) and u.email_confirmed_at is not null and lower(u.email)=lower(p_email)); $$;

create function private.has_valid_invite(p_hid uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.household_invites i join auth.users u on u.id=(select auth.uid())
  where i.household_id=p_hid and i.expires_at>now() and u.email_confirmed_at is not null and lower(i.email)=lower(u.email)); $$;

create function private.same_household(p_user uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.household_members m
  join public.household_members me on me.household_id=m.household_id
  where m.user_id=p_user and me.user_id=(select auth.uid())); $$;

create function private.can_use_wallet(p_wallet uuid,p_hid uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.wallets w where w.id=p_wallet and w.household_id=p_hid
  and private.is_member(p_hid) and (w.scope='common' or w.owner_id=(select auth.uid()))); $$;

create function private.transfer_ok(p_wallet uuid,p_to uuid,p_hid uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.wallets a join public.wallets b on b.id=p_to and b.household_id=p_hid
 where a.id=p_wallet and a.household_id=p_hid and a.id<>b.id and a.scope=b.scope
 and private.can_use_wallet(a.id,p_hid) and private.can_use_wallet(b.id,p_hid)); $$;

-- Auth signup: tạo profile; tạo household: auto add founder as admin.
create function private.new_user_profile() returns trigger
language plpgsql security definer set search_path=''
as $$ begin
  insert into public.profiles(id,display_name)
  values(new.id,left(coalesce(nullif(split_part(new.email,'@',1),''),'Thành viên'),80))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger fm_auth_profile after insert on auth.users for each row execute function private.new_user_profile();

create function private.new_household_member() returns trigger
language plpgsql security definer set search_path=''
as $$ begin
  insert into public.household_members(household_id,user_id,role) values(new.id,new.owner_id,'admin');
  return new;
end $$;
create trigger fm_household_founder after insert on public.households for each row execute function private.new_household_member();

-- Bật Row-Level Security. Không có public policy => anon không thể đọc bảng.
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;

create policy profile_select on public.profiles for select to authenticated
using (id=(select auth.uid()) or private.same_household(id));
create policy profile_insert on public.profiles for insert to authenticated
with check (id=(select auth.uid()));
create policy profile_update on public.profiles for update to authenticated
using (id=(select auth.uid())) with check (id=(select auth.uid()));

create policy household_select on public.households for select to authenticated
using (private.is_member(id));
create policy household_insert on public.households for insert to authenticated
with check (owner_id=(select auth.uid()));

create policy member_select on public.household_members for select to authenticated
using (private.is_member(household_id));
create policy member_join on public.household_members for insert to authenticated
with check (user_id=(select auth.uid()) and role='member' and private.has_valid_invite(household_id));

create policy invite_select on public.household_invites for select to authenticated
using (private.is_admin(household_id) or private.is_verified_invitee(email));
create policy invite_insert on public.household_invites for insert to authenticated
with check (private.is_admin(household_id) and created_by=(select auth.uid()) and email=lower(trim(email)) and expires_at<=now()+interval '14 days');
create policy invite_delete on public.household_invites for delete to authenticated
using (private.is_admin(household_id));

create policy wallet_select on public.wallets for select to authenticated
using (private.is_member(household_id) and (scope='common' or owner_id=(select auth.uid())));
create policy wallet_insert on public.wallets for insert to authenticated
with check (private.is_member(household_id) and owner_id=(select auth.uid()) and (scope='private' or private.is_admin(household_id)));

create policy transaction_select on public.transactions for select to authenticated
using (private.can_use_wallet(wallet_id,household_id));
create policy transaction_insert on public.transactions for insert to authenticated
with check (created_by=(select auth.uid()) and private.can_use_wallet(wallet_id,household_id)
 and (type<>'transfer' or private.transfer_ok(wallet_id,to_wallet_id,household_id)));
create policy transaction_delete on public.transactions for delete to authenticated
using (created_by=(select auth.uid()) and private.can_use_wallet(wallet_id,household_id));

create policy budget_select on public.budgets for select to authenticated
using (private.is_member(household_id));
create policy budget_insert on public.budgets for insert to authenticated
with check (private.is_admin(household_id));
create policy budget_update on public.budgets for update to authenticated
using (private.is_admin(household_id)) with check (private.is_admin(household_id));

create policy goal_select on public.goals for select to authenticated
using (private.is_member(household_id));
create policy goal_insert on public.goals for insert to authenticated
with check (private.is_admin(household_id));
create policy goal_update on public.goals for update to authenticated
using (private.is_admin(household_id)) with check (private.is_admin(household_id));

-- Explicit privileges; no anonymous table access.
revoke all on all tables in schema public from anon;
grant select,insert,update,delete on public.profiles, public.households, public.household_members,
 public.household_invites,public.wallets,public.transactions,public.budgets,public.goals to authenticated;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- Nếu đã có user trước khi chạy migration, có thể tạo lại profile bị thiếu:
insert into public.profiles(id,display_name)
select id,left(coalesce(nullif(split_part(email,'@',1),''),'Thành viên'),80)
from auth.users on conflict (id) do nothing;
