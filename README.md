# LJ

A private app for two people. Nine rooms under one roof:

| Tab | What it does |
|---|---|
| **Positions** | 207-position pool, suggestions, verdicts, kit tracking |
| **Cuisines** | 193-country wheel, rankings, a "not in Melbourne" parking list |
| **Movies** / **TV Shows** | Both rate independently; averages and genre insights |
| **Watchlist** | Countdowns to release |
| **MCU** | Franchise rewatch in order, plus hero / villain / love-interest boards |
| **Nachos** / **Salad Sangas** | Melbourne venue rankings |
| **To-Do** | Things we want to do |

Installs to an iPhone or Android home screen as a PWA — no App Store.

## Running it

```bash
npm install
npm run dev
```

Copy `.env.production` to `.env.local` if you want a different backend locally.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. The Pages site lives at a subpath, so the build
sets `VITE_BASE=/LJ/` — that must match the repo name or every asset 404s.

## Database

Supabase (project `Positions`, Lee+James org). Schema and seed live in
`supabase/migrations/`:

- `0001_init.sql` — tables, row-level security, realtime, the two accounts
- `0002_seed_legacy.sql` — data migrated from the old Position-selector and
  Cuisine-selector apps

Every `lj_` table has RLS requiring an authenticated session. The anon key is
inlined into the public bundle, which is fine on its own: with no session it
reads back nothing.

Sign-in is "pick who you are, then a shared passcode" — but underneath, each
profile is a real Supabase auth user whose password is that passcode, so RLS
genuinely applies rather than being decorative.

> Note: if you ever hand-insert rows into `auth.users`, set the token columns
> (`confirmation_token`, `recovery_token`, `email_change`, …) to `''` rather
> than leaving them `NULL`. GoTrue reads them into non-nullable strings and
> every login fails with "Database error querying schema".

## Architecture notes

**Local-first.** Reads paint instantly from a `localStorage` cache, then
reconcile with the server; the UI never blocks on the network. Writes apply
locally first and queue in an outbox if offline. One realtime channel per
table, shared across components.

**Shared countdowns don't stream ticks.** Streaming "9… 8… 7…" desyncs the two
phones by whatever the jitter is. Instead one absolute end timestamp is
broadcast and each device counts down against a server-corrected clock
(`src/lib/clock.ts`), so both agree even if one gets the message late.

**Press states fire on `pointerdown`, not `click`.** A web button bound to
`click` only reacts when the finger lifts; a native one depresses when it
lands. That gap is most of what makes a web app feel like a web page.
