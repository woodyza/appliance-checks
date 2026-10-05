# Weekly VSO email design (#8)

A weekly email, first thing on Check Day, so VSOs can follow up missed or partial Checks. Terminology follows `CONTEXT.md`. Builds on the Monthly Report design (`2026-09-27-monthly-report-design.md`) and reuses `src/domain/check.ts`.

Departures from the issue:

- The spending cap and the review of anonymous access versus App Check moved to #23. `dev` is on Blaze already (billing linked); `prod` stays on Spark until #23.
- `dev` goes on Blaze rather than staying on Spark, since deployed functions need it and the done-when runs there.
- #2 has landed, so a brigade without a Report Email falls back to its VSOs instead of being skipped.
- Emails are per recipient, not per brigade: a VSO covering several brigades gets one combined report.
- Brigades can opt out of the email.

## Architecture and schedule

- A `functions/` package with its own `package.json` (firebase-functions v2, firebase-admin, nodemailer), on Node 22, in `australia-southeast1`.
  - It imports `../src/domain/*`, and esbuild bundles it into a gitignored `functions/lib/index.js` as a `firebase.json` predeploy step. Cloud Build installs the runtime dependencies from `functions/package.json`.
  - `functions/` is an npm workspace, so the root `npm install` covers its dependencies, and `make check` lints, typechecks and tests `functions/src` with the root tooling.
