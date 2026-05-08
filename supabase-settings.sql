-- Run in Supabase SQL Editor
-- Adds app_settings table for storing config like sender email

create table if not exists app_settings (
  key   text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table app_settings enable row level security;

-- Admins can read and write settings
create policy "settings_select" on app_settings for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "settings_upsert" on app_settings for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "settings_update" on app_settings for update
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- Seed default sender email
insert into app_settings (key, value) 
values ('sender_email', 'jenniferspeakersclubrep@gmail.com')
on conflict (key) do nothing;
