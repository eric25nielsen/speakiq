# SpeakIQ — Speaking Opportunity Intelligence

A web app that loads Jennifer's monthly speaking calendar, ranks opportunities
against your Ideal Client Profile, and lets your whole team log in to view,
sort, filter, and mark their interest.

---

## What You Need (all free)

- [ ] GitHub account (you have this ✓)
- [ ] Supabase account — https://supabase.com (free)
- [ ] Vercel account — https://vercel.com (free, connect with GitHub)
- [ ] Anthropic API key — https://console.anthropic.com (pay per use, ~pennies per scan)

---

## Setup Steps

### Step 1 — Create your Supabase project

1. Go to https://supabase.com → New Project
2. Give it a name (e.g. "speakiq") and a strong database password
3. Wait ~2 minutes for it to spin up
4. Go to **SQL Editor** → **New Query**
5. Copy the entire contents of `supabase-schema.sql` → paste → click **Run**
6. Go to **Project Settings → API**
7. Copy your **Project URL** and **anon public** key — you'll need these in Step 3

### Step 2 — Put the code on GitHub

1. Go to https://github.com → New Repository → name it "speakiq" → Create
2. Upload all these files to the repo (drag and drop works in the GitHub UI)
   OR if you use GitHub Desktop or Terminal:
   ```
   git init
   git add .
   git commit -m "Initial SpeakIQ"
   git remote add origin https://github.com/YOUR_USERNAME/speakiq.git
   git push -u origin main
   ```

### Step 3 — Deploy to Vercel

1. Go to https://vercel.com → Add New Project
2. Import your "speakiq" GitHub repository
3. Before clicking Deploy, click **Environment Variables** and add:

   | Name                    | Value                                      |
   |-------------------------|--------------------------------------------|
   | VITE_SUPABASE_URL       | https://your-project-id.supabase.co        |
   | VITE_SUPABASE_ANON_KEY  | your-supabase-anon-key                     |
   | ANTHROPIC_API_KEY       | sk-ant-your-anthropic-key                  |

4. Click **Deploy** — Vercel builds and hosts it automatically
5. You get a live URL like `speakiq.vercel.app`

### Step 4 — Create your admin account

1. Go to your live app URL
2. You won't be able to sign in yet — go to Supabase → **Authentication → Users → Invite User**
3. Enter your email → Send Invite → check your email → set your password
4. Go back to Supabase → **SQL Editor** → run:
   ```sql
   update profiles set role = 'admin' where email = 'your@email.com';
   ```
5. Sign in to the app — you now have the Admin panel

### Step 5 — Invite your team

1. In the app → **Admin → Manage Users → Invite New User**
2. Enter their email → set role to "viewer" → Send Invite
3. They receive an email, set their password, and can log in from any device

---

## Using SpeakIQ Each Month

1. You receive Jennifer's monthly email with the calendar link
2. Copy the webcal:// or https:// calendar URL from the email
3. Log in to SpeakIQ → Admin → Load Calendar
4. Paste the URL, enter the month label (e.g. May2026) → Scan
5. Review the preview → click Save
6. Everyone on your team sees the new opportunities instantly

---

## User Roles

| Role   | Can Do                                                        |
|--------|---------------------------------------------------------------|
| Admin  | Load calendars, manage users, see team activity, export CSV   |
| Viewer | View & sort opportunities, mark Interested/Pass, export CSV   |

---

## Updating the App

Any changes pushed to your GitHub repo auto-deploy via Vercel. No manual steps needed.
