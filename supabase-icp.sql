-- Store ICP genres in app_settings so rescoring works across sessions
-- Run in Supabase SQL Editor

insert into app_settings (key, value)
values ('icp_genres', '["Leadership","Business","Healthcare"]')
on conflict (key) do nothing;
