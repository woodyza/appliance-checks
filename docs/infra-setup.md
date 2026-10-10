# Infrastructure setup

How to provision and deploy the `dev` and `prod` Firebase projects, e.g. from scratch for a new Google account. Both are meant to be on the Blaze plan, with a billing kill switch (ADR 0007).

## 1. Before you start

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

For the Firebase CLI, run `npx firebase login` (or `npx firebase login:use <email>`, which pins the account for this directory only) inside the repo. `make provision` and `make deploy` refuse to run if the two accounts differ. Nothing about the environments is kept on your machine: the commands find each project by its label and look everything else up in GCP each run, so any machine logged in as an account with access works.

The brigade and import CLI tools write to Firestore with Application Default Credentials, so also run `gcloud auth application-default login` as the same account. ADC is machine-wide, not per gcloud configuration, so re-run it when switching.

### Manual steps

These can't be scripted, and provision stops with a pointer when one is missing:

- **Accept the Firebase terms** once per Google account, at https://console.firebase.google.com. Until then, creating a project from the CLI fails.
- **Start Authentication** once per project: click "Get started" under Authentication in the project's console. The first provision run creates the project and then stops at the Email provider step with `CONFIGURATION_NOT_FOUND` until you do.
- **Link billing** to each project in the console (provision and deploy only check for it, they never link it). Without billing, provision and deploy skip the functions and kill switch, and the project is on Spark's limits, e.g. 5 sign-in emails a day.
- **Billing account roles**: with billing on, provision needs Billing Account Administrator (or Costs Manager) to create the kill switch budget, and deploy needs Billing Account Viewer or higher to check it exists.
- **A Gmail app password** for the dedicated sending account, which provision asks for the first time. Turn on [2-Step Verification](https://myaccount.google.com/signinoptions/twosv) first, then create one at [App passwords](https://myaccount.google.com/apppasswords) (the Security page no longer links to it). Paste it without the spaces.

## 2. Provision

```bash
make provision ENV=dev PROJECT_ID=<dev project id>
make provision ENV=prod PROJECT_ID=<prod project id>
```

Project ids are globally unique and permanent, and the site is served at `<project-id>.web.app`, so the id is effectively the site's address. For prod, add a random suffix so it can't be guessed (e.g. `appliance-checks-` plus the output of `LC_ALL=C tr -dc a-z0-9 </dev/urandom | head -c6`; provision warns if it's missing). This repo is public, so ids stay out of git: provision labels each project `appliance-checks-env=<env>`, and every `dev`/`prod` command finds the project by that label, stopping if there are none or more than one. After the first run, re-runs are just `make provision ENV=<env>`.

Provision asks for confirmation, then creates each of these or checks and skips it. It's safe to re-run, e.g. after a step failed or a project was partly set up in the console.

| Resource | Notes |
| --- | --- |
| GCP project with Firebase, and its APIs | |
| Project label `appliance-checks-env=<env>` | |
| `(default)` Firestore database | `australia-southeast1` unless you pass `REGION=...`; a database's location can't be changed |
| Default Hosting site | |
| Firebase Web app `appliance-checks-web` | |
| reCAPTCHA Enterprise key `appliance-checks-web` | App Check provider, minimum score 0.3, 1h token TTL; restricted to the site's domains |
| App Check enforcement on Firestore and Auth | Auth is best-effort: provision warns and carries on if it fails |
| Auth Email link (passwordless) sign-in | |
| Sheets API keys `appliance-checks-sheets-web` and `appliance-checks-sheets-cli` | Sheets API only. The web key ends up in the bundle, so it's also restricted to the site's origins (plus `http://localhost:5173` on `dev`); a re-run resets those restrictions |
| Billed only: functions APIs, the `GMAIL_APP_PASSWORD` and `MAIL_FROM` secrets, an Artifact Registry cleanup policy (1 day) | Secrets are prompted for if missing; they're in [Secret Manager](https://console.cloud.google.com/security/secret-manager) to check or replace. The cleanup policy needs the repository the first functions deploy creates, so it takes effect on a re-run |
| Billed only: the kill switch (section 5) | Topic `billing-kill-switch`; service account `billing-kill-switch` with Project Billing Manager and Cloud Run Invoker, nothing else; budget `appliance-checks-kill-switch-<env>`. A re-run resets the budget |
| Billed `dev` only: App Check debug token `appliance-checks-e2e` | Stored in the `E2E_APPCHECK_DEBUG_TOKEN` secret, never printed |

App Check enforcement can take up to 15 minutes to take effect after provision, so wait before e2e or checking the site in a browser.

### New environment

1. `make provision ENV=<env> PROJECT_ID=<id>`: it stops at the Auth step.
2. Start Authentication and link billing (section 1).
3. `make provision ENV=<env>` again.
4. Deploy and set up the superadmin (section 3).

## 3. Deploy

```bash
make deploy ENV=<env>
```

Deploys Hosting, the Firestore rules and indexes and, when billing is on, the functions (`dailyEmails` and `billingKillSwitch`). With billing on but any of provision's billed setup missing (secrets, kill switch topic, service account or budget), it stops before deploying anything and says to run `make provision`. Likewise if the web config, reCAPTCHA key or browser Sheets key can't be found.

`firestore.indexes.json` is the source of truth for indexes, so if any were created in the console the deploy offers to delete them: answer No unless you mean it.

To run the daily emails job by hand and read its logs:

```bash
gcloud scheduler jobs run firebase-schedule-dailyEmails-australia-southeast1 --location australia-southeast1 --project <project id>
npx firebase functions:log --only dailyEmails --project <project id>
```

To load data, use the admin UI or the CLI tools in the README.

### Superadmin bootstrap

The superadmin's UID isn't known until they've signed in once, so it's stored in the Firestore doc `deployConfig/superadmin` (which no client can read or write) and deploy puts it into the rules and the build:

1. `make deploy ENV=<env>` with no superadmin yet: the rules deploy trusting no one, with a warning.
2. Sign in at `/admin/sign-in` with the superadmin's real email.
3. `npm run cli:set-superadmin -- --project <env> --email <addr>`.
4. `make deploy ENV=<env>` again.

If the doc can't be read for any reason other than not existing, deploy stops rather than locking the superadmin out.

## 4. E2E against `dev`

```bash
make e2e ENV=dev
```

Seeds the `e2etst` brigade on `dev` and runs the Playwright specs against the deployed site, using the App Check debug token. It needs a billed `dev` that's been provisioned and deployed, and the 15-minute App Check wait.

## 5. Billing kill switch

The `billingKillSwitch` function unlinks billing once the budget's reported cost passes 10 a month (in the billing account's currency), which drops the project to Spark. Budget data lags, so the worst case is the budget plus whatever accrues in that lag. ADR 0007 has the reasoning and the cost exposure. Billing admins get the budget's emails at 50%, 90% and 100% first.

### When it fires

The functions stop (no daily emails) and the project is on Spark's limits. To recover, once the cause is dealt with:

1. Relink billing by hand, in the console or with `gcloud billing projects link <project id> --billing-account=<account id>`.
2. `make provision ENV=<env>` as a check: it recreates anything missing. If it created anything (e.g. a secret), `make deploy ENV=<env>` too, since the functions pin secret versions at deploy.
3. Run the daily emails job by hand (section 3) and, on `dev`, `make e2e ENV=dev`.

If the month's spend is still over the budget, the next notification unlinks billing again. To change the budget, change `KILL_SWITCH_BUDGET` in `cli/provision.ts` and re-run provision.

### Checking it on `dev`

After provisioning and deploying `dev`, note its billing account (you'll need it to relink), then send a fake over-budget notification:

```bash
gcloud billing projects describe <dev project id> --format='value(billingAccountName)'   # billingAccounts/<account id>
gcloud pubsub topics publish billing-kill-switch --project <dev project id> \
  --message '{"budgetDisplayName":"test","costAmount":11,"budgetAmount":10,"currencyCode":"NZD"}'
npx firebase functions:log --only billingKillSwitch --project <dev project id>
gcloud billing projects describe <dev project id> --format='value(billingEnabled)'   # False once it's fired
```

Then recover as above, and check that an under-budget message (`"costAmount":1`) only logs "Under budget".

What the first run on `dev` showed (October 2026): the fake notification unlinked billing, so Project Billing Manager is enough. Nothing was deleted (going by the audit log): the site and Firestore data were unaffected, and the secrets, topic, service account, budget, functions and scheduler job all survived. The functions came back on their own when billing was relinked, so provision only re-applied settings and the redeploy didn't touch them. An under-budget notification only logged "Under budget".

## 6. Moving to another Google account

**Prefer transferring ownership over reprovisioning**, which keeps the data, the `*.web.app` URLs and so every printed QR code:

1. In the Firebase console for each project, Project settings → Users and permissions → add the new account as Owner.
2. Log gcloud and the Firebase CLI in as the new account and check `make deploy` still works. If the projects move to a different billing account too, re-run `make provision` for each: the budget belongs to the old billing account (deploy stops until there's a new one).
3. Remove the old account.

**Reprovisioning** (new projects under the new account) means:

- new project ids: remove the `appliance-checks-env` label from the old projects in the console (IAM & Admin → Labels; provision refuses to label a second project), then run section 2 with `PROJECT_ID`
- a new Hosting domain, so every brigade's QR code gets reprinted, unless a custom domain sits in front of Hosting
- copying Firestore data across (`gcloud firestore export` / `import` via a Cloud Storage bucket). Brigade Links survive the copy, since the slug is the document id (ADR 0004)

## Troubleshooting

- **`CONFIGURATION_NOT_FOUND` from provision**: Authentication hasn't been started on the project (section 1).
- **"Error generating the service identity for pubsub.googleapis.com" on a functions deploy**: re-run it. On `dev` (October 2026) it was transient.
- **App Check rejects requests just after provisioning**: enforcement can take up to 15 minutes.