- One function, `weeklyVsoEmail`: `onSchedule('0 7 * * *', timeZone: 'Pacific/Auckland')`, so one Scheduler job per project (2 of the billing account's 3 free jobs across dev and prod).
- The handler wraps `sendWeeklyEmails({ db, send, today })`, with `send` injected so tests can capture messages.
- No retries, so a partial failure never double-sends. A run with any failure ends as failed (after logging), which only marks it; nothing is resent.

Each run:

1. `today` comes from `today()` (NZ time).
2. Read the active brigades, and keep those with `checkDay == weekday(today)`. Filtered in memory, since there are only a few brigades.
3. Skip brigades with `weeklyEmail: false`, and build a summary for each remaining brigade. A brigade whose summary can't be built (eg a read fails) is logged and left out.
4. Resolve recipients, group by address, and send one email per address. A failed send is logged with the address and its brigades, and the rest still go out.

Accepted limitation: a Check Day change within the last week can report a phantom 0%, the same as the Monthly Report.

## Weekly summary

Pure, in `src/domain/weeklyEmail.ts`.

- The previous Check is `addDays(today, -7)`. On Check Day it's past its window, so it's Frozen. It's read directly by id: `checks/{applianceId}_{date}`.
- Active Appliances only, sorted by Callsign. Appliances with no Check Sheet (`currentCheckSheetVersion == null`) are left out.
- A missing Check is 0%, shown as "not started".
- An existing Check is scored with `checkPercent` against the version the Monthly Report would use (`renderVersion` + `isFrozen`, which on Check Day is always its stamped version). `monthly` comes from the Check.
- Shown as "Complete" at 100% and "n%" otherwise. Anything under 100% is flagged.
- A brigade with no active Appliances with Check Sheets is skipped and logged.
- It's sent every Check Day, even when everything is Complete: a steady "all complete" email shows the job is alive.

`checkPercent(sections, responses, monthly)` moves into `check.ts`. It returns `floor(answered / due × 100)`, or 0 when nothing is due, which is exactly what `report.ts` computes now. `report.ts` calls it, so the email and the Monthly Report can't disagree.

## Recipients and grouping

For each brigade being sent today:

- Its Report Email (`brigades/{slug}/private/settings`), if set.
- Otherwise, every `adminUsers` entry with `role == 'vso'` whose `brigadeIds` contains the brigade's `brigadeId`.
- If there's neither, the brigade is skipped and logged.

Addresses are lowercased and grouped. Each address gets **one email with one combined report** for all the brigades it's responsible for today. That covers a VSO with several brigades, a shared team address used as several brigades' Report Email, and a Report Email that matches an assigned VSO. All of a run's brigades share the Check Day, so one email never mixes Check dates.

The email:

- Subject: `Appliance checks, Mon 21 Sep: 3 of 7 appliances incomplete`, or `… all complete`. The date is the reported Check's, ie a week before the send.
- One table, Brigade | Appliance | Completion, sorted by brigade name then Callsign. The Brigade cell is only on each brigade's first row, and flagged rows are highlighted. HTML with a plain-text alternative.
- One link to `https://<project>.web.app/admin`. No Brigade Links.

## Brigade email settings

- `weeklyEmail: boolean` in `brigades/{slug}/private/settings`, next to `reportEmail`, and added to `BrigadeSettings`. A missing field means enabled, so existing brigades need no migration; only an explicit `false` turns the email off. It's separate from `active`: an inactive brigade never gets one.
- Nothing sets `reportEmail` today, so a new CLI sets both: `npm run cli:brigade-settings -- --project <env> --brigade <slug> [--report-email <addr> | --clear-report-email] [--weekly-email on|off]`. It uses the usual account guard and prints the settings before and after.
- No rules change: `private/settings` stays Admin SDK only. The UI for both fields belongs in #22.

## Sending, config and deploy

- nodemailer over Gmail SMTP (`smtp.gmail.com:465`), as the dedicated Gmail account.
  - The app password is a Secret Manager secret, `GMAIL_APP_PASSWORD` (`defineSecret`), bound only to `weeklyVsoEmail`.
  - The From address is `defineString('MAIL_FROM')`, in a gitignored `functions/.env.<alias>`, so the address stays out of this public repo.
- `make provision`, new idempotent steps:
  1. Check that billing is enabled on the project. If it isn't, it warns that functions won't deploy and skips the steps below. If gcloud can't read the billing status (eg wrong account or permissions), it fails rather than skipping.
  2. Enable the Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Cloud Scheduler and Secret Manager APIs.
  3. If `GMAIL_APP_PASSWORD` doesn't exist, prompt for it (hidden input) and run `firebase functions:secrets:set`. An existing secret is left alone.
  4. If `MAIL_FROM` is missing from `functions/.env.<alias>`, prompt for it.
  5. Set an Artifact Registry cleanup policy (`firebase functions:artifacts:setpolicy`). Before the first functions deploy there's no repository yet, so this only takes effect on a re-run; the first deploy offers to set one itself.
- `make deploy` adds `functions` to `--only` when billing is enabled, and otherwise skips them with a warning.
- `docs/infra-setup.md`:
  - `dev` on Blaze
  - the Gmail app password (needs 2-Step Verification on the account) and the From address
  - triggering the job by hand (`gcloud scheduler jobs run …`) and finding its logs
  - the sign-in email limit of 25,000 a day on Blaze
  - replacing "Keep `dev` on Spark" with a pointer to #23

## Testing

- Unit, `tests/domain/weeklyEmail.test.ts`, in the `check.test.ts` fixture style:
  - Summary:
    - A Complete, a partial and a missing Check read as Complete, n% (rounded down) and "not started".
    - A monthly Check counts its Monthly Items.
    - An older stamped version is scored against that version.
    - Inactive Appliances and Appliances without a Check Sheet are left out.
  - Recipients:
    - The Report Email wins over VSOs.
    - Without one, it falls back to the brigade's VSOs.
    - With neither, the brigade is skipped.
    - `weeklyEmail: false` is skipped.
  - Grouping:
    - A VSO with two brigades gets one combined email.
    - A shared Report Email combines brigades.
    - Addresses dedupe case-insensitively.
  - Rendering:
    - The subject reads "n of m incomplete" or "all complete".
    - Rows are sorted, the Brigade cell is on first rows only, and flagged rows are marked.
- `checkPercent` is covered by the existing `report.test.ts` percentage cases.
- Emulator, `tests/functions/sendWeeklyEmails.test.ts` (added to the emulator project), with a fake `send`:
  - Only brigades whose Check Day is today get emails.
  - Inactive brigades get none.
  - A failed send for one address doesn't stop the others.
- Emulator, `tests/cli/store.test.ts`: `updateBrigadeSettings` sets and clears the Report Email, sets `weeklyEmail`, and rejects an unknown slug.
- Not tested automatically: the nodemailer wrapper, the `onSchedule` wiring and the provision steps. The `dev` run covers them.
- Manual, on `dev` (the done-when):
  1. `make e2e ENV=dev` seeds E2E Test Brigade with today as its Check Day: a Complete previous Check on E2E 1, a partial one on E2E 2, and E2E 3 unstarted (its seeded Checks are in the previous month's first fortnight).
  2. `cli:brigade-settings --brigade e2etst --report-email <inbox>`. This has to come after seeding, which resets `private/settings`.
  3. `gcloud scheduler jobs run …`.
  4. One email arrives with three rows: Complete, n% flagged, and not started flagged.
  5. The logs show the other `dev` brigades falling back to VSOs, or skipped.

## Changes during implementation

- **Workspace, not a separate install**: `functions/` is an npm workspace rather than `make check` installing its dependencies. One `firebase-admin` is shared by the app, the CLI and the function. `functions/` has no lockfile of its own, so Cloud Build resolves its `^` ranges fresh on each deploy.
- **nodemailer 10**, which ships its own types.
- **Subject date** is the reported Check's date (the approved example read like the send date). Worth a second look if the send date reads better.
- **Failed runs**: the function logs every result, then throws if anything failed, so the run shows as failed; with retries off nothing is resent. The timeout is 300s, since sends run one after another.
- **Billing check fails fast** when gcloud can't read it, instead of treating that as "no billing" and quietly skipping functions (review).
- **Cleanup policy** only applies once functions have deployed once (review).
- **`functions/.env*`** is gitignored, since the Firebase CLI can write `functions/.env.<projectId>`, which would leak the project id (review).
- **Not exercised before the `dev` run**: the provision steps and the deploy's functions branch. Trigger discovery was checked in the functions emulator on Node 26, not the Node 22 runtime.
- **Deploy checks provision ran**: with billing on, `make deploy` stops before deploying anything if the `GMAIL_APP_PASSWORD` secret or `MAIL_FROM` is missing, since deploying before provision was an easy mistake.
- **Open follow-up**: logging results as they happen rather than at the end, so a run killed by the timeout still logs what it sent.

## Out of scope

The billing cap and the review of anonymous access (#23); editing the Report Email and the opt-out in the UI (#22); retries and sent-email records; Check Day history.
