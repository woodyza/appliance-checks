# Blaze costs are bounded by a billing kill switch

`dev` and `prod` are on the Blaze plan, which `dailyEmails` and the sign-in email quota need, and Blaze has no spending cap. So each billed project has a budget (10 a month) that publishes to Pub/Sub, and a function that unlinks billing once the reported cost passes it, which drops the project back to Spark: abuse then takes the site offline rather than costing money. It's bounded, not hard: budget data lags by hours (sometimes more than a day), so the worst case is the budget plus whatever accrues in that lag.

Why the console's tools aren't enough (#23, October 2026):

- **Spend cap budgets don't cover us.** They only cover Gemini, Vertex AI, Cloud Run and Cloud Run functions, one project and service per budget. The only one we'd cap is `dailyEmails`, which the public can't trigger. Firestore, Hosting egress, reCAPTCHA Enterprise, Artifact Registry, Secret Manager and Scheduler aren't capped.
- **Hosting is the largest exposure.** App Check doesn't cover it and there's no rate limit. Egress is $0.15/GB after 10 GB a month, and the main chunk is about 790 KB uncompressed, so a day of a 100 Mbps curl loop is about 1 TB, or $150.
- **reCAPTCHA Enterprise moves to Premium once billing is linked:** 10k assessments a month free, a flat $8 up to 100k, then $1 per 1,000, with no cap. Each App Check token exchange is an assessment.
- **App Check raises the bar, but isn't a ceiling.** Tokens are bearer tokens valid for the 1h TTL and Firestore doesn't use limited-use tokens, so one headless browser that passes the 0.3 score can farm tokens for a script. Anonymous Firestore exposure is modest: creates need a real appliance and a date within about two months, so storage is bounded, but the number of reads and updates isn't (a few cents per 100k; each anonymous write also costs a read, for the rule's `get()`).
- **App Check-rejected requests seem to be free, but that's undocumented.** On `dev` (September 2026) a batch of unattested REST reads all got 403s and didn't show up in the next day's billable usage reports. Google only documents that rules-denied requests pay for the rules' `get()`s and the one-read query minimum; App Check rejects before the rules run.
- **TBC:** whether invalid reCAPTCHA tokens sent straight to App Check's exchange endpoint (the API key and app id are public) create billable assessments. The kill switch bounds that either way.

## Considered Options

- **Keep `prod` on Spark** and run `dailyEmails` (and its secrets) in a separate billed project with no public surface, reading `prod`'s Firestore across projects. Hard limits, so abuse can never cost money, but another project to provision and deploy, 5 sign-in emails a day, and a hard 10k/month reCAPTCHA cap that an attacker could use up to knock out App Check for the month.
- **Blaze with budget alert emails only.** Simplest, but unbounded.
- **Blaze with a kill switch (chosen).** One project per environment and the Blaze quotas, at the cost of a bounded bill and an outage when it fires.

## Consequences

- When it fires, the functions stop and the project is on Spark's limits until someone relinks billing by hand and re-runs provision and deploy.
- Provision and deploy need a role on the billing account, not just the project, since budgets belong to the billing account.
- The function runs as its own service account, so only it can unlink billing, not `dailyEmails`.
