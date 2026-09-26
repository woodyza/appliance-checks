# Monthly Report implementation plan (#6)

Design: `docs/designs/2026-09-27-monthly-report-design.md`. Two phases: phase 1 is the data contract (the pure report model, rules and the deploy-time UID substitution), worth reviewing before the UI and PDF build on it; phase 2 is everything that runs it (Auth client, admin views, data access, PDF, provisioning, deploy, seeds, e2e, docs).

## Decisions and verified facts

- **`firebase deploy --config <file>` resolves every path from the config file's directory** (`detectProjectRoot` returns `dirname(configPath)`, and `resolveProjectPath` resolves against it), so a config under `.deploy/` would look for `.deploy/dist`, `.deploy/firestore.indexes.json` and likely `.deploy/.firebaserc`. Instead, generate a gitignored `firebase.deploy.json` at the repo root, identical to `firebase.json` except `firestore.rules: ".deploy/firestore.rules"`. Settles the design's TBC without the `firebase.json` swap fallback.
- **No firebase-tools command enables the Email provider** (only `auth:export`/`auth:import`). So provisioning PATCHes `https://identitytoolkit.googleapis.com/admin/v2/projects/{p}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired` with `{ signIn: { email: { enabled: true, passwordRequired: false } } }`, reusing `provision.ts`'s existing REST PATCH helper (generalised to take a full URL). Whether that works on a project where Auth has never been "started" in the console is TBC on the manual `dev` run; if it 404s with `CONFIGURATION_NOT_FOUND`, the error says to click Get started under Authentication in the console once and re-run.
- **App Check on Auth**: firebase-tools maps the `auth` alias to `identitytoolkit.googleapis.com`, so the service id is valid. `provision.ts` already enforces Firestore via the REST API (the firebase-tools commands are behind a preview flag), so Auth uses the same `PATCH projects/{n}/services/identitytoolkit.googleapis.com`. If it fails (eg needs Identity Platform or billing), provisioning warns and carries on rather than failing, so the rest of the environment still provisions; the outcome gets recorded in `docs/infra-setup.md` after the manual run.
- **`substituteSuperadmin` lives in `cli/lib/rules.ts`** so its test sits in `tests/cli/lib/` and runs in the `unit` vitest project (which only includes `tests/domain` and `tests/cli/lib`).
- **% is `Math.floor(answered / due * 100)`**, so a nearly-done Check never reads 100%. A column with no due Items (only possible for an empty Check Sheet) is 0%.
- **Base version for the row merge** is the highest version number among the existing Checks' render versions, or `currentVersion` when the month has none; missing columns render against it. Followed as designed, even though in the current month the app would show a missing open Check against the current version.
- **An Item moved between Sections across versions** shows once, in its newest Section (the design is silent). The merge tracks placed Item ids across all Sections, and a Section left empty by moves is dropped. Found in the phase 1 diff check.
- **`recentMonths(today, count)`** in `schedule.ts` backs the month picker (current month first, then earlier ones). Small but has year rollover, so one unit test. Not in the design's test list; a how-level addition.
- **Spec 5 ("switches appliance") only checks E2E 1 and E2E 2 are visible**, not a count, so adding `e2e3` is safe (verified).
- **Auth emulator oobCodes**: `GET http://127.0.0.1:9099/emulator/v1/projects/demo-appliance-checks/oobCodes` returns `{ oobCodes: [{ email, oobLink, requestType }] }` (firebase-tools `apiSpec.js`).
- **jsPDF 4.2.1 and jspdf-autotable 5.0.8** (peer `jspdf ^2 || ^3 || ^4`) are the current releases.
- **The plan is committed**, as `check-entry.md` and `foundations.md` were: AGENTS.md makes it part of each slice.
- **Not run by the implementer**: `make provision`, `make deploy` and `make e2e ENV=dev` against real projects (outward-facing, need the user's accounts). Handed back, as in #5.

## Phase 1: report model, rules and UID substitution

**Goal:** the pure Monthly Report model, the superadmin rules, and the deploy-time substitution, with tests.

**Done when:** `make check` passes; every case below exists and passes.

### Tasks

- [x] 1.1 `src/domain/schedule.ts`: add `firstOfNextMonth(date)` (`'2026-12-15'` → `'2027-01-01'`) and `recentMonths(today, count)` (`'YYYY-MM'` strings, newest first).
- [x] 1.2 `src/domain/report.ts` (pure), `buildMonthlyReport({ brigade, appliance, month, checks, versions, currentVersion, today })`:
  - `versions: Map<number, CheckSheetVersion>` holding every version a Check in `checks` is stamped with; `currentVersion: CheckSheetVersion`.
  - Types: `ReportCell = { kind: 'na' } | { kind: 'notDue' } | { kind: 'yn'; value: 'Y' | 'N' | null } | { kind: 'value'; value: string | null }`; `ReportColumn { date, check: Check | null, version: number, monthly: boolean, percent: number }`; `ReportRow { item: Item, cells: ReportCell[] }`; `ReportSection { id, title, rows }`; `MonthlyReport { brigadeName, callsign, month, columns, sections }`.
  - Dates: union of `checks`' dates and `checkDatesBetween(firstOfMonth, end, checkDay)`, where `end` is the last day of the month, or `currentCheckDate(today, checkDay)` if that's earlier. Sorted.
  - Column version: `renderVersion(check, isFrozen(check, versions.get(check.checkSheetVersion), today, checkDay), currentVersion.version)` for an existing Check; the base version for a missing one. `monthly` from `monthlyFor`. % via `sectionProgress` against the column's version (0 for a missing Check).
  - Rows: merge as the design says (base first, then older versions newest-first; an unplaced Item goes after its predecessor in that version, else first in its Section; unplaced Sections likewise). Label, qty, input type and Section title come from the newest version containing them, which falls out of placing newest first.
  - Cells: from the column's own version: `na` if the Item isn't in it; `notDue` for a Monthly Item on a non-monthly column; else `yn` (value `'Y'`/`'N'`, anything else `null`) or `value`. Only Items in the column's version are looked up, so stray answers are ignored.
  - Versions a column needs must be present in `versions` or be `currentVersion`; throw otherwise (a programming error, not a user state).
- [x] 1.3 `firestore.rules`: `isSuperadmin()` = `request.auth != null && request.auth.uid == 'emulator-superadmin'`; `brigades`: `allow list: if isSuperadmin()`; `checks` list: `isSuperadmin() || <existing bound>`. Nothing else changes.
- [x] 1.4 `cli/lib/rules.ts`: `substituteSuperadmin(rules, uid)` replaces the `'emulator-superadmin'` literal with `'<uid>'` (`''` when `uid` is undefined or empty), throwing unless the literal occurs exactly once.

### Test cases

`tests/domain/report.test.ts`, fixture in the `check.test.ts` style (8-char ids from the slug alphabet). v1: Section A (Torch yn weekly, Ladder yn monthly, Rego written weekly, Fuel choice weekly, Old v1-only yn weekly after Torch), Section Old (v1-only, between A and B, one Item). v2: Section A (Torch renamed "Torch (LED)", Ladder, Rego, Fuel as `written` instead of `choice`, New v2-only Item), Section B (Hose monthly). Brigade `checkDay` 1 (Mon), month `2026-08` (Mondays 3, 10, 17, 24, 31), `today` in October unless stated.

- Row merge:
  - Old (v1-only) lands right after Torch in Section A.
  - Torch's row label is "Torch (LED)".
  - Section Old lands after Section A, before Section B.
- Cells:
  - v1 column: New is `na`; v2 column: Old is `na`.
  - Ladder on a weekly column is `notDue`; on the monthly (31st) column it's `yn`.
  - Torch `Y` and Rego `'31/12/26'` come through as `yn` Y and `value` '31/12/26'.
  - A response for an Item not in the column's version (New's id on a v1 Check) doesn't show anywhere.
  - Fuel is `value` on both, with the choice answer on v1 and the written answer on v2 (input type per column).
