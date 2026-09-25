# Infrastructure setup

How to stand up the `dev` and `prod` Firebase projects from scratch, e.g. for a new Google account. Later slices add steps (Auth in #6, billing and Cloud Functions in #8); they'll be added here.

## 1. Accounts

Everything runs as whichever account gcloud and the Firebase CLI are logged in as, so check both first:

```bash
gcloud config get-value account
npx firebase login:list
```

Switch with `gcloud config set account <email>` (or `gcloud auth login`) and `npx firebase login:use <email>` (or `npx firebase login`). `make provision` refuses to run if the two differ, and asks for confirmation before changing anything.

The import and brigade CLI tools also use Application Default Credentials: `gcloud auth application-default login` as the same account.

## 2. One-off manual step

A Google account that has never used Firebase has to accept the Firebase terms once: open https://console.firebase.google.com and follow the prompt. Until then, creating a project from the CLI fails.

## 3. Provision each environment

Project ids are globally unique and can't be changed, so pick them first (e.g. `appliance-checks-dev`, `appliance-checks-prod`).

```bash
make provision ENV=dev PROJECT_ID=appliance-checks-dev
make provision ENV=prod PROJECT_ID=appliance-checks-prod
```

For each project this creates, or checks and skips if it's already there:

- the Google Cloud project with Firebase added
- the Firestore, Sheets and API Keys APIs
- the `(default)` Firestore database, in `australia-southeast1` unless you pass `REGION=...` (a database's location can't be changed later)
- the default Hosting site
- a Sheets API key named `appliance-checks-sheets`, restricted to the Sheets API
- the environment's alias in `.firebaserc` (commit it)

It's safe to re-run, e.g. after a step failed or a project was partly set up in the console. The key itself isn't printed; the script ends with the command to load it into your shell as `SHEETS_API_KEY`.

## 4. Deploy and load data

```bash
make deploy ENV=dev
npm run cli:create-brigade -- --project dev --name "Mangawhai" --check-day 1
npm run cli:add-appliance -- --project dev --brigade <slug> --id 8011 --callsign "Mangawhai 8011"
npm run cli:import-check-sheet -- --project dev --brigade <slug> --appliance 8011 --spreadsheet <spreadsheet id>
```

The spreadsheet id is the long string in the sheet's URL (`/spreadsheets/d/<id>/edit`), and the sheet must be viewable by anyone with the link.

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
