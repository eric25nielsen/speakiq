-- Allow unauthenticated users to read opportunities (for public dashboard)
-- Run in Supabase SQL Editor

create policy "opportunities_public_read" on opportunities
  for select using (true);
