# Infrastructure setup

How to stand up the `dev` and `prod` Firebase projects from scratch, e.g. for a new Google account. Cloud Functions (the weekly VSO email) need a billing account on the project, so those provision and deploy steps are skipped without one.

## 1. Accounts

Everything runs as whichever account gcloud and the Firebase CLI are logged in as, so check both first:

```bash
gcloud config get-value account
npx firebase login:list
```

If you use gcloud for other work, give this project its own configuration so switching doesn't touch the other one:

```bash
gcloud config configurations create appliance-checks   # creates and activates it
gcloud auth login                                       # pick the account for this project
gcloud config configurations activate default           # to switch back later
```

For the Firebase CLI, run `npx firebase login` (or `npx firebase login:use <email>`) inside the repo: `login:use` pins the account for this directory only. `make provision` refuses to run if the gcloud and Firebase CLI accounts differ, and asks for confirmation before changing anything.

The brigade and import CLI tools use Application Default Credentials instead: `gcloud auth application-default login` as the same account. ADC is machine-wide, not per gcloud configuration, so re-run it when switching; the tools show the ADC account and ask before touching `dev` or `prod`.

## 2. One-off manual steps

A Google account that has never used Firebase has to accept the Firebase terms once: open https://console.firebase.google.com and follow the prompt. Until then, creating a project from the CLI fails.

Each new project also needs Authentication started once in the console. The API can't do it without upgrading the project to Identity Platform. The project doesn't exist until `make provision` creates it, so the first run stops at the Email provider step with `CONFIGURATION_NOT_FOUND`. Then open Authentication in the project's console, click "Get started", and re-run.

## 3. Provision each environment

