# Foundations implementation plan (#4)

Design: `docs/designs/2026-09-25-foundations-design.md`. One phase.

## Decisions and verified facts

- Toolchain: Node 26, npm 11. No global Firebase CLI: add `firebase-tools` as a dev dependency and call it via `npx firebase`.
- Versions: vue 3.5, vite 8, vue-router 5, vitest 5, firebase 12, firebase-admin 14, firebase-tools 15, @firebase/rules-unit-testing 5, @vitejs/plugin-vue 6, vue-tsc 3, eslint 10, eslint-plugin-vue 10, typescript-eslint 8, tsx 4. **TypeScript `~6.0.3`**, not 7: typescript-eslint's peer range is `<6.1.0`.
- Java: system default is Temurin 11; Homebrew `openjdk@21` is installed at `/opt/homebrew/opt/openjdk@21`. firebase-tools 15's Firestore emulator probably needs Java 21. If so, the Makefile's emulator commands prepend `$(JAVA_HOME_21)/bin` to `PATH`, with `JAVA_HOME_21 ?= /opt/homebrew/opt/openjdk@21` overridable. Verify, don't assume.
- Emulator project id: `demo-appliance-checks` (the `demo-` prefix means no real project or credentials).
- Firebase `dev`/`prod` projects don't exist yet. `.firebaserc`, per-env web config and the deploy run happen at the end with the user. The `deploy` CLI and Makefile target are written now.
- Sheets API grid shape (from API docs, unverified until the first real import): `sheets[0].data[0].rowData[].values[]` of `CellData`. Relevant fields: `formattedValue`, `dataValidation.condition.type` (`BOOLEAN` = checkbox, `ONE_OF_LIST` = dropdown, values in `condition.values[].userEnteredValue`), `effectiveFormat.backgroundColorStyle.rgbColor` or deprecated `effectiveFormat.backgroundColor`. RGB components are 0–1 floats and **zero components are omitted** (black is `{}`). Trailing empty cells and rows may be missing.
- `fetchSheet` makes two calls: one for the first tab's title (`fields=sheets.properties.title`), then grid data with `ranges=<title>`. Deviation from the design's "one call": without `ranges`, `includeGridData` returns every tab.
- Items before the first Section header (title, rego, date rows) are skipped, as `getSheetData` does.
- `ONE_OF_RANGE` and other validation types → `written`, as `getSheetData` does.
- **Deviations to report** (moved to the slice that first uses them, since nothing in #4 would exercise them): `src/firebase.ts`, `.env.dev`/`.env.prod` web config and the `/{slug}/{applianceId}` route go to #5. The slug pattern constant lives in `src/domain/slug.ts` so #5's route can use it. The Landing page's admin sign-in link goes to #6, since `/admin` doesn't exist until then.
- **Additional tests beyond the design**: the Admin SDK store layer (`cli/lib/store.ts`) gets emulator tests for the version transaction and slug-collision retry, since those are real logic hidden in the "thin" CLI. `resolveSpreadsheetId` is pure and gets unit tests.
- **Deviation from the design's "no changes means no new version"**: `import-check-sheet` writes a new version when the content is byte-for-byte unchanged but `--spreadsheet` names a different sheet than the current version's `origin.spreadsheetId` (or the current version wasn't itself an import). Otherwise a later default import (`resolveSpreadsheetId` with no flag) would keep reading the old, no-longer-intended source forever. `reconcile`'s own `unchanged` stays exactly "sections deep-equal current"; the CLI additionally checks `current?.origin` before treating it as a no-op.
- **`ImportReport` additions beyond the design/plan**: `sectionsRenamed: { from, to }[]` (a matched Section whose title text changed, e.g. case/whitespace only — the id is kept, only the display text changes) and `reordered: boolean` (Section or Item order differs from `current` among entries present in both). Added after review: without them, a Section rename or a pure reorder can leave every other report field at zero while `unchanged` is still `false`, so the CLI would ask to write a new version with a report that looks empty.

## Phase 1

**Goal:** everything in the design except the deploy run itself.

**Done criteria:** `make check` passes (lint, typecheck, unit tests, emulator tests). A manual run of `create-brigade`, `add-appliance` and `import-check-sheet --dry-run` against the emulator works (the import needs a real `SHEETS_API_KEY`, so that part may wait for the deploy step).

### Tasks

- [x] 1. Move the Apps Script app: `git mv Code.gs Index.html appsscript.json .clasp.json .claspignore apps-script/`. Move README's Apps Script setup into `apps-script/README.md`.
- [x] 2. Scaffold: `package.json` (scripts below), `tsconfig.json` (strict, covers `src`, `cli`, `tests`), `vite.config.ts`, `vitest.config.ts` (projects `unit` = `tests/domain/**`, `emulator` = `tests/rules/**` + `tests/cli/**`), `eslint.config.js` (flat, typescript-eslint + eslint-plugin-vue), `index.html`, `src/main.ts`, `src/App.vue`, `src/router.ts` (route `/` → Landing, catch-all redirects to `/`), `src/views/Landing.vue` (plain "Scan the QR code on your appliance to start a Check."), `.gitignore` (`node_modules`, `dist`, `*-debug.log`, `.env.local`, `.DS_Store`, `.firebase/`).
- [x] 3. `firebase.json`: firestore rules + indexes, hosting `public: dist` with SPA rewrite, emulators firestore `8080` and hosting `5000`, `singleProjectMode`. `firestore.indexes.json` empty.
- [x] 4. Domain types in `src/domain/types.ts`: `Brigade`, `BrigadeSettings`, `Appliance`, `Item` (`id, label, qty: string | null, inputType: 'yn' | 'choice' | 'written', options?: string[], scope: 'weekly' | 'monthly'`), `Section`, `CheckSheetVersion` (with `origin`), `ParsedItem = Omit<Item, 'id'>`, `ParsedSection`, `ParsedCheckSheet`.
- [x] 5. `src/domain/random.ts`: `randomString(length, alphabet)` via `crypto.getRandomValues` (works in Node and browser), rejection sampling to avoid modulo bias. `src/domain/slug.ts`: `SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'`, `SLUG_LENGTH = 6`, `SLUG_PATTERN = '[2-9a-hjkmnp-z]{6}'`, `generateSlug()`. `newId()` (8 chars, same alphabet) for Section and Item ids.
- [x] 6. `src/domain/import/parse.ts`: `parseCheckSheet(grid: SheetGrid): ParsedCheckSheet`, throws `ImportError` (in `src/domain/import/errors.ts`). Behaviour per design and facts above. Normalise for duplicate checks with `normalise(s) = s.trim().replace(/\s+/g, ' ').toLowerCase()` (shared with reconcile, in `src/domain/import/normalise.ts`). Monthly detection: hex of `backgroundColorStyle.rgbColor ?? backgroundColor`, missing components = 0, `Math.round(c * 255)`, compared to `#434343`.
- [x] 7. `src/domain/import/reconcile.ts`: `reconcile(current: Section[] | null, parsed: ParsedCheckSheet, makeId = newId): { sections: Section[]; report: ImportReport; unchanged: boolean }`. `ImportReport = { matched, changed: { section, label, fields: string[] }[], added, removed, sectionsAdded, sectionsRemoved }` with items as `{ section, label }`. Matched Sections keep their id; the new title text is taken. Matched Items keep their id and take every other field, including label text (a case-only label change lands in `changed` with `fields: ['label']`). `unchanged` = the resulting `sections` deep-equal `current` (catches reorders too).
- [x] 8. `src/domain/import/source.ts`: `resolveSpreadsheetId(current: CheckSheetVersion | null, flag?: string): string` — flag wins; else current's `origin.spreadsheetId` when `origin.type === 'import'`; else throw `ImportError` explaining `--spreadsheet` is required (and why, for editor origin).
- [x] 9. `src/domain/import/fetch.ts`: `fetchSheet(spreadsheetId, apiKey): Promise<SheetGrid>`, per facts above. `fields` for the data call: `sheets(data(rowData(values(formattedValue,dataValidation,effectiveFormat(backgroundColor,backgroundColorStyle)))))`. Non-2xx → `ImportError` with status and Google's error message (e.g. sheet not public).
- [x] 10. `firestore.rules`: `brigades/{slug}` get; `appliances/{id}` read; `appliances/{id}/checkSheetVersions/{n}` read; everything else denied by default.
- [x] 11. `cli/lib/target.ts`: parse `--project dev|prod|emulator` (default `emulator`). Emulator: set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` if unset, project `demo-appliance-checks`, no prompt. dev/prod: read the project id from `.firebaserc` aliases (clear error if missing), get the ADC account email (`google-auth-library` `GoogleAuth` access token → `https://oauth2.googleapis.com/tokeninfo`), print project and account, y/N prompt via `node:readline/promises`; abort on anything but `y`. Returns an initialised Admin `Firestore`.
- [x] 12. `cli/lib/store.ts` (Admin SDK): `createBrigade(db, { name, checkDay }, makeSlug = generateSlug)` — `create()` on `brigades/{slug}`, retry on `ALREADY_EXISTS` up to 5 times, also creates `private/settings` as `{}`; returns `{ slug, brigadeId }`. `addAppliance(db, slug, { id, callsign })` — fails if the brigade doesn't exist or the appliance id is taken. `getCurrentVersion(db, slug, applianceId)`. `writeVersion(db, slug, applianceId, { expectedCurrent, sections, origin })` — transaction: re-read appliance, fail if `currentCheckSheetVersion !== expectedCurrent`, create version `expectedCurrent + 1` (or 1), move the pointer.
- [x] 13. CLI entry points using `node:util` `parseArgs`: `cli/create-brigade.ts` (`--name`, `--check-day` 1–7), `cli/add-appliance.ts` (`--brigade`, `--id`, `--callsign`; prints the QR URL using the Hosting base URL `https://<projectId>.web.app`, or `http://127.0.0.1:5000` for the emulator), `cli/import-check-sheet.ts` (`--brigade`, `--appliance`, `--spreadsheet?`, `--dry-run`; `SHEETS_API_KEY` required; prints spreadsheet id and report; no-op when `unchanged`; confirms before writing even on the emulator, since it replaces the current Check Sheet), `cli/deploy.ts` (`--project dev|prod`; prints `firebase login:list` output and project id, y/N, then `vite build --mode <env>` and `firebase deploy --project <env> --only hosting,firestore:rules,firestore:indexes`). Validation errors → message and exit 1, no stack trace.
- [x] 14. `package.json` scripts: `dev`, `build`, `lint`, `typecheck` (`vue-tsc --noEmit`), `test:unit` (`vitest run --project unit`), `test:emulator` (`firebase emulators:exec --only firestore --project demo-appliance-checks "vitest run --project emulator"`), `emulators`, and `cli:*` wrappers (`tsx cli/...`).
- [x] 15. Makefile: `check` (lint, typecheck, test:unit, test:emulator), `test`, `dev` (emulators + vite concurrently, or two documented commands if simpler), `deploy ENV=dev|prod` (`tsx cli/deploy.ts --project $(ENV)`), `apps-script-push`, `apps-script-deploy`, `apps-script-test-url` (same commands, run in `apps-script/`).
- [x] 16. ADRs: `docs/adr/0003-check-sheet-versions-are-immutable-snapshots.md`, `docs/adr/0004-brigade-link-slug-is-the-document-id.md`, in the style of 0001/0002 (short title, one paragraph, optional Considered Options / Consequences).
- [x] 17. README rewrite: what the app is, repo layout, prerequisites (Node, JDK 21 for emulators, gcloud ADC for dev/prod CLI), `make` targets, CLI usage, data model pointer to the design doc. Brief.

### Test cases

Fixture: `tests/domain/fixtures/sheet.ts`, a builder for `SheetGrid` (e.g. `row(label, qty, yCell?)`, `ynCell({ monthly })`, `listCell(options)`, `plainCell()`), plus one March-shaped fixture: title rows, date row, a Section header with `Y`/`N` in C/D, and within it a weekly `yn` Item, a Monthly `yn` Item (`#434343` as `{red: 0.2627, green: 0.2627, blue: 0.2627}`), a `FUEL` `choice` Item with options `['1/4','1/2','3/4','FULL']`, and a second Section with a written Item (rego expiry, no validation), then the "MISSING - DEFECTS - ISSUES Write Below" row followed by free-text rows.

`tests/domain/import/parse.test.ts`:
1. March fixture → two Sections with titles and Items in order; header rows before the first Section ignored.
2. Checkbox validation on the Y cell → `inputType: 'yn'`.
3. List validation → `inputType: 'choice'` with options in order.
4. No validation → `written`, no `options`.
5. `yn` with `#434343` background → `scope: 'monthly'`; same background on a `choice` Item → `weekly`.
6. Colour given only via deprecated `backgroundColor` → still monthly.
7. Colour with omitted zero components (`{}` = black) → weekly, no crash.
8. Rows from "MISSING - DEFECTS - ISSUES" onwards → not in output.
9. `qty` `' 1each '` → `'1each'`; empty → `null`.
10. Y/N header with typo `N)` → still detected (non-alpha stripped).
11. Y/N pair not in C/D (e.g. E/F) → validation read from E.
12. No "Quantity" row → `ImportError`.
13. "Quantity" row but no Y/N pair → `ImportError`.
14. Duplicate Section title (case/whitespace-different) → `ImportError` naming it.
15. Duplicate Item label within a Section → `ImportError` naming Section and label; same label in two Sections → fine.
16. Rows with an empty label are skipped.

`tests/domain/import/reconcile.test.ts` (with a deterministic `makeId`):
17. `current = null` → every Section and Item gets a new id, all in `added`/`sectionsAdded`, `unchanged: false`.
18. Same content re-parsed → ids kept, everything in `matched`, `unchanged: true`.
19. Label differs only in case/whitespace → id kept, new label text, in `changed` with `['label']`.
20. Renamed Item → old in `removed`, new in `added` with a new id.
21. Qty/inputType/options/scope changed → id kept, `changed` lists exactly those fields.
22. Item moved to another Section → `removed` + `added`, new id.
23. Section removed/added → `sectionsRemoved`/`sectionsAdded`; Items in a removed Section in `removed`.
24. Items reordered with no other change → `unchanged: false`, ids kept.

`tests/domain/import/source.test.ts`:
25. Flag given with import-origin current → flag.
26. No flag, import-origin current → its `spreadsheetId`.
27. No flag, `current = null` → `ImportError`.
28. No flag, editor-origin current → `ImportError` mentioning the editor.

`tests/domain/slug.test.ts`:
29. `generateSlug()` → length 6, every char in `SLUG_ALPHABET`, matches `SLUG_PATTERN`.

`tests/rules/firestore.rules.test.ts` (seeded with rules disabled; unauthenticated context):
30. get `brigades/{slug}` → allowed.
31. list `brigades` → denied.
32. get `brigades/{slug}/private/settings` → denied.
33. get and list `brigades/{slug}/appliances` → allowed.
34. collection group query on `appliances` → denied.
35. get and list `checkSheetVersions` → allowed.
36. get `brigades/{slug}/checks/{id}` → denied (rules arrive in #5).
37. write to brigade, settings, appliance, version and check → each denied (`it.each`).

`tests/cli/store.test.ts` (Admin SDK against the emulator, cleared between tests):
38. `createBrigade` → brigade doc with generated `brigadeId`, `private/settings` exists.
39. `createBrigade` with a `makeSlug` returning a taken slug first → retries and uses the second.
40. `addAppliance` with an existing id → error; unknown brigade → error.
41. `writeVersion` with `expectedCurrent: null` → version 1 created, pointer 1; again with `1` → version 2, version 1 untouched.
42. `writeVersion` with stale `expectedCurrent` → throws, nothing written.

### Docs updates

- README rewrite (task 17), `apps-script/README.md` (task 1), ADRs 0003/0004 (task 16).
- Design doc unchanged; deviations are recorded here and in the hand-back summary.

## Commands

- Checks + full suite: `make check`
- Single test: `npx vitest run tests/domain/import/parse.test.ts` (unit) or `npm run test:emulator -- <path>` style via `firebase emulators:exec` for emulator tests

## Traceability

Design → plan: architecture/layout (2, 3, 14, 15), apps-script move (1), account guard (11, 13), data model and ids (4, 5, 12), slug and QR URL (5, 13), private settings (10, 12), versions transaction (12), rules (10; tests 30–37), ADRs (16), fetch/parse/reconcile (6, 7, 9; tests 1–24), CLI tools and `--spreadsheet` rule (8, 13; tests 25–28, 38–42), environments/deploy (3, 13, 15; run at the end with the user), testing (all test cases). Deferred with reasons: `firebase.ts`, env web config, slug route (#5), admin link (#6).

Plan → design: every task maps to a design section; the only additions are the store tests (38–42) and `resolveSpreadsheetId` extraction, both supporting design behaviour.
