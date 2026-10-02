# Admin users are keyed by verified email, not UID

`adminUsers/{email}` documents use the lower-cased email address as the document id, not the person's Firebase Auth UID. A rule trusts the signed-in user's own token `email` claim directly, once it's marked `email_verified`, to look up their doc and read `brigadeIds`.

This is what lets the superadmin provision a Brigade Admin or VSO by email before that person has ever signed in: a UID doesn't exist until their first sign-in, and there's no "claim your record on first sign-in" step, so no self-service write path is needed for one either. `adminUsers` writes stay superadmin-only with no exceptions.

This only holds because the `email_verified` claim can be trusted. Provisioning enables the Email provider with `passwordRequired: false`, which allows email/password sign-up *alongside* email-link sign-in, so anyone can sign up with an admin's address and a password of their choosing, getting a token whose `email` claim matches but whose `email_verified` is false. On `dev`, App Check on Auth rejects a bare API-key sign-up, so it has to be done from a real browser on the site, which raises the bar but doesn't remove it. Every email-based rule therefore requires `email_verified == true`.

## Considered Options

- **Keyed by UID**: the issue's own sketch, but there's no UID to key against until the person signs in, so the superadmin couldn't provision access ahead of time without a self-service "claim my record" write on first sign-in: a rule that lets a brand-new user copy a role and `brigadeIds` into a doc keyed by their own UID, which is a riskier shape than superadmin-only writes.
- **Keyed by lower-cased email (chosen)**: no bootstrap step, at the cost of the consequences below.

## Consequences

- If an admin's email changes, the superadmin deletes the old `adminUsers` doc and creates a new one under the new address — a manual step, the same shape as reassigning a user, which the User Admin UI already supports.
- **Account pre-hijacking isn't a live risk in production, though it is in the emulator.** The worry: someone signs up with an admin's address and a password *before* that admin's first sign-in. The admin's later email-link sign-in lands on that same account (same UID) and marks it verified. Both methods report `sign_in_provider: "password"`, so the rules can't tell them apart.
  - In the Auth emulator, the earlier password still signs in afterwards, with `email_verified: true`.
  - On `dev` (checked October 2026 with `npm run cli:check-prehijack`), production Firebase clears the password on the email-link sign-in, and the old password is rejected (`INVALID_LOGIN_CREDENTIALS`). Until that first link sign-in, the planted account's email is unverified, so the rules deny it anyway.
  - This rests on Firebase's current behaviour, which isn't part of any documented contract we found. If it ever changes, the fix is turning sign-up off (an Identity Platform setting) and having adding an admin also create their Auth account through the Admin SDK, so an account only exists once the superadmin creates it. Worth re-running the check before #7 gives admins writes.
