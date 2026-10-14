# JAMC Davao Connect — Church Tracker

A church management web app for JAMC-Davao: members, visitors, attendance, cell groups, follow-ups, pastoral care, discipleship, ministries, events, finance and reports. Real data in Supabase; there is no mock data.

@AGENTS.md

## Stack

- Next.js 16.4 App Router with `cacheComponents` and `partialPrefetching`, React 19, TypeScript.
- Tailwind CSS v4 (through the `@tailwindcss/turbopack` loader in `next.config.ts`), shadcn "base-nova" components on `@base-ui/react`.
- Supabase: Auth, Postgres with row level security, Storage. `@supabase/ssr` for the server and browser clients.
- Forms: react-hook-form + Zod. Charts: Recharts. Toasts: sonner.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run typecheck` | `next typegen` then `tsc --noEmit`. Run after adding or removing a route. |
| `npm run lint` | ESLint |
| `npm run build` | Production build (downloads the Google fonts at build time) |
| `npm run db:test` | Applies every migration to an in-memory Postgres (PGlite) and checks RLS and functions per role. No network, no real data. |
| `npm run db:migrate` | Applies new files in `supabase/migrations` to the real database (`SUPABASE_DB_URL`). Tracks them in `app_private.migrations`. |
| `npm run create-admin -- <email> "<password>" "<name>"` | Creates or promotes a Super Admin |
| `npm run demo:seed` / `npm run demo:remove` | Adds or removes clearly marked demo data (`--dry-run` supported) |

Before calling work done: `npm run db:test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Environment variables

| Name | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app | The anon key under its new name; `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted too |
| `SUPABASE_SECRET_KEY` | server only | Service-role key. Needed to create users, send invitations and change login emails. Never import it into client code. |
| `NEXT_PUBLIC_SITE_URL` | app, optional | Where links in emails point. Defaults to the Vercel production domain (`lib/site-url.ts`), or the request address locally. |
| `SUPABASE_DB_URL` | scripts only | Postgres connection string for `db:migrate` and the demo scripts. Not needed on the hosting platform. |

They live in `.env.local` (git-ignored); `.env.example` lists the names. Never print or paste their values: when checking them, show names or lengths only.

## Layout

```
app/(auth)/            login, sign-up, pending-approval, password reset (public)
app/(app)/             everything behind sign-in; layout.tsx mounts the shell
  admin/               users, approvals, roles, activity logs, settings
  people/ attendance/ groups/ care/ discipleship/ ministries/ events/ finance/ reports/
  module-actions.ts    Server Actions for most modules
components/app/        shell, navigation, page boundary, command palette
components/shared/     EntityDialog, CommandSelect, ConfirmButton, list controls, states
components/settings/   the System Appearance sections
lib/auth/              session and permission helpers
lib/data/              server-side queries
lib/supabase/          server, browser and admin (service-role) clients
supabase/migrations/   numbered SQL migrations, the source of truth for the schema
scripts/               migrate, db-test, create-admin, demo seed/remove
proxy.ts               the Next 16 name for middleware; refreshes the session
```

## Rules that matter

### Security lives in the database

- Every table has RLS. A UI check only decides what to show; it is never the protection.
- A Server Action checks the permission (`getAccessWith(...)`), validates with Zod, then writes **as the signed-in user** so RLS decides. The service-role client (`lib/supabase/admin.ts`) is used only for Supabase Auth admin calls.
- Multi-step or privileged changes are `security definer` Postgres functions that check `has_permission(...)` themselves (approving accounts, posting a giving collection, linking a member to an account).
- Access requires all of: signed in, `approval_status = 'approved'`, account active, and the permission. `lib/auth/session.ts` routes anyone else to `/pending-approval`.
- Confidential data (pastoral care, finance amounts, rejection notes) must not be fetched and then hidden, and must not be copied into `activity_logs`.

### Migrations

- Add a new numbered file; never edit one that has been applied, and never reset the database.
- Every migration gets checks in `scripts/db-test.mjs` (who can and cannot do the thing), then `npm run db:test`, then `npm run db:migrate`.
- `db:migrate` sometimes fails with `ETIMEDOUT` on an IPv6 address. Retry it; setting `NODE_OPTIONS=--dns-result-order=ipv4first` helps.

### Data model

- `people` holds members and visitors (`person_type`). A visitor becomes a member in place, keeping their history.
- A user account is the login of a member: `people.user_id` (unique) links them. One member has at most one account. Account details come from the member record; do not duplicate them on `profiles`.
- Finance: `giving_records` is the only ledger for giving. A giving collection (batch entry) is a header plus lines; posting copies the lines into `giving_records` once, and voiding removes them again. Never add an amount to the header.

### Next.js 16

- Read the relevant guide in `node_modules/next/dist/docs/` before using a Next API (see the block above).
- With Cache Components every dynamic read sits behind `<Suspense>`. Pages wrap their content in `PageBoundary` with a `PageSkeleton` fallback; `PageBoundary` also shows a remembered copy of a visited page while fresh data loads.
- Use the generated `PageProps<"/route">` and `LayoutProps` types; run `npx next typegen` after changing routes.
- After a mutation call `refresh()`, and `updateTag(BRANDING_TAG)` when branding or appearance changed.

### UI conventions

- Appearance is driven by settings in `system_appearance_settings` (one row): colours, typography, motion, login content, system background. They reach every page as CSS variables set on `<html>` by `app/layout.tsx`; components use the tokens in `app/globals.css` and never hard-code a colour, font or size.
- Every dropdown is `NativeSelect` from `components/shared/form` (a searchable command list over a hidden native `<select>`).
- Create/edit dialogs are `EntityDialog` with a field list; confirmations are `ConfirmButton`.
- Mobile first. The shell switches at `md` (bottom tabs below it); tables become cards on phones; dialogs become bottom sheets.
- Entrance animations are automatic for page sections, tables and `data-reveal-list` cards (`lib/motion.ts`, `globals.css`). Animate only opacity, translate and scale, and respect `prefers-reduced-motion`.
- UI text, code and comments are in English.

### Known development quirk

The dev server does not always pick up Tailwind classes that are used for the first time in a `.tsx` file: the page looks broken in `next dev` while `next build` is fine. Making any small edit to `app/globals.css` rebuilds the stylesheet; restarting the dev server does not. Check the CSS served by `localhost:3000` before concluding that a layout is wrong.

## Deployment

Hosted on Vercel (`vercel.json`). Set the first three environment variables above in the Vercel project. Functions run in `hnd1` (Tokyo) to sit next to the Supabase database. In Supabase Auth, set the Site URL to `https://jamc-davao-connect.vercel.app` and allow `https://jamc-davao-connect.vercel.app/**` and `http://localhost:3000/**` as redirect URLs. Email links are built by `lib/site-url.ts`; the branded email templates are in `supabase/email-templates/` (pasted into the dashboard by hand). Custom SMTP is needed to send as "JAMC Davao Connect" instead of "Supabase Auth".
