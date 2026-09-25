# Foundations design (#4)

Stand up the Firebase app so a brigade's Check Sheets exist in Firestore and can be reached through its Brigade Link. Terminology follows `CONTEXT.md`.

## Architecture

- Vue 3 + Vite + TypeScript + Vue Router, one npm package at the repo root. Vitest for unit tests, `@firebase/rules-unit-testing` against the Firestore emulator for rules tests, ESLint + `vue-tsc`.
- Layout:
  ```
  apps-script/     existing Apps Script app, moved as-is
  src/
    domain/        pure TS: types, slug generation, Check Sheet import (fetch, parse, reconcile)
    firebase.ts    client init, emulator in dev
    router.ts, main.ts, App.vue
    views/         Landing.vue (bare URL page)
  cli/             create-brigade, add-appliance, import-check-sheet (Admin SDK, run with tsx)
  tests/
    domain/        unit tests + Sheets API fixtures
    rules/         Firestore rules tests
  firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
  ```
- Makefile: `check` (lint, typecheck, unit tests, rules tests under `firebase emulators:exec`), `dev` (emulators + Vite), `deploy ENV=dev|prod`, and the clasp targets renamed `apps-script-push` / `apps-script-deploy`.
- Account guard: deploy and CLI tools print the target project and active account (Firebase CLI login, or gcloud ADC) and require y/N before touching `dev` or `prod`. The emulator skips it.
- Out of scope: admin sign-in (#6), Check entry UI (#5), import UI (follow-up), the rotate action itself.

## Data model

```
brigades/{slug}                                   anonymous: get
  brigadeId, name, checkDay (1–7, Mon=1), active

brigades/{slug}/private/settings                  no anonymous access
  reportEmail?, assignedVsoId?

brigades/{slug}/appliances/{applianceId}          anonymous: get, list
  callsign, active, currentCheckSheetVersion (int | null)

brigades/{slug}/appliances/{applianceId}/checkSheetVersions/{n}   anonymous: get, list; immutable
  version, createdAt,
  origin: { type: 'import', spreadsheetId } | { type: 'editor' }
  sections[{ id, title, items[{ id, label, qty, inputType: 'yn' | 'choice' | 'written', options?, scope: 'weekly' | 'monthly' }] }]

brigades/{slug}/checks/{applianceId}_{YYYY-MM-DD}
  applianceId, scheduledDate, checkSheetVersion, responses{ itemId: ... }   (finalised in #5)
```

- Brigade Link slug: 6 chars from lowercase alphanumerics minus `0 o 1 l i` (~30 bits). Obscurity only (ADR 0001); App Check / budget alerts are the answer to scripted guessing, not a longer slug.
- QR URL: `https://<host>/{slug}/{applianceId}`. The router only matches the slug alphabet at length 6, and that alphabet can't spell words with `i`, `l` or `o`, so fixed routes don't collide.
- Appliance id is short and readable (e.g. `8011`); the slug provides the obscurity.
- `reportEmail` and the VSO live in `private/settings` because rules can't hide fields on a readable doc.
- Section and Item ids are random short ids; order is array order. `qty` is the raw trimmed string, or null.
- A new Check Sheet version is written in a transaction: create `n+1` and move `currentCheckSheetVersion`, failing if it moved since read.
- Rules in #4: all client writes denied (CLI uses the Admin SDK); anonymous get/list within a slug; listing `brigades` denied; no collection group rules. Check rules come in #5, admin rules in #6.
- ADRs: 0003 Check Sheet versions are full immutable snapshots; 0004 the slug is the document id and rotation moves the data (a stable `brigadeId` is what other records reference).

## Check Sheet import

Pure functions in `src/domain/import/`, runnable in Node now and the browser later (public sheets need only an API key):

1. `fetchSheet(spreadsheetId, apiKey)`: one Sheets API `spreadsheets.get` via `fetch`, first tab, `includeGridData`, fields trimmed to values, data validation and background colour.
2. `parseCheckSheet(grid)`: ports `getSheetData`.
   - A row with "Quantity" in column B starts a Section; the first Y/N pair gives the column to read validation and background from.
   - Checkbox validation → `yn`; list validation → `choice` with its options; anything else → `written`.
   - `yn` with a `#434343` Y cell → Monthly Item (API colours are 0–1 floats, converted to hex).
   - Stops at the "MISSING - DEFECTS - ISSUES" row.
   - Errors: no Section header, no Y/N pair, duplicate Section titles, duplicate Item labels within a Section.
3. `reconcile(current, parsed)`: matches Sections by title and Items by Section title + label (case and whitespace insensitive). Matched Items keep their id and take the new fields; unmatched get new ids. Reports matched / changed / added / removed. A moved Item is removed + added. No changes means no new version.

CLI tools:

- `create-brigade --name --check-day`: generates a unique slug and `brigadeId`, prints the Brigade Link.
- `add-appliance --brigade <slug> --id <id> --callsign <callsign>`: prints the QR URL.
- `import-check-sheet --brigade <slug> --appliance <id> [--spreadsheet <id>] [--dry-run]`: `--spreadsheet` is required when there's no current version or it came from the editor, and otherwise defaults to the current version's `spreadsheetId`. Prints the report (including which spreadsheet), confirms, then writes. `SHEETS_API_KEY` from the environment.

## Environments and deploy

- `dev` and `prod` Firebase projects as `.firebaserc` aliases, plus local emulators (Firestore, Hosting).
- Firebase web config per environment in committed `.env.dev` / `.env.prod`.
- `make deploy ENV=dev`: `vite build --mode dev`, then `firebase deploy --project dev --only hosting,firestore:rules,firestore:indexes`, behind the account guard. Hosting rewrites to `index.html`.
- Sheets API key: restricted to the Sheets API (and Hosting domains once the browser uses it).

## Testing

- Unit: `parseCheckSheet` against a trimmed Sheets API fixture shaped like the March sheet (weekly `yn`, Monthly Item, FUEL `choice`, written value, defects rows) plus one fixture per error; `reconcile` for keep-id, rename, changed fields and no-op; slug length and alphabet.
- Rules: anonymous get/list within a slug allowed; listing `brigades`, reading `private/settings` and any client write denied.
- CLI tools and `fetchSheet` are thin wrappers, checked by a manual run against the emulator.
- Manual "done when": deployed to `dev`; Mangawhai sheets imported; re-import after a sheet rename reports it and keeps other Item ids.
