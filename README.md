# Daymark — Personal Roadmap & Daily Progress Tracker

A responsive React + TypeScript web app with Supabase authentication and cloud-synced task progress. Built as a first working version for IELTS, Full Stack learning, thesis work, and everyday routine.

## Included in this starter

- Email/password sign-up and sign-in using Supabase Auth.
- User-owned tasks stored in Postgres; Row Level Security (RLS) prevents users from reading or editing another user's tasks.
- Responsive dashboard, track cards, daily checklist, roadmaps, calendar view, progress insights, task search, and add-task modal.
- Checkbox completion updates sync to the cloud.
- Starter tasks imported from the uploaded IELTS roadmap: **60 days** and its extracted daily checklist items.
- Full Stack daily targets and thesis/portfolio targets seeded from the uploaded **302-Day Roadmap** workbook: **302 days**. The government-preparation column is intentionally not imported into this app.
- Routine starter checklist for each day of the 302-day plan.
- First account load seeds the user's task list automatically. Seeding runs only when the account has zero tasks.

## Step 1 — Create the Supabase project

1. Open [Supabase](https://supabase.com/) and create a project.
2. In **Project Settings → API** (or the project's API keys page), copy the Project URL and the anon/public or publishable key. Never put a `service_role` key in a browser app.
3. In Supabase **SQL Editor**, open `supabase/schema.sql`, paste the full file, and run it. This creates the `tasks` table and row-level security policies.
4. In **Authentication → Providers**, ensure Email is enabled. For the easiest local test, you can temporarily disable email confirmation in Auth settings; for real use, keep confirmation enabled and configure your email provider.

## Step 2 — Configure environment variables

Copy `.env.example` to `.env.local` and replace the placeholders:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

Do not commit `.env.local` to GitHub. The provided `.gitignore` excludes it.

## Step 3 — Run locally

Install Node.js 20 LTS (or a current supported Node version), then from this folder run:

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`). Create an account or sign in. On first sign-in, the app creates the starter roadmaps in your Supabase database. It may take a short moment because it inserts a few hundred daily tasks.

## Step 4 — Build for deployment

```bash
npm run build
npm run preview
```

You can deploy the project to Vercel or Netlify. Add the same two environment variables in the hosting provider's project settings and redeploy. Add the deployed domain to Supabase Auth's allowed redirect URLs if needed.

## How the starter roadmaps work

- **IELTS:** extracted day headings and checklist tasks from the uploaded 60-day HTML/text roadmap; tasks are scheduled from the day a new account first seeds its roadmap.
- **Full Stack:** the `Target` column of the uploaded 302-day workbook is used as a daily learning action.
- **Thesis:** the workbook's `Thesis / Portfolio` column becomes a daily thesis task. This preserves the source plan's day-level structure; edit tasks in the app or database as your actual thesis scope evolves.
- **Routine:** each day starts with Plan today, Focused study block, and Daily review. Add, check, or uncheck tasks as needed.

## Current MVP boundaries

- Authentication, task storage, and completion state are cloud-backed once Supabase is configured.
- A user's roadmaps are seeded on first login. The current version does not yet include editing/deleting tasks, custom roadmap template builder, reminders, offline-first mode, or Excel export; these are sensible next milestones.
- Progress percentages are based on all seeded tasks. A future version can switch to phase-based progress or ignore future tasks in the overall percentage.

## Project structure

```text
src/
  App.tsx         UI, auth, data loading, task completion, and add-task flow
  seedData.json   extracted IELTS and 302-day source roadmap data
  supabase.ts     Supabase client setup
  types.ts        shared task and track types
  styles.css      responsive UI styling
supabase/
  schema.sql      database table, indexes, trigger, and RLS policies
```

## Troubleshooting

- **“Invalid login credentials”**: verify the email/password or confirm the email if confirmation is enabled.
- **“relation public.tasks does not exist”**: run `supabase/schema.sql` in SQL Editor.
- **RLS / permission error**: confirm the session is signed in and schema policies exist; never disable RLS as a workaround.
- **No starter tasks**: sign in with a new account, or if the account already has tasks, the seeder will not duplicate them.

## Android install + offline tracking (PWA)

This project now includes a basic installable PWA shell and local-first completion tracking:

- `public/manifest.webmanifest` defines the app name, display mode, and icons.
- `public/sw.js` caches the app shell and same-origin files so the already-opened app can load offline after its first successful online visit.
- Tasks are cached in the browser's local storage per signed-in user. Offline check/uncheck changes are queued and sent to Supabase when connectivity returns.
- The app shows a small `Offline` / `Synced` / pending-change status in the top bar.

### Deploy and install on Android

1. From the project folder, run `npm install` and `npm run build`.
2. Push the project to GitHub without `.env.local` (it is excluded by `.gitignore`).
3. Import the repository into Vercel. Use build command `npm run build`, output directory `dist`, and add `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` in Vercel Environment Variables.
4. Deploy, then add the deployed HTTPS URL to Supabase Authentication → URL Configuration / Redirect URLs as appropriate.
5. Open the deployed URL in Android Chrome, sign in while online, and wait for the roadmaps to finish loading once.
6. In Chrome's menu, choose **Install app** or **Add to Home screen**.
7. Test by opening the installed app while online first, then enable airplane mode. Previously loaded tasks can be viewed and checked/unchecked. Turn internet back on and keep the app open briefly so pending changes can sync.

Offline limitations: first-time installation, first sign-in, and the first download of roadmap data require internet. Offline checkboxes work only for tasks already cached on that device. Supabase sync requires internet; if the browser is force-closed immediately after reconnecting, reopen the app online to retry. Local storage can be cleared by browser/device cleanup, so reconnect regularly. This is an offline-first MVP, not a native APK.
