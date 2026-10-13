# JAMC Davao Connect — Church Tracker

People. Groups. Care. Growth.

A church management web app for JAMC-Davao, built with Next.js (App Router), TypeScript, Supabase
(Postgres, Auth, Storage, Row Level Security), Tailwind CSS and shadcn/ui.

It covers people, attendance, cell groups, care, discipleship, ministries, events, finance and
reports, with roles, permissions and row level security throughout.

## Setup

You need a Supabase project and Node.js 20 or newer.

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Connect Supabase.** Copy `.env.example` to `.env.local` and fill in the three values from your
   project's API settings. The secret key stays on the server; never prefix it with `NEXT_PUBLIC_`.

3. **Create the database.** In the Supabase dashboard open **SQL Editor** and run each file in
   `supabase/migrations` in order, or put `SUPABASE_DB_URL` in `.env.local` and run
   `npm run db:migrate`.

4. **Create the first Super Admin.** There is no public sign-up.

   ```bash
   npm run create-admin -- you@example.com "a-strong-password" "Your Name"
   ```

5. **Set the auth URLs.** In Supabase under **Authentication → URL Configuration**, set the Site URL
   to your app's address and add `<your address>/auth/confirm` to the redirect URLs. Password reset
   emails use it.

6. **Run the app**

   ```bash
   npm run dev
   ```

   Sign in at `/login`. Further users are added under **Administration → Users**.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run typecheck` | Generate route types and run TypeScript |
| `npm run lint` | ESLint |
| `npm run db:test` | Apply the migrations to an in-memory Postgres and check the RLS rules for every role |
| `npm run create-admin` | Create or promote a Super Admin |

`npm run db:test` needs no Supabase project. It stubs Supabase's `auth` and `storage` schemas, so it
verifies the SQL and the policies, not your live project's configuration.

## Folder structure

```
app/
  (auth)/            login, forgot password, reset password
  (app)/             everything behind sign-in (sidebar + navbar shell)
    dashboard/
    people/          members, visitors, birthdays
    attendance/      services (sessions), records, history
    admin/           users, roles & permissions, activity logs, settings
    profile/
  auth/confirm/      landing route for links in Supabase emails
components/
  ui/                shadcn/ui primitives
  shared/            form fields, list controls, empty/loading states, confirm button
  app/               shell: sidebar, navbar, search, theme toggle, user menu
  people/ attendance/ dashboard/ settings/ admin/ profile/
lib/
  supabase/          server, browser, admin and proxy clients
  auth/              session + permission helpers
  data/              read queries, one file per module
  validation.ts      Zod schemas shared by forms and Server Actions
  theme.ts           brand colours -> CSS variables
  nav.ts             sidebar definition
supabase/migrations/ schema, RLS, functions, storage, grants, seed
scripts/             db-test, create-admin
proxy.ts             refreshes the session, redirects signed-out visitors
```

Each module follows the same shape: reads in `lib/data`, writes in a `actions.ts` Server Action file
next to the pages, validation in `lib/validation.ts`, and a page that wraps its data in `<Suspense>`
with a skeleton.

## Security model

Authorization lives in the database. UI checks only decide what to show.

- Every table has RLS enabled. The anonymous role has no table access; the login page reads branding
  through one function, `get_public_branding()`.
- Policies call `has_permission('members.view')` and similar. Permissions belong to roles, roles to
  users, and all of it is editable under **Roles & Permissions**. Add a permission by inserting a
  row and referencing it in a policy.
- Scope is separate from permission: `members.view` means all members, `members.view_assigned` means
  members of cell groups the user leads. A cell leader's login must be linked to their member record
  (set when creating the user) for the scoping to know who they are.
- Rules RLS cannot express per column (archiving, converting a visitor, linking a login, granting
  Super Admin, keeping the last Super Admin) are enforced by triggers.
- Activity logs are written by triggers only. No role can insert, edit or delete them through the API.
- The service-role key is used in exactly one place: Auth admin calls from **Users**, after the
  caller's `users.manage` permission is verified.

## Design decisions worth knowing

- **Members and visitors are one table** (`people`, with `person_type`). Converting a visitor flips
  the type in place, so the person is never duplicated and their attendance history stays attached.
  Visit details live in `visitor_profiles` and remain as history after conversion.
- **Theme colours are CSS variables.** Appearance settings store HEX values; the root layout sets
  them as `--brand-*` on `<html>`, and `app/globals.css` derives every design token from them.
  Components never contain a colour value. Custom colours apply to light mode; dark mode keeps the
  brand hues on dark surfaces.
- **"Sunday attendance" is configurable.** Attendance types flagged *Counts toward absences* feed
  the dashboard trend and the consecutive-absence count.
- **Dates use the church timezone** (`church_settings.timezone`, default `Asia/Manila`).

## Modules

| Area | Pages | Notes |
| --- | --- | --- |
| People | Members, Visitors, Birthdays | One `people` table; converting a visitor keeps the same record |
| Attendance | Services, Records, History | Group and event attendance are attendance sessions too |
| Groups | Cell Groups | Members, attendance, visitors, follow-ups, apprentices, statistics |
| Care | Follow-ups, Pastoral Care | Absentee follow-ups are opened automatically at the threshold |
| Growth | Discipleship, Ministries, Events | Stage and mentor history is kept by database triggers |
| Finance | Dashboard, Giving, Expenses | Nothing is readable without `finance.view` |
| Reports | 11 reports | Print / save as PDF, CSV export |
| Administration | Users, Roles & Permissions, Activity Logs, Settings | |

### Things that are decided in the database, not the UI

- **Pastoral care confidentiality.** `can_view_care_record()` is the one definition of who may read a
  record: its author and assignee always; *Care Team* records for holders of `care.view`; *Selected
  Leaders* records for the people listed in `pastoral_care_access`; everything for holders of
  `care.confidential`. Pages query the table and get back only what that allows.
- **Reports** read through the signed-in user's own client. A report or export cannot contain a row
  the module's own screen would not show that user.
- **Notifications** are written only by triggers and `SECURITY DEFINER` functions. Reminders that
  depend on the date (due, overdue, birthdays, events) are generated for the signed-in user when
  their notification list loads, with dedupe keys so they are created once.
- **Activity logs** never contain amounts or anything from a care record.

### Applying database changes

```bash
npm run db:migrate
```

applies any SQL file in `supabase/migrations` that has not been applied yet, each in its own
transaction. It needs `SUPABASE_DB_URL` in `.env.local`. Never use `supabase db reset` on the live
project.