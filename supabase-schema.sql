-- ============================================================
-- SpeakIQ — Supabase Schema
-- Run this in your Supabase project: SQL Editor → New Query → Run
-- ============================================================

-- Profiles (extends Supabase auth.users with role)
create table if not exists profiles (
  id        uuid references auth.users on delete cascade primary key,
  email     text,
  role      text default 'viewer',  -- 'admin' or 'viewer'
  created_at timestamptz default now()
);

-- Auto-create profile on new user signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'viewer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Speaking opportunities (loaded by admin each month)
create table if not exists opportunities (
  id             uuid primary key default gen_random_uuid(),
  title          text,
  date           text,
  location       text,
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  genre          text,
  audience       text,
  fee            text,
  format         text,
  organization   text,
  details        text,
  icp_score      integer default 0,
  calendar_month text,
  created_at     timestamptz default now()
);

-- User interactions (interested / pass per opportunity)
create table if not exists user_interactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users on delete cascade,
  opportunity_id uuid references opportunities on delete cascade,
  status         text default 'pending',  -- 'interested', 'pass', 'pending'
  notes          text,
  created_at     timestamptz default now(),
  unique(user_id, opportunity_id)
);

-- ── Row Level Security ──────────────────────────────────────

alter table profiles          enable row level security;
alter table opportunities     enable row level security;
alter table user_interactions enable row level security;

-- Profiles: users can read all profiles, update only their own
create policy "profiles_select" on profiles for select using (true);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- Opportunities: all logged-in users can read
create policy "opps_select" on opportunities for select using (auth.role() = 'authenticated');
-- Only admins can insert/update/delete (enforced in app, double-checked here)
create policy "opps_insert" on opportunities for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "opps_delete" on opportunities for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Interactions: users manage their own; admins can read all
create policy "interactions_select_own"  on user_interactions for select using (auth.uid() = user_id);
create policy "interactions_select_admin" on user_interactions for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "interactions_insert" on user_interactions for insert with check (auth.uid() = user_id);
create policy "interactions_update" on user_interactions for update using (auth.uid() = user_id);

-- ── Set yourself as admin ───────────────────────────────────
-- After signing up, run this (replace with your actual email):
-- update profiles set role = 'admin' where email = 'your@email.com';
