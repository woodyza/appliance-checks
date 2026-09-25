# Appliance Checks

A brigade's routine checks that each appliance's equipment is present and serviceable, recorded on a phone at the appliance rather than on paper or a spreadsheet. Terminology is defined in [`CONTEXT.md`](./CONTEXT.md).

Each brigade gets an unguessable Brigade Link (`https://<host>/{slug}`), reached almost entirely via QR codes on its appliances. No sign-in is needed to run a Check; editing Check Sheets and other admin tasks require an authenticated Brigade Admin or VSO (not yet built — see [the design doc](./docs/designs/2026-09-25-foundations-design.md)).

## Repository layout

```
apps-script/     the original Google Apps Script app (superseded, see apps-script/README.md)
src/
  domain/        pure TS: types, slug generation, Check Sheet import (fetch, parse, reconcile)
  views/         Vue views
cli/             admin CLI tools (provision, create-brigade, add-appliance, import-check-sheet, deploy)
tests/
  domain/        unit tests
  rules/         Firestore rules tests (emulator)
  cli/           CLI/Admin SDK tests (emulator)
firebase.json, firestore.rules, firestore.indexes.json
```

Data model: see [the design doc](./docs/designs/2026-09-25-foundations-design.md#data-model). Decisions worth keeping are recorded as ADRs in [`docs/adr/`](./docs/adr/).

## Prerequisites

- Node 26+ and npm.
- A JDK at version 21+ for the Firestore emulator (firebase-tools no longer supports older Java). `make check`/`make test` run the emulator commands with `JAVA_HOME_21` (defaults to Homebrew's `openjdk@21`) prepended to `PATH` for you; override it if yours lives elsewhere. `make dev` just prints the two commands to run (see below) — it doesn't run them, so the `PATH=...` prefix it prints still applies. Running `npm run test:emulator` or `npm run emulators` directly (without `make`/the printed command) needs a JDK 21+ `java` on your `PATH` yourself, e.g. `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:emulator`.
- For `dev`/`prod` (not the emulator): gcloud and the Firebase CLI logged in as the same account. Setting up the Firebase projects is covered in [`docs/infra-setup.md`](./docs/infra-setup.md).
- `clasp` (installed globally, authenticated) if you're working on the Apps Script app — see `apps-script/README.md`.

## `make` targets

- `make check` — lint, typecheck, unit tests, emulator tests (the full CI-equivalent check).
- `make test` — unit tests + emulator tests only.
- `make test-unit` / `make test-emulator` — either suite on its own.
- `make lint` / `make typecheck`
- `make dev` — prints the two commands to run (emulators, then Vite) in separate terminals; it doesn't run them itself.
- `make provision ENV=dev|prod PROJECT_ID=<id>` — creates or checks the Firebase project and its Firestore, Hosting and Sheets API key; safe to re-run. See [`docs/infra-setup.md`](./docs/infra-setup.md).
- `make deploy ENV=dev|prod` — builds and deploys Hosting + Firestore rules/indexes to that environment, behind an account confirmation prompt.
- `make apps-script-push` / `make apps-script-deploy` / `make apps-script-test-url` — the Apps Script app's clasp commands, run from `apps-script/`.

Single test file: `npx vitest run <path>` for unit tests, or, for rules/CLI tests, run it through the emulator directly, e.g.:
`PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-appliance-checks "vitest run --project emulator <path>"`.

## CLI tools

All take `--project dev|prod|emulator` (default `emulator`); `dev`/`prod` print the target project and active account and require a `y` confirmation.

```bash
npm run cli:create-brigade -- --name "Mangawhai" --check-day 1
npm run cli:add-appliance -- --brigade <slug> --id 8011 --callsign "Mangawhai 8011"
SHEETS_API_KEY=... npm run cli:import-check-sheet -- --brigade <slug> --appliance 8011 [--spreadsheet <id>] [--dry-run]
```

`import-check-sheet` reads the spreadsheet id from the current Check Sheet version when it was itself imported; otherwise `--spreadsheet` is required. It prints an import report (matched/changed/added/removed) and does nothing if nothing changed.
