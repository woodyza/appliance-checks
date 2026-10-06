# Appliance Checks

A brigade's routine checks that each appliance's equipment is present and serviceable, recorded on a phone at the appliance rather than on paper or a spreadsheet. Terminology is defined in [`CONTEXT.md`](./CONTEXT.md).

Each brigade gets an unguessable Brigade Link (`https://<host>/{slug}`), reached almost entirely via QR codes on its appliances. No sign-in is needed to run a Check; editing Check Sheets and other admin tasks require an authenticated Brigade Admin or VSO (see [Admin sign-in](#admin-sign-in)).

## Repository layout

```
apps-script/     the original Google Apps Script app (superseded, see apps-script/README.md)
src/
  domain/        pure TS: types, slug generation, schedule/Check logic, Check Sheet import (fetch, parse, reconcile)
  data/          thin Firestore access (checks.ts, checkSheet.ts, admin.ts)
  state/         Vue composables holding reactive session state (checkSession.ts, sheetEditor.ts)
  views/         Vue views (one per route)
  components/    shared Vue components
cli/             admin CLI tools (provision, create-brigade, add-appliance, import-check-sheet, brigade-settings, deploy, e2e-seed, check-prehijack)
functions/       Cloud Functions workspace: the weekly VSO email (`src/`, bundled by esbuild into the gitignored `lib/`)
tests/
  domain/        unit tests
  rules/         Firestore rules tests (emulator)
  cli/           CLI/Admin SDK tests (emulator)
  e2e/           Playwright specs (run with `make e2e`, not part of `make check`)
firebase.json, firestore.rules, firestore.indexes.json
```

Data model: see [the foundations design](./docs/designs/2026-09-25-foundations-design.md#data-model), and [the check entry design](./docs/designs/2026-09-26-check-entry-design.md#data-model) for Checks and their rules. Decisions worth keeping are recorded as ADRs in [`docs/adr/`](./docs/adr/).

## Prerequisites

- Node 26+ and npm.
- A JDK at version 21+ for the Firestore emulator (firebase-tools no longer supports older Java). `make check`/`make test` run the emulator commands with `JAVA_HOME_21` (defaults to Homebrew's `openjdk@21`) prepended to `PATH` for you; override it if yours lives elsewhere. `make dev` does the same. Running `npm run test:emulator` or `npm run emulators` directly (without `make`) needs a JDK 21+ `java` on your `PATH` yourself, e.g. `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:emulator`.
- For `dev`/`prod` (not the emulator): gcloud and the Firebase CLI logged in as the same account. Setting up the Firebase projects is covered in [`docs/infra-setup.md`](./docs/infra-setup.md).
- `clasp` (installed globally, authenticated) if you're working on the Apps Script app — see `apps-script/README.md`.
- For `make e2e`: `npx playwright install chromium` once, after `npm install`.

## Local dev

```bash
make dev
```

Runs the Firestore and Auth emulators, a dev seed and Vite in one terminal (via `concurrently`); Ctrl-C stops them all. Vite serves at `http://localhost:5173` and talks to the emulator (`.env.development`, committed, points at the `demo-appliance-checks` project). There's no local mode that talks to `dev`/`prod`.

- The seed creates a `devtst` brigade the first time (appliances `dev1` and `dev2`, a small Check Sheet and a previous Check to copy from) and prints its links: open `http://localhost:5173/devtst/dev1`. After that it leaves the data alone; `npm run dev:seed -- --reset` rebuilds it while `make dev` is running.
- The seed also creates the emulator's superadmin Auth user (`e2e-admin@example.com`, UID `emulator-superadmin`, matching `firestore.rules`). See the local sign-in steps below.
- Emulator data is exported to `.emulator-data/` (gitignored) on exit and imported on the next start, so your Checks survive restarts. Delete the directory to start from nothing.
- The Emulator UI (http://127.0.0.1:4000) shows the data.
- `make e2e` reuses a running `make dev` (the e2e seed only touches its own `e2etst` brigade). `make check` needs port 8080 free, so stop `make dev` first.

To sign in locally while `make dev` is running:

1. Open http://localhost:5173/admin/sign-in.
2. Enter `e2e-admin@example.com` and click **Send sign-in link**.
3. Open the generated link from the emulator output in your `make dev` terminal, using the same browser.

There's no password and no real email is sent locally.

Env files: `.env.development` is committed (emulator config). `.env.dev` / `.env.prod` hold the real Firebase web config and reCAPTCHA site key; they're written by `make provision` and gitignored (see [`docs/infra-setup.md`](./docs/infra-setup.md)).

## Admin sign-in

`/admin/sign-in` (passwordless email link) leads to where the person's role starts:

- A superadmin gets `/admin`, a hub with "Users" and "Brigades".
- A VSO gets `/admin/brigades`, a list of just their brigades (`/admin` redirects there). On a brigade's checks page they get "‹ Brigades", and "Manage" for the brigades they're assigned to.
- A Brigade Admin goes straight to `/:slug/admin` for their one brigade (`/admin` redirects there), where Sign out lives. "Manage" on that brigade's checks page takes them back, and there's no "‹ Brigades".

The landing page's "Admin" link goes to `/admin` and relies on that redirect. Anyone else who signs in sees "Not authorised". Other screens:

- `/admin/users` lists Brigade Admins and VSOs, with "+ New user" (`/admin/users/new`); tapping one opens `/admin/users/:email` to edit or remove them.
- `/admin/brigades` lists brigades, each opening its `/:slug/admin`; the superadmin also gets "+ New brigade" (`/admin/brigades/new`).
- `/:slug/admin` has "Check entry ›" (to `/:slug`) and three sections. Details edits the brigade's name, Check Day, Report Email and weekly email; only the superadmin can deactivate a brigade, and nothing deletes one. Appliances lists its appliances (including inactive ones) with a "+ Add appliance" row. Reports has the Monthly Report picker and PDF download.
- `/:slug/admin/:applianceId` edits one appliance: its Callsign, Active toggle and QR link, and its Check Sheet. Edits to the Check Sheet save to a Draft as you go; a banner summarises what changed, and Publish makes the Draft the Check Sheet that Checks use (or Discard throws it away). You can also copy another appliance's Check Sheet, or import a public Google Sheet (paste its link) from there. Importing in the browser needs `VITE_SHEETS_API_KEY`; see [`docs/infra-setup.md`](./docs/infra-setup.md).

The CLI's `create-brigade`, `brigade-settings`, `add-appliance` and `import-check-sheet` (below) still work as alternatives. Each admin screen's left header button goes up to its parent, and Sign out is on the person's admin home. The screens work out who you are in `src/state/auth.ts` (`adminProfile()`: your own `adminUsers` doc, or superadmin by UID) and gate on that in `src/state/adminGate.ts`; `firestore.rules` is still what actually enforces access. The browser needs `VITE_SUPERADMIN_UID` to recognise the superadmin: `.env.development` sets the emulator's, and `make deploy` passes `SUPERADMIN_UID` from `.env.<env>` to the build. `src/state/auth.ts` wraps Firebase Auth; `src/data/admin.ts` reads and writes brigades, their settings and admin users, and reads a month's Checks; `src/report/pdf.ts` renders the PDF (jsPDF + jspdf-autotable, lazy-loaded).

## `make` targets

- `make check` — lint, typecheck, unit tests, emulator tests (the full CI-equivalent check).
- `make test` — unit tests + emulator tests only.
- `make test-unit` / `make test-emulator` — either suite on its own.
- `make lint` / `make typecheck`
- `make dev` — the Firestore emulator, dev seed and Vite together; Ctrl-C stops them (see Local dev).
- `make provision ENV=dev|prod [PROJECT_ID=<id>]` — creates or checks the Firebase project and its Firestore, Hosting, App Check/reCAPTCHA and Sheets API key (plus, when billing is enabled, the weekly email's functions setup), and writes `.env.<env>`; safe to re-run. `PROJECT_ID` is only needed the first time, after that it comes from `.firebaserc`. See [`docs/infra-setup.md`](./docs/infra-setup.md).
- `make deploy ENV=dev|prod` — builds and deploys Hosting + Firestore rules/indexes (and the Cloud Functions, when billing is enabled on the project) to that environment, behind an account confirmation prompt.
- `make e2e [ENV=dev]` — Playwright, kept out of `make check`. No `ENV` (default): seeds then runs against the Firestore emulator and a local Vite server. `ENV=dev`: seeds and runs against deployed `dev`, using the `E2E_APPCHECK_DEBUG_TOKEN` from `.env.dev`. Requires `npx playwright install chromium` once.
- `make e2e-report` — opens the HTML report from the last `make e2e` run: a screenshot and video of every spec locally, and a trace of any failure (failures only for `ENV=dev`).
- `make apps-script-push` / `make apps-script-deploy` / `make apps-script-test-url` — the Apps Script app's clasp commands, run from `apps-script/`.

Single test file: `npx vitest run <path>` for unit tests, or, for rules/CLI tests, run it through the emulator directly, e.g.:
`PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-appliance-checks "vitest run --project emulator <path>"`.

## CLI tools

All take `--project dev|prod|emulator` (default `emulator`); `dev`/`prod` print the target project and active account and require a `y` confirmation.

```bash
npm run cli:create-brigade -- --name "Mangawhai" --check-day 1
npm run cli:add-appliance -- --brigade <slug> --id 8011 --callsign "Mangawhai 8011"
npm run cli:brigade-settings -- --brigade <slug> [--report-email <addr> | --clear-report-email] [--weekly-email on|off]
SHEETS_API_KEY=... npm run cli:import-check-sheet -- --brigade <slug> --appliance 8011 [--spreadsheet <id>] [--dry-run]
```

`import-check-sheet` reads the spreadsheet id from the current Check Sheet version when it was itself imported; otherwise `--spreadsheet` is required. It prints an import report (matched/changed/added/removed) and does nothing if nothing changed.
