# Infrastructure setup

How to stand up the `dev` and `prod` Firebase projects from scratch, e.g. for a new Google account. Later slices add steps (billing and Cloud Functions in #8); they'll be added here.

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

Project ids are globally unique and permanent, and the site is served at `<project-id>.web.app`, so the id is effectively the site's address. For prod, add a random suffix so it can't be guessed (e.g. `appliance-checks-` plus 6 random letters and digits, such as the output of `LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c6`; `make provision` warns if it's missing), and don't publish it: this repo is public, so ids stay out of git. `.firebaserc` is gitignored; keep a note of the ids somewhere private. Keep `dev` on the free Spark plan, so abuse can only take it offline, never cost money.

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
- a Firebase Web app (`appliance-checks-web`) and its SDK config
- a reCAPTCHA Enterprise score key (`appliance-checks-web`, restricted to `<project>.web.app` and `<project>.firebaseapp.com`), registered as the app's App Check provider at a minimum score of 0.3 with a 1h token TTL
- Firestore App Check enforcement, set to `enforced`
- the Auth Email link (passwordless) sign-in provider, via `PATCH identitytoolkit.googleapis.com/admin/v2/projects/{p}/config` (no firebase-tools command enables it). On a new project this fails with `CONFIGURATION_NOT_FOUND` until Authentication has been started in the console (see section 2).
- Auth App Check enforcement, set to `enforced`. It protects the call that sends sign-in emails, so a script can't use up the day's quota. It's best-effort: if it fails, provisioning warns and carries on. On `dev` it went through on Spark, without Identity Platform.
- `dev` only: an App Check debug token (display name `appliance-checks-e2e`) for `make e2e ENV=dev`, reusing `E2E_APPCHECK_DEBUG_TOKEN` from an existing `.env.dev` if there is one
- `.env.<env>` (the Firebase web config and reCAPTCHA site key; gitignored, like `.firebaserc` — the config contains the project id). An existing `SUPERADMIN_UID` is kept across re-runs, the same as the debug token.
- a Sheets API key named `appliance-checks-sheets-cli`, restricted to the Sheets API, for the CLI import (a browser import will need its own referrer-restricted key)
- the environment's alias in `.firebaserc` (gitignored; on a new machine, re-running `make provision` recreates it)

It's safe to re-run, e.g. after a step failed or a project was partly set up in the console. The key itself isn't printed; the script ends with the command to load it into your shell as `SHEETS_API_KEY`.

### Superadmin UID bootstrap

The superadmin's UID isn't known until they've signed in once, so it can't be provisioned up front:

1. `make deploy ENV=<env>` with no `SUPERADMIN_UID` in `.env.<env>` yet: `firestore.rules` deploys trusting no one (a warning explains this).
2. Sign in at `/admin/sign-in` with the superadmin's real email.
3. The "Not authorised" screen shows the signed-in UID. Copy it into `.env.<env>` as `SUPERADMIN_UID=<uid>`.
4. `make deploy ENV=<env>` again to pick it up.

Firebase Auth's email-link sign-in is capped at 5 emails/day project-wide on the Spark plan (25,000 on Blaze); `dev` and `prod` both stay on Spark until #8, so this bootstrap and any testing against a real inbox should be mindful of that limit.

App Check enforcement can take up to 15 minutes to take effect after `make provision` finishes, so wait before relying on it (e.g. before `make e2e ENV=dev` or checking the site in a browser).

### Checking account pre-hijacking on `dev`

ADR 0005 accepts the risk that signing up with an admin's address and a password, before that admin ever signs in, shares the admin's account afterwards — verified in the Auth emulator, but production Firebase may behave differently (e.g. by clearing the password on a later email-link sign-in). To check for real, against `dev`:

1. Sign up a spare address by REST, using `VITE_FIREBASE_API_KEY` from `.env.dev`:
   ```bash
   curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<VITE_FIREBASE_API_KEY>" \
     -H 'Content-Type: application/json' -d '{"email":"<spare address>","password":"<a password>","returnSecureToken":true}'
   ```
   If App Check on Auth rejects this (it's enforced per `make provision`), that's part of the answer already: an attacker can't sign up this way at all.
2. Otherwise, sign in at `/admin/sign-in` with that same address (by link) to simulate the admin's real first sign-in.
3. Sign in again by REST with the password, and decode the returned `idToken` with any JWT decoder:
   ```bash
   curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<VITE_FIREBASE_API_KEY>" \
     -H 'Content-Type: application/json' -d '{"email":"<spare address>","password":"<a password>","returnSecureToken":true}'
   ```
   If it succeeds (the token will say `email_verified: true`), production behaves like the emulator and the risk is real there too. If it fails with invalid credentials, production cleared the password on the email-link sign-in, and the ADR overstates the risk.

Mind the Spark plan's 5 sign-in emails/day limit (above) — this uses one.

## 4. Deploy and load data

```bash
make deploy ENV=dev
npm run cli:create-brigade -- --project dev --name "Mangawhai" --check-day 1
npm run cli:add-appliance -- --project dev --brigade <slug> --id 8011 --callsign "Mangawhai 8011"
npm run cli:import-check-sheet -- --project dev --brigade <slug> --appliance 8011 --spreadsheet <spreadsheet id>
```

Hosting sends `X-Robots-Tag: noindex, nofollow` and serves a `robots.txt` that disallows everything, so well-behaved crawlers don't index the site even if a link leaks.

`make deploy` replaces Hosting content and Firestore rules. `firestore.indexes.json` is the source of truth for indexes, so if any were created in the console the deploy offers to delete them: answer No unless you mean it.

The spreadsheet id is the long string in the sheet's URL (`/spreadsheets/d/<id>/edit`), and the sheet must be viewable by anyone with the link.

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
