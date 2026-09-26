# Infrastructure setup

How to stand up the `dev` and `prod` Firebase projects from scratch, e.g. for a new Google account. Later slices add steps (Auth in #6, billing and Cloud Functions in #8); they'll be added here.

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

## 2. One-off manual step

A Google account that has never used Firebase has to accept the Firebase terms once: open https://console.firebase.google.com and follow the prompt. Until then, creating a project from the CLI fails.

## 3. Provision each environment

Project ids are globally unique and permanent, and the site is served at `<project-id>.web.app`, so the id is effectively the site's address. For prod, add a random suffix so it can't be guessed (e.g. `appliance-checks-` plus 6 random letters and digits, such as the output of `LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c6`; `make provision` warns if it's missing), and don't publish it: this repo is public, so ids stay out of git. `.firebaserc` is gitignored; keep a note of the ids somewhere private. Keep `dev` on the free Spark plan, so abuse can only take it offline, never cost money.

```bash
make provision ENV=dev PROJECT_ID=<dev project id>
make provision ENV=prod PROJECT_ID=<prod project id>
```

After the first run the id comes from the `.firebaserc` alias, so re-runs are just `make provision ENV=dev`.

For each project this creates, or checks and skips if it's already there:

- the Google Cloud project with Firebase added
- the Firestore, Firebase Rules, Firebase Hosting, App Check, reCAPTCHA Enterprise, Sheets and API Keys APIs
- the `(default)` Firestore database, in `australia-southeast1` unless you pass `REGION=...` (a database's location can't be changed later)
- the default Hosting site
- a Firebase Web app (`appliance-checks-web`) and its SDK config
- a reCAPTCHA Enterprise score key (`appliance-checks-web`, restricted to `<project>.web.app` and `<project>.firebaseapp.com`), registered as the app's App Check provider at a minimum score of 0.3 with a 1h token TTL
- Firestore App Check enforcement, set to `enforced`
- `dev` only: an App Check debug token (display name `appliance-checks-e2e`) for `make e2e ENV=dev`, reusing `E2E_APPCHECK_DEBUG_TOKEN` from an existing `.env.dev` if there is one
- `.env.<env>` (the Firebase web config and reCAPTCHA site key; gitignored, like `.firebaserc` — the config contains the project id)
- a Sheets API key named `appliance-checks-sheets-cli`, restricted to the Sheets API, for the CLI import (a browser import will need its own referrer-restricted key)
- the environment's alias in `.firebaserc` (gitignored; on a new machine, re-running `make provision` recreates it)

It's safe to re-run, e.g. after a step failed or a project was partly set up in the console. The key itself isn't printed; the script ends with the command to load it into your shell as `SHEETS_API_KEY`.

App Check enforcement can take up to 15 minutes to take effect after `make provision` finishes, so wait before relying on it (e.g. before `make e2e ENV=dev` or checking the site in a browser).

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

Two things to check the first time a `dev` project is provisioned and record here:

- **Whether reCAPTCHA Enterprise's free tier works on Spark without a billing instrument.** The Google docs are inconsistent about this. If key creation or the App Check provider setup fails for a billing reason, the fallback is the `recaptcha-v3` provider instead (a small change in `provision.ts` and `src/firebase.ts`).
- **Whether App Check-rejected requests are billed or count against the Spark quota.** Undocumented. To check: script a batch of unattested REST reads against the `dev` project's Firestore (no App Check token), then compare the usage dashboard the next day against a quiet baseline. If they do count, App Check protects the data but not the quota.

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
