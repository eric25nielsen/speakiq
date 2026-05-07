-- Run this in Supabase SQL Editor to add pending syncs support
-- ============================================================

create table if not exists pending_syncs (
  id           uuid primary key default gen_random_uuid(),
  month_label  text unique,
  status       text default 'pending',  -- 'pending', 'imported', 'skipped', 'no_email'
  email_subject text,
  email_from   text,
  email_date   text,
  calendar_name text,
  ical_url     text,
  imported_at  timestamptz,
  imported_by  uuid references auth.users,
  event_count  integer,
  created_at   timestamptz default now()
);

-- Allow syncer + admin roles to read and update
alter table pending_syncs enable row level security;

create policy "pending_syncs_select" on pending_syncs for select
  using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','syncer'))
  );

create policy "pending_syncs_insert" on pending_syncs for insert
  with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','syncer'))
  );

create policy "pending_syncs_update" on pending_syncs for update
  using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','syncer'))
  );
