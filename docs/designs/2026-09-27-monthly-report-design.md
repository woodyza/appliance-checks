# Monthly Report design (#6)

A Monthly Report generated on demand in the browser, replacing the manual monthly PDF export, plus the minimal admin sign-in it needs (superadmin only until #2). Builds on the check entry design (`2026-09-26-check-entry-design.md`) and reuses `src/domain/check.ts`. Terminology follows `CONTEXT.md`.

The format follows `docs/March checks.pdf`, a real 5-Check month: one grid, Items as rows, a Y / N column pair per Check, Monthly Items shaded on weekly Checks, and written and choice values spanning the pair.

## Auth and rules

- Firebase Auth email link. `src/firebase.ts` adds `getAuth`, connecting to the Auth emulator in local dev. `firebase.json` gets an `auth` emulator, and `make dev`, `make e2e` and the emulator scripts run `firestore,auth`.
- `isSuperadmin()` is `request.auth != null && request.auth.uid == 'emulator-superadmin'`:
  - The committed rules hold the emulator's fixed UID, so `make dev` and the rules tests use the file as-is.
  - `make deploy` swaps in the environment's UID (see Deploy). This departs from the issue's "hardcoded in `firestore.rules`": each environment only trusts its own UID, and no UIDs end up in git.
- The superadmin gets:
  - `list` on `brigades`
  - `get` and `list` on `checks` with no date bound
- Admin writes stay denied: the report is read-only. Anonymous rules are unchanged.
- Nothing on the client checks for the superadmin. `/admin` just tries to list brigades, and a `permission-denied` means "not authorised", so the rules are the only source of truth.

## UI and data flow

Routes:

- `/admin/sign-in`: enter an email, see "check your inbox", and complete the link on return.
- `/admin`: pick a brigade (listed), an appliance and a month, then Download.
  - The month picker offers the current month and the 11 before it, defaulting to last month.
  - It has a sign-out link.
- A `requiresAuth` guard waits for the first `onAuthStateChanged` result, then redirects signed-out users to sign-in.
- Landing gets a small "Admin sign-in" link.

Sign-in (`src/state/auth.ts`, `src/views/admin/SignIn.vue`):

- `sendSignInLinkToEmail` with `url: <origin>/admin/sign-in` and `handleCodeInApp: true`. The email is kept in `localStorage`.
- On return, `isSignInWithEmailLink` then `signInWithEmailLink`. If the link opens on another device (no stored email), the page asks for the email again. Then it redirects to `/admin`.
- Default local persistence, so a device stays signed in. That keeps Spark's 5 emails a day bearable (see Notes).

Loading a report:

1. Get the brigade (`checkDay`) and the appliance.
2. List the appliance's Checks with `scheduledDate` in the month.
3. Get each distinct Check Sheet version they use, plus the current one, via the existing in-memory cache.
4. The dates are the union of existing Checks and dates computed from the current `checkDay`. In the current month, computed dates stop at the current window's Check, so future Checks don't show as missing.
5. Build the model, lazy-load the renderer, and download.

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

- **Page and sizes**: A4 portrait with 10mm margins. Sized from the March PDF: label about 70mm, qty 14mm, 21mm per Y / N pair, 7pt text. Labels wrap. With 4 Checks, the pairs widen.
- **Header**: brigade name, Callsign and the month (e.g. "March 2026"). The date row is `dd/MM/yy`, with a small `v3` under each date, since the merged grid otherwise hides which version a Check used. autotable repeats the header rows on every page.
- **Section rows**: grey, repeating "Qty | Y N | Y N …", as in March.
- **Cells**:
  - `yn`: a box in the Y or N column, ticked if answered.
  - `value`: text spanning the pair.
  - `notDue`: dark fill.
  - `na`: light grey "n/a" spanning the pair.
- **Footer**: a % row, reading "Complete" at 100% and "not started" for a missing Check, plus a "Generated dd/MM/yy HH:mm" line.
- **File name**: `<callsign>-<YYYY-MM>.pdf`.
- **Left out**: March's "MISSING - DEFECTS - ISSUES" row. Defects go in the Defects Book, and a Check has no free-text field.

## Provisioning and deploy

New idempotent `make provision` steps:

1. Enable `identitytoolkit.googleapis.com`.
2. Enable the Email provider with `passwordRequired: false`. If firebase-tools has no command for it (TBC), use `PATCH identitytoolkit.googleapis.com/admin/v2/projects/{p}/config`. The default authorised domains already cover `web.app`, `firebaseapp.com` and `localhost`.
3. Try App Check enforcement on Auth (`appcheck:services:set identitytoolkit.googleapis.com enforced`, TBC). It protects `GetOobCode`, the call that sends the email. If it needs the Identity Platform upgrade or billing, drop it and record the accepted risk in `docs/infra-setup.md`.
4. Keep `SUPERADMIN_UID` when rewriting `.env.<env>`, the same way `E2E_APPCHECK_DEBUG_TOKEN` is kept.

`cli/deploy.ts`:

- A pure `substituteSuperadmin(rules, uid)` replaces the `'emulator-superadmin'` literal. It throws unless the literal appears exactly once, so a rules refactor can't silently deploy the emulator UID.
- The result goes to a gitignored `.deploy/firestore.rules`, deployed via a generated config that points at it. Whether `--config` resolves `dist` and the indexes relative to the repo root is TBC. The fallback is temporarily swapping `firebase.json`'s rules path.
- If `SUPERADMIN_UID` is unset, it substitutes `''` (which matches no one) and warns: "no superadmin yet: sign in, copy the UID from the 'not authorised' screen into `.env.<env>`, redeploy". So the first deploy can go out before the UID is known.

## Errors

| Case | Shown |
|---|---|
| Link expired or used (`auth/invalid-action-code`) | "This link has expired. Request another." |
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
    - An Auth emulator user `emulator-superadmin` / `e2e-admin@example.com` (emulator only).
    - A fixture `checkSheetVersions/2` with a v1-only and a v2-only Item.
    - For `e2e1` in the previous month: a Complete Check on v1 and a partial one on v2, with the rest missing. The seed uses the Admin SDK, so the write window doesn't apply.
  - "downloads a Monthly Report":
    1. Request a link.
    2. Read it from the Auth emulator's `oobCodes` endpoint and open it.
    3. Pick E2E Test Brigade, E2E 1 and the previous month, then Download.
    4. Assert the file is named `E2E 1-YYYY-MM.pdf` and starts with `%PDF`. The content is covered by the unit tests.
  - "not authorised": another emulator user signs in and sees the message and their UID.
- Manual, on `dev` (the done-when):
  1. Seed with `make e2e ENV=dev`, whose seed step creates the same previous-month data.
  2. Sign in with a real email, set `SUPERADMIN_UID`, and redeploy.
  3. Download E2E 1 for the previous month. Check:
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

## Out of scope

Brigade Admin and VSO sign-in, and admin user management (#2); emailing reports (#8); the Check Sheet editor (#7); Check Day history; storing generated reports.