- Columns:
  - A missing date is 0% with empty `yn`/`value` cells against the base (v2), not `na`.
  - The missing 31st (last of month) column is `monthly`.
  - Current month (`today` 2026-08-19, a Wednesday): columns are 3, 10, 17 only.
  - A Check on 2026-08-05 (a Wednesday, old Check Day) is included alongside the Monday dates.
  - % for a partial Check: floor of answered/due.
- Version choice: with `today` 2026-08-19, an incomplete v1 Check on the 17th (window still open) renders v2 (current); a Complete v1 Check on the 3rd renders v1.
- No Checks: every column is 0% and renders `currentVersion`, and rows come from it.

`tests/domain/schedule.test.ts`: `firstOfNextMonth` across December; `recentMonths('2026-02-10', 3)` → `['2026-02', '2026-01', '2025-12']`.

`tests/cli/lib/rules.test.ts`: replaces the literal with the UID; substitutes `''` with no UID; throws when missing; throws when duplicated.

`tests/rules/firestore.rules.test.ts` (seed an old Check at `2000-01-03` with rules disabled):
- As `emulator-superadmin`: listing `brigades` allowed; `checks` list `applianceId == 8011`, `scheduledDate >= '2000-01-01'`, `< firstOfPreviousMonth`, `orderBy scheduledDate` allowed; `get` on the old Check allowed.
- As `emulator-superadmin`: writes to brigade, appliance and version denied.
- As another UID: listing brigades denied; the `2000-01-01`-bounded checks list denied.
- Existing anonymous cases unchanged.