Project ids are globally unique and permanent, and the site is served at `<project-id>.web.app`, so the id is effectively the site's address. For prod, add a random suffix so it can't be guessed (e.g. `appliance-checks-` plus 6 random letters and digits, such as the output of `LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c6`; `make provision` warns if it's missing), and don't publish it: this repo is public, so ids stay out of git. `.firebaserc` is gitignored; keep a note of the ids somewhere private. `dev` is on the Blaze plan (billing linked), since deployed functions need it and the weekly email's done-when runs there. `prod` stays on the free Spark plan, so abuse can only take it offline, never cost money, until the spending cap and the review of anonymous access in #23 are sorted. Link billing to a project in the console; `make provision` only checks for it.

```bash
make provision ENV=dev PROJECT_ID=<dev project id>
make provision ENV=prod PROJECT_ID=<prod project id>
```

After the first run the id comes from the `.firebaserc` alias, so re-runs are just `make provision ENV=dev`.

For each project this creates, or checks and skips if it's already there:

- the Google Cloud project with Firebase added
- the Firestore, Firebase Rules, Firebase Hosting, App Check, reCAPTCHA Enterprise, Sheets, API Keys and Identity Toolkit (Auth) APIs
- the `(default)` Firestore database, in `australia-southeast1` unless you pass `REGION=...` (a database's location can't be changed later)
- the default Hosting site
- the weekly VSO email's functions setup, only if billing is enabled on the project (otherwise it warns and skips these, see #23):
  - the Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Cloud Scheduler and Secret Manager APIs
  - the `GMAIL_APP_PASSWORD` secret, prompted for with hidden input if it doesn't exist yet (an existing one is left alone). It's an app password for the dedicated Gmail account. Turn on [2-Step Verification](https://myaccount.google.com/signinoptions/twosv) first, then create one at [App passwords](https://myaccount.google.com/apppasswords) (the Security page no longer links to it). Google shows it in four groups of four; paste it without the spaces. To check or replace it later, it's in [Secret Manager](https://console.cloud.google.com/security/secret-manager) for the project
  - `MAIL_FROM`, the sending Gmail address, prompted for if it's missing from `functions/.env.<env>` (gitignored, so the address stays out of this public repo)
  - an Artifact Registry cleanup policy for function images (`firebase functions:artifacts:setpolicy`, 1 day). Before the first functions deploy the repository doesn't exist, so this does nothing until a re-run; the first `make deploy` offers to set one itself
- a Firebase Web app (`appliance-checks-web`) and its SDK config
- a reCAPTCHA Enterprise score key (`appliance-checks-web`, restricted to `<project>.web.app` and `<project>.firebaseapp.com`), registered as the app's App Check provider at a minimum score of 0.3 with a 1h token TTL
- Firestore App Check enforcement, set to `enforced`
- the Auth Email link (passwordless) sign-in provider, via `PATCH identitytoolkit.googleapis.com/admin/v2/projects/{p}/config` (no firebase-tools command enables it). On a new project this fails with `CONFIGURATION_NOT_FOUND` until Authentication has been started in the console (see section 2).
- Auth App Check enforcement, set to `enforced`. It protects the call that sends sign-in emails, so a script can't use up the day's quota. It's best-effort: if it fails, provisioning warns and carries on. On `dev` it went through on Spark, without Identity Platform.
- `dev` only: an App Check debug token (display name `appliance-checks-e2e`) for `make e2e ENV=dev`, reusing `E2E_APPCHECK_DEBUG_TOKEN` from an existing `.env.dev` if there is one
- a browser Sheets API key named `appliance-checks-sheets-web`, restricted to the Sheets API and to the HTTP referrers `https://<project>.web.app/*` and `https://<project>.firebaseapp.com/*` (plus `http://localhost:5173/*` on `dev`), for importing a Google Sheet in the admin UI. It ends up in the bundle by design; the restrictions are its protection. A re-run doesn't update an existing key's referrers (#20). On `dev` (October 2026) importing on the deployed site worked with it
- `.env.<env>` (the Firebase web config, reCAPTCHA site key and browser Sheets key as `VITE_SHEETS_API_KEY`; gitignored, like `.firebaserc` — the config contains the project id). An existing `SUPERADMIN_UID` is kept across re-runs, the same as the debug token.
- a Sheets API key named `appliance-checks-sheets-cli`, restricted to the Sheets API, for the CLI import
- the environment's alias in `.firebaserc` (gitignored; on a new machine, re-running `make provision` recreates it)

Local dev (the emulator) has no browser Sheets key by default, so an import in the admin UI fails with Google's "API key not valid" error. To try one, copy `VITE_SHEETS_API_KEY` from `.env.dev` into a gitignored `.env.development.local` (`dev`'s key allows `http://localhost:5173`).

It's safe to re-run, e.g. after a step failed or a project was partly set up in the console. The key itself isn't printed; the script ends with the command to load it into your shell as `SHEETS_API_KEY`.

### Superadmin UID bootstrap

The superadmin's UID isn't known until they've signed in once, so it can't be provisioned up front:

1. `make deploy ENV=<env>` with no `SUPERADMIN_UID` in `.env.<env>` yet: `firestore.rules` deploys trusting no one (a warning explains this).
2. Sign in at `/admin/sign-in` with the superadmin's real email.
3. The "Not authorised" screen shows the signed-in UID. Copy it into `.env.<env>` as `SUPERADMIN_UID=<uid>`.
4. `make deploy ENV=<env>` again to pick it up.

Firebase Auth's email-link sign-in is capped at 5 emails/day project-wide on the Spark plan (25,000 on Blaze). `dev` is on Blaze now, but `prod` stays on Spark until #23, so the `prod` bootstrap and any testing against a real inbox there should be mindful of that limit.

App Check enforcement can take up to 15 minutes to take effect after `make provision` finishes, so wait before relying on it (e.g. before `make e2e ENV=dev` or checking the site in a browser).

### Checking account pre-hijacking on `dev`

ADR 0005 accepts the risk that signing up with an admin's address and a password, before that admin ever signs in, shares the admin's account afterwards. That's verified in the Auth emulator; production Firebase may behave differently (eg by clearing the password on a later email-link sign-in). To check on `dev`:

```bash
npm run cli:check-prehijack -- --email <a spare address you can receive>
```

It confirms the project and account, refuses an address that's an admin or already has an Auth account, then:

1. tries a password sign-up with the API key alone, to see whether App Check on Auth blocks a bare API call
2. if it does, signs up again with an App Check token from `E2E_APPCHECK_DEBUG_TOKEN` (as a browser on the site would)
3. waits while you sign in at `/admin/sign-in` by link with that address, in a browser, and checks it landed on the same, now-verified account
4. signs in with the password again, and reports whether it still works

It deletes the test account at the end, whatever happens. It uses one of the Spark plan's 5 sign-in emails for the day. "Password still works" means the risk is real in production; "password rejected" means production clears the planted password.

What it showed on `dev` (October 2026): App Check rejected the bare API-key sign-up, and after the email-link sign-in the planted password was rejected (`INVALID_LOGIN_CREDENTIALS`). So production doesn't share the emulator's behaviour here (ADR 0005).

## 4. Deploy and load data

```bash
make deploy ENV=dev
npm run cli:create-brigade -- --project dev --name "Mangawhai" --check-day 1
npm run cli:add-appliance -- --project dev --brigade <slug> --id 8011 --callsign "Mangawhai 8011"
npm run cli:import-check-sheet -- --project dev --brigade <slug> --appliance 8011 --spreadsheet <spreadsheet id>
```

Hosting sends `X-Robots-Tag: noindex, nofollow` and serves a `robots.txt` that disallows everything, so well-behaved crawlers don't index the site even if a link leaks.

`make deploy` also deploys the `weeklyVsoEmail` function when billing is enabled on the project (esbuild bundles it into the gitignored `functions/lib/` first), and otherwise skips it with a warning. If billing is on but provision's functions step hasn't run (no `GMAIL_APP_PASSWORD` secret, or no `MAIL_FROM` in `functions/.env.<env>`), it stops before deploying anything and tells you to run `make provision` first. It replaces Hosting content and Firestore rules. `firestore.indexes.json` is the source of truth for indexes, so if any were created in the console the deploy offers to delete them: answer No unless you mean it.

Appliances and their Check Sheets can also be added in the admin UI instead (`/<slug>/admin`, signed in as the superadmin), including the Google Sheet import.

The spreadsheet id is the long string in the sheet's URL (`/spreadsheets/d/<id>/edit`), and the sheet must be viewable by anyone with the link.

### Weekly VSO email

`weeklyVsoEmail` runs at 07:00 NZ time every day and emails the brigades whose Check Day is that day, covering the previous Check: one email per address, with a row per appliance (Complete, n%, or not started; anything under 100% is highlighted). A brigade goes to its Report Email if it has one, otherwise to the VSOs assigned to it. Brigades can opt out. Per-brigade settings live in `brigades/{slug}/private/settings`, and nothing in the UI edits them yet (#22), so use the CLI:

```bash
npm run cli:brigade-settings -- --project dev --brigade <slug> --report-email <addr>    # or --clear-report-email
npm run cli:brigade-settings -- --project dev --brigade <slug> --weekly-email off       # or on
```

It prints the settings before and after. Run it after `make e2e ENV=dev`, whose seed resets `private/settings`.

To run the job by hand:

```bash
gcloud scheduler jobs run firebase-schedule-weeklyVsoEmail-australia-southeast1 --location australia-southeast1 --project <project id>
npx firebase functions:log --only weeklyVsoEmail --project <env>
```

The logs list each email sent, each brigade skipped (and why) and each failure. The function never retries, so a failed send isn't repeated until the next Check Day.

## 5. E2E against dev

```bash
make e2e ENV=dev
```

Seeds the `e2etst` brigade against `dev` (Admin SDK, behind the account guard), then runs the Playwright specs against `https://<dev project id>.web.app` with the App Check debug token from `.env.dev` injected via `addInitScript`. Requires `make deploy ENV=dev` to have run first, and the enforcement wait above to have passed.

What the first `dev` run showed (September 2026):

- **reCAPTCHA Enterprise works on Spark.** Key creation and the App Check provider setup went through without a billing account, so there's no need for the `recaptcha-v3` fallback.
- **App Check-rejected requests don't seem to count.** A batch of unattested REST reads all got 403s and didn't show up in the billable usage reports the next day, while the e2e and manual traffic did. So App Check looks like it protects the quota as well as the data (going by the usage reports; Google doesn't document it).
- **The debug token works** for `make e2e ENV=dev`, and a real device on iOS Safari (iPad) passed App Check at the 0.3 minimum score.

## Moving to another Google account

**Prefer transferring ownership over reprovisioning.** Projects aren't tied to the account that created them:

1. In the Firebase console for each project, Project settings → Users and permissions → add the new account as Owner.
2. Log gcloud and the Firebase CLI in as the new account and check `make deploy` still works.
3. Remove the old account.

This keeps the data, the `*.web.app` URLs and therefore every printed QR code.

**Reprovisioning** (new projects under the new account) means:

- new project ids: edit the aliases in `.firebaserc` by hand (`make provision` won't repoint an existing alias), then run section 3
- a new Hosting domain, so every appliance's QR code gets reprinted, unless a custom domain sits in front of Hosting
- copying Firestore data across (`gcloud firestore export` / `import` via a Cloud Storage bucket, which needs billing enabled). Brigade Links survive the copy, since the slug is the document id (ADR 0004)
