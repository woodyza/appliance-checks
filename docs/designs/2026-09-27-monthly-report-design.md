# Monthly Report design (#6)

A Monthly Report generated on demand in the browser, replacing the manual monthly PDF export, plus the minimal admin sign-in it needs (superadmin only until #2). Builds on the check entry design (`2026-09-26-check-entry-design.md`) and reuses `src/domain/check.ts`. Terminology follows `CONTEXT.md`.

The format follows `docs/March checks.pdf`, a real 5-Check month: one grid, Items as rows, a Y / N column pair per Check, Monthly Items shaded on weekly Checks, and written and choice values spanning the pair.

## Auth and rules

- Firebase Auth email link. `src/firebase.ts` adds `getAuth`, and in local dev calls `connectAuthEmulator(auth, 'http://127.0.0.1:9099')`. `.env.development` already has an `authDomain`.
- `firebase.json` gets an `auth` emulator on port 9099. `make dev`, `make e2e` and the `emulators` script run `firestore,auth`. `test:emulator` stays `firestore` only, because the rules tests fake auth with `authenticatedContext`.
- `resolveTarget('emulator')` in `cli/lib/target.ts` also sets `FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'`, as it does for Firestore, so the seeds can create Auth users.
- `isSuperadmin()` is `request.auth != null && request.auth.uid == 'emulator-superadmin'`:
  - The committed rules hold the emulator's fixed UID, so `make dev` and the rules tests use the file as-is.
  - `make deploy` swaps in the environment's UID (see Deploy). This departs from the issue's "hardcoded in `firestore.rules`": each environment only trusts its own UID, and no UIDs end up in git.
- The superadmin gets:
  - `list` on `brigades`
  - `get` and `list` on `checks` with no date bound
- Admin writes stay denied: the report is read-only. Anonymous rules are unchanged.
- Nothing on the client checks for the superadmin. `/admin` just tries to list brigades, and a `permission-denied` means "not authorised", so the rules are the only source of truth.

## UI and data flow

Routes (views in `src/views/admin/`). The explicit `/admin` routes go before the slug routes. `admin` can't match the 6-char slug pattern anyway.

- `/admin/sign-in`: enter an email, see "check your inbox", and complete the link on return.
- `/admin` (`ReportView.vue`): pick a brigade, an appliance and a month, then Download.
  - Brigades: every brigade, sorted by name.
  - Appliances: the existing `listAppliances`, which returns active ones only.
  - The month picker offers the current month and the 11 before it, defaulting to last month.
  - It has a sign-out link.
- A `requiresAuth` guard waits for the first `onAuthStateChanged` result, then redirects signed-out users to sign-in.
- Landing gets a small "Admin sign-in" link.

Sign-in (`src/state/auth.ts`, `src/views/admin/SignIn.vue`):

- `sendSignInLinkToEmail` with `url: <origin>/admin/sign-in` and `handleCodeInApp: true`. The email is kept in `localStorage`.
- On return, `isSignInWithEmailLink` then `signInWithEmailLink`. If the link opens on another device (no stored email), the page asks for the email again. Then it redirects to `/admin`.
- Default local persistence, so a device stays signed in. That keeps Spark's 5 emails a day bearable (see Notes).

Loading a report:

Months are `'YYYY-MM'` strings.

1. Get the brigade (`checkDay`) and the appliance.
2. List the appliance's Checks in the month: `applianceId ==`, `scheduledDate >= first of month`, `scheduledDate < first of next month`, `orderBy('scheduledDate')`. The existing composite index covers it.
3. Get each distinct Check Sheet version they use, plus the current one, via `getVersion` (already cached).
4. The dates are the union of existing Checks and dates computed from the current `checkDay`. In the current month, computed dates stop at the current window's Check, so future Checks don't show as missing.
5. Build the model, lazy-load the renderer, and download.

New code:

- `src/data/admin.ts`:
  - `listBrigades()`, returning slug and brigade
  - `listChecksInMonth(slug, applianceId, month)`

  It reuses `getBrigade`, `getAppliance`, `listAppliances` and `getVersion` from `src/data/checks.ts`.
- `src/domain/schedule.ts` gets `firstOfNextMonth(date)`.

Known limitation: a mid-month Check Day change can add phantom 0% columns for the new weekday's earlier dates, because there's no Check Day history. Changes are rare, so this is accepted.

## Report model

`src/domain/report.ts` (pure): `buildMonthlyReport({ brigade, appliance, month, checks, versions, currentVersion, today })`.

- **Columns**: one per date, sorted.
  - Each holds the date, the Check (or `null`), the version it renders against, `monthly`, and a %.
  - The version is `renderVersion(check, isFrozen(...), currentVersion)`, so an unfrozen current-month Check matches what the app shows.
  - % is due Items answered over due Items, via `sectionProgress`. A missing Check is 0%.
  - `monthly` comes from `monthlyFor`, so a missing last-of-month Check still gets the Monthly Items.
- **Rows**: Sections and Items merged across the versions in the month, matched by id.
  - The base is the newest version among the columns, or `currentVersion` if the month has no Checks.
  - Walking older versions, each unplaced Item goes after its predecessor in that version, or first in its Section. Unplaced Sections are placed the same way.
  - Label, qty and input type come from the newest version containing the Item.
  - Items are matched by id across Sections, so an Item moved to another Section shows once, in its newest Section. A Section left empty by moves is dropped.
- **Cells**, per row and column:
  - `na`: the Item isn't in that column's version.
  - `notDue`: a Monthly Item on a weekly Check.
  - `yn`: `Y`, `N` or empty.
  - `value`: a choice or written answer, or empty.
- **How cells are chosen**:
  - The kind comes from the column's own version, so an Item whose input type changed renders correctly per Check.
  - A missing Check uses the base version, so it shows empty cells rather than `na`.
  - Answers for Items not in a column's version are ignored, as in the app.

So a Check answered against an older version fills cells only for that version's Items. After a rename, it shows the newest label.

## PDF

`src/report/pdf.ts`, using jsPDF + jspdf-autotable loaded with a dynamic `import()`, so the Check entry bundle doesn't grow.

- **Page and sizes**: A4 portrait with 10mm margins, greyscale. Sized from the March PDF: label about 70mm, qty 14mm, 7pt text, and the Y / N pairs share the rest (about 21mm each for 5 Checks). Labels wrap. With 4 Checks the pairs widen; with 6 (after a Check Day change) they narrow.
- **Text**: jsPDF's built-in font only covers WinAnsi, so macrons fall back to the base letter (Taupō prints as Taupo).
- **Header**: brigade name, Callsign and the month (e.g. "March 2026"). The date row is `dd/MM/yy`, with a small `v3` under each date, since the merged grid otherwise hides which version a Check used. autotable repeats the header rows on every page.
- **Section rows**: grey, repeating "Qty | Y N | Y N …", as in March.
- **Cells**:
  - `yn`: a box in the Y or N column, ticked if answered.
  - `value`: text spanning the pair.
  - `notDue`: dark fill.
  - `na`: light grey "n/a" spanning the pair.
- **Footer**: a % row on the last page, reading "Complete" at 100% and "not started" for a missing Check, plus a "Generated dd/MM/yy HH:mm" line.
- **File name**: `<callsign>-<YYYY-MM>.pdf`.
- **Left out**: March's "MISSING - DEFECTS - ISSUES" row. Defects go in the Defects Book, and a Check has no free-text field.

## Provisioning and deploy

New idempotent `make provision` steps:

1. Enable `identitytoolkit.googleapis.com`.
2. Enable the Email provider with `passwordRequired: false`. firebase-tools has no command for it, so this is `PATCH identitytoolkit.googleapis.com/admin/v2/projects/{p}/config`. It fails with `CONFIGURATION_NOT_FOUND` until Auth has been started on the project, which `dev` confirmed, so the error says to click Get started in the console once. The default authorised domains already cover `web.app`, `firebaseapp.com` and `localhost`.
3. Try App Check enforcement on Auth, via the App Check REST API as for Firestore. It protects `GetOobCode`, the call that sends the email. It's best-effort: if it fails (eg needs the Identity Platform upgrade or billing), provisioning warns and carries on, and the accepted risk goes in `docs/infra-setup.md`. On `dev` it worked on Spark, with no Identity Platform upgrade, and sign-in works with it enforced.
4. Keep `SUPERADMIN_UID` when rewriting `.env.<env>`, the same way `E2E_APPCHECK_DEBUG_TOKEN` is kept.

`cli/deploy.ts`:

- A pure `substituteSuperadmin(rules, uid)` replaces the `'emulator-superadmin'` literal. It throws unless the literal appears exactly once, so a rules refactor can't silently deploy the emulator UID.
- The result goes to a gitignored `.deploy/firestore.rules`, deployed with `--config` pointing at a generated, gitignored `firebase.deploy.json` at the repo root: `firebase.json` with the rules path swapped. It has to sit at the root because firebase-tools resolves `dist`, the indexes and `.firebaserc` from the config file's directory.
- The substitution runs before the confirm, so a malformed `SUPERADMIN_UID` (anything but letters and digits) fails before anything is built.
- If `SUPERADMIN_UID` is unset, it substitutes `''` (which matches no one) and warns: "no superadmin yet: sign in, copy the UID from the 'not authorised' screen into `.env.<env>`, redeploy". So the first deploy can go out before the UID is known.

## Errors

| Case | Shown |
|---|---|
| Link expired or used (`auth/invalid-action-code`) | "This link has expired. Request another.", with a button back to the email form |
| Stored email doesn't match the link (`auth/invalid-email`) | Asks for the email again |
| `auth/quota-exceeded` | "Sign-in emails are used up for today. Try again tomorrow." |
| Signed in, not superadmin | "Not authorised", plus the UID |
| Appliance has no Check Sheet version | "No Check Sheet yet", with Download disabled |
| A read fails | "Couldn't load the report" toast, with Download left enabled to retry |
| Month with no Checks | Renders as normal: all columns 0% against the current version |

## Testing

- Unit, `tests/domain/report.test.ts`. The fixture is in the `check.test.ts` style, plus a v2 that adds an Item, renames one and removes one.
  - Row merge:
    - A v1-only Item lands after its v1 predecessor.
    - A renamed Item shows v2's label.
    - A v1-only Section is placed after its predecessor.
  - Cells:
    - `na` for an Item not in the column's version.
    - `notDue` for a Monthly Item on a weekly Check.
    - `yn` and `value` carry answers.
    - A stray answer is ignored.
    - A changed input type renders per column.
  - Columns:
    - A missing Check is 0%, with empty cells against the base version.
    - A missing last-of-month Check is monthly.
    - In the current month, dates stop at the current window's Check.
    - Existing Checks from an old Check Day are included.
  - Version choice: an unfrozen current-month Check renders the current version, and a Frozen one its stamped version.
  - A month with no Checks: all 0% against `currentVersion`.
- Unit, CLI: `substituteSuperadmin` replaces the literal, substitutes `''` with no UID, and throws when the literal is missing or duplicated.
- Rules, `tests/rules/firestore.rules.test.ts`:
  - As `emulator-superadmin`: listing `brigades` is allowed, a `checks` list bounded before `firstOfPreviousMonth` is allowed, and `get` on an old Check is allowed.
  - Writes to brigade, appliance and version stay denied.
  - Another signed-in UID gets the anonymous behaviour.
  - The existing anonymous cases are unchanged.
- E2E runs on the emulator only. `ENV=dev` skips it, since there's no inbox a script can read.
  - `e2e-seed` additions:
    - An Auth emulator user `emulator-superadmin` / `e2e-admin@example.com` (emulator only). `dev-seed` creates the same user, so `make dev` can use the admin pages.
    - A third appliance, `e2e3` ("E2E 3"). Its v1 and v2 are separate from `e2e1`/`e2e2`'s fixture, which the check entry specs depend on:
      - v2 has a v1-only Item removed and a v2-only Item added.
      - `currentCheckSheetVersion` is 2.
      - Check that spec 5 ("switches appliance") doesn't assert exactly two appliances.
    - For `e2e3`, on the previous month's first two Check Days: a Complete Check on v1, then a partial one on v2. The rest of the month stays missing.
      - Both are past their windows, so they're Frozen even early in the month. The last Check of a month can still be in its window.
      - The seed uses the Admin SDK, so the write window doesn't apply.
  - "downloads a Monthly Report":
    1. Request a link.
    2. Read it from the Auth emulator's `oobCodes` endpoint and open it.
    3. Pick E2E Test Brigade, E2E 3 and the previous month, then Download.
    4. Assert the file is named `E2E 3-YYYY-MM.pdf` and starts with `%PDF`. The content is covered by the unit tests.
  - "not authorised": another emulator user signs in and sees the message and their UID.
- Manual, on `dev` (the done-when):
  1. Seed with `make e2e ENV=dev`, whose seed step creates the same previous-month data.
  2. Sign in with a real email, set `SUPERADMIN_UID`, and redeploy.
  3. Download E2E 3 for the previous month. Check:
     - it has the mix of Complete, partial and missing Checks
     - the v1 Check shows the v1-only Item and not the v2-only one
  4. Compare by eye with the March PDF, using a real Mangawhai sheet, for widths and paging.
  5. Record whether Auth App Check enforcement worked.
- Not unit-tested: `pdf.ts`, `auth.ts`, data access and the provision steps. They're thin wrappers, covered by e2e and the manual run, as in #5.

## Doc changes

- `README.md`: admin sign-in exists; the `/admin` routes.
- `docs/infra-setup.md`:
  - the Auth provisioning steps
  - the `SUPERADMIN_UID` bootstrap
  - the 5 emails a day Spark limit
  - the Auth App Check outcome
- #2's "Superadmin setup" line: the UID is substituted at deploy from `.env.<env>`, not hardcoded.

## Notes

- Spark allows 5 email-link sign-in emails a day, project-wide; Blaze allows 25,000. `dev` stays on Spark, and prod is on Spark until #8. Anyone who finds the sign-in page could use up the day's emails, which is why Auth App Check is worth trying.
- App Check for Auth covers `GetOobCode` and `SignInWithEmailLink`. The docs don't say whether it needs the Identity Platform upgrade.

Sources:

- https://firebase.google.com/docs/auth/limits
- https://docs.cloud.google.com/identity-platform/docs/admin/app-check-integration
- https://firebase.google.com/docs/app-check/enable-enforcement

## Changes during implementation

- **Moved Items** show once, in their newest Section (the design was silent on moves).
- **% rounds down**, so only a Complete Check reads 100%.
- **The month picker** is backed by a small `recentMonths` helper in `schedule.ts`.
- **Deploy config** sits at the repo root (settles the `--config` TBC; no `firebase.json` swap needed), and the UID is validated before deploying.
- **Provisioning** uses REST for both the Email provider and Auth App Check. Auth App Check is best-effort rather than required. On `dev`, Auth needed a one-off "Get started" in the console, and Auth App Check enforcement worked on Spark.
- **PDF**: greyscale; the pairs narrow for 6 Checks instead of overflowing; the % row is on the last page only; macrons fall back to the base letter. Embedding a Unicode font would fix the macrons properly and is left as a follow-up.
- **Sign-in** recovers from a bad or mismatched link (added in review).
- **ReportView**: an appliance-load failure toasts instead of replacing the picker.
- **Accepted as designed**:
  - Missing columns render against the newest version the month's Checks use. So in the current month, if every existing Check is Frozen on an older version, Items only on the current version don't appear.
  - Auth now loads on the anonymous Check pages too, about +27 kB gzip on the main bundle. It makes no network calls for anonymous users.
- **Open follow-ups**:
  - updating #2's "Superadmin setup" line
  - Unicode font embedding

## Out of scope

Brigade Admin and VSO sign-in, and admin user management (#2); emailing reports (#8); the Check Sheet editor (#7); Check Day history; storing generated reports.