### Docs updates

None in this phase.

## Phase 2: Auth, admin UI, PDF, provisioning, deploy, seeds, e2e

**Goal:** the superadmin can sign in and download a Monthly Report locally and (after the manual run) on `dev`.

**Done when:** `make check` passes; `make e2e` (emulator) passes including the two new specs; manual steps are written down for the user.

### Tasks

- [ ] 2.1 Emulator wiring:
  - `firebase.json`: `emulators.auth.port: 9099`.
  - `package.json` `emulators` script: `--only firestore,auth`. `test:emulator` unchanged.
  - `Makefile` `e2e` throwaway emulator: `--only firestore,auth`. The "running `make dev`" probe stays on 8080.
  - `cli/lib/target.ts` `resolveTarget('emulator')`: `process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'`; `dev`/`prod` delete it, as they do for Firestore.
- [ ] 2.2 `src/firebase.ts`: export `auth = getAuth(app)`; `connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })` when `useEmulator`.
- [ ] 2.3 `src/state/auth.ts`: `authReady()` (promise resolving with the user after the first `onAuthStateChanged`), `currentUser` ref, `sendLink(email)` (stores the email in `localStorage` under one key, `url: <origin>/admin/sign-in`, `handleCodeInApp: true`), `isSignInLink(url)`, `completeSignIn(email, url)` (clears the stored email), `storedEmail()`, `signOut()`. Map `auth/invalid-action-code`, `auth/expired-action-code` and `auth/quota-exceeded` to the design's messages.
- [ ] 2.4 `src/data/admin.ts`: `listBrigades()` → `{ slug, brigade }[]` sorted by name; `listChecksInMonth(slug, applianceId, month)` using `firstOfMonth`/`firstOfNextMonth` (`>=`, `<`, `orderBy('scheduledDate')`).
- [ ] 2.5 `src/router.ts`: `/admin/sign-in` → `SignIn.vue`, `/admin` → `ReportView.vue` with `meta.requiresAuth`, both before the slug routes; a `beforeEach` that awaits `authReady()` for `requiresAuth` routes and redirects to `/admin/sign-in` when signed out. `src/views/Landing.vue`: an "Admin sign-in" link.
- [ ] 2.6 `src/views/admin/SignIn.vue`: email form → "check your inbox"; on mount, if the URL is a sign-in link, complete it with the stored email or ask for it; then `router.replace('/admin')`. Errors per the design's table.
- [ ] 2.7 `src/views/admin/ReportView.vue`: loads brigades (`permission-denied` → "Not authorised" plus the UID); brigade, appliance (`listAppliances`) and month (`recentMonths(today(), 12)`, default the second entry) selects; "No Check Sheet yet" with Download disabled when `currentCheckSheetVersion` is null; Download runs the design's load steps, `buildMonthlyReport`, then `await import('../../report/pdf')`; a read failure shows the "Couldn't load the report" toast and leaves Download enabled; sign-out link. Reuses the existing screen, card and toast classes in `src/style.css`; add only what's missing.
- [ ] 2.8 `src/report/pdf.ts`: `downloadMonthlyReport(report, generatedAt)` with jsPDF + jspdf-autotable per the design's PDF section (A4 portrait, 10mm margins, 7pt, label ~70mm, qty 14mm, pairs share the rest, header rows repeated, grey Section rows, cell rendering, % footer row with "Complete"/"not started", "Generated dd/MM/yy HH:mm" line, `<callsign>-<YYYY-MM>.pdf`). `npm install jspdf jspdf-autotable`.
- [ ] 2.9 `cli/deploy.ts`: read `SUPERADMIN_UID` from `.env.<env>`; warn (design's text) if unset; write `.deploy/firestore.rules` via `substituteSuperadmin` and `firebase.deploy.json` (copy of `firebase.json` with the rules path swapped); deploy with `--config firebase.deploy.json`. `.gitignore`: `.deploy/`, `firebase.deploy.json`.
- [ ] 2.10 `cli/provision.ts`: add `identitytoolkit.googleapis.com` to `SERVICES`; generalise `appCheckPatch` into a REST PATCH helper taking a full URL; `enableEmailLinkSignIn` (Decisions); `enforceAuth` (warn and continue on failure); `writeEnvValues` keeps an existing `SUPERADMIN_UID`, like the debug token.
- [ ] 2.11 Seeds (`cli/lib/seed.ts`, `cli/e2e-seed.ts`, `cli/dev-seed.ts`):
  - `ensureSuperadminUser(auth)`: Admin SDK `createUser({ uid: 'emulator-superadmin', email: 'e2e-admin@example.com' })`, skipping if it exists. Emulator only: `e2e-seed` calls it only for `--project emulator`; `dev-seed` always.
  - e2e3 ("E2E 3"): its own v1/v2 fixture (v2 drops a v1-only Item and adds a v2-only one), `currentCheckSheetVersion: 2`; on the previous month's first two Check Days, a Complete Check on v1 then a partial Check on v2.
  - A helper returning the Admin `Auth` for the emulator target alongside Firestore (`resolveTarget` stays Firestore-returning; add `resolveAuth` or return both, whichever keeps callers simplest).
- [ ] 2.12 `tests/e2e/monthlyReport.spec.ts` (skipped when `e2eEnv() === 'dev'`):
  - "downloads a Monthly Report": request a link for `e2e-admin@example.com`, read the newest `oobLink` for that email from the oobCodes endpoint, open it, pick E2E Test Brigade / E2E 3 / previous month, Download; assert the suggested file name `E2E 3-YYYY-MM.pdf` and that the file starts with `%PDF`.
  - "not authorised": sign in as another email (the link creates the user), see "Not authorised" and a UID.
- [ ] 2.13 Docs: `README.md` (admin sign-in, `/admin` routes); `docs/infra-setup.md` (Auth provisioning steps, `SUPERADMIN_UID` bootstrap, the Spark 5 emails a day limit, Auth App Check outcome as TBC until the manual run); #2's "Superadmin setup" line (`gh issue edit 2` after checking its body).

### Test cases

- e2e: the two specs above. Everything else in this phase is thin wrappers covered by e2e and the manual run, as the design says.

### Manual (handed to the user)

The design's "Manual, on `dev`" steps 1–5.
