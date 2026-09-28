# Admin users are keyed by verified email, not UID

`adminUsers/{email}` documents use the lower-cased email address as the document id, not the person's Firebase Auth UID. A rule trusts the signed-in user's own token `email` claim directly, once it's marked `email_verified`, to look up their doc and read `brigadeIds`.

This is what lets the superadmin provision a Brigade Admin or VSO by email before that person has ever signed in: a UID doesn't exist until their first sign-in, and there's no "claim your record on first sign-in" step, so no self-service write path is needed for one either. `adminUsers` writes stay superadmin-only with no exceptions.

This only holds because the `email_verified` claim can be trusted. Provisioning enables the Email provider with `passwordRequired: false`, which allows email/password sign-up *alongside* email-link sign-in, so anyone can sign up with an admin's address and a password of their choosing, getting a token whose `email` claim matches but whose `email_verified` is false. App Check on Auth probably means doing it from a real browser on the site rather than a bare API call (unverified), which raises the bar but doesn't remove it. Every email-based rule therefore requires `email_verified == true`.

## Considered Options

- **Keyed by UID**: the issue's own sketch, but there's no UID to key against until the person signs in, so the superadmin couldn't provision access ahead of time without a self-service "claim my record" write on first sign-in: a rule that lets a brand-new user copy a role and `brigadeIds` into a doc keyed by their own UID, which is a riskier shape than superadmin-only writes.
- **Keyed by lower-cased email (chosen)**: no bootstrap step, at the cost of the consequences below.

## Consequences

- If an admin's email changes, the superadmin deletes the old `adminUsers` doc and creates a new one under the new address — a manual step, the same shape as reassigning a user, which the User Admin UI already supports.
- **Accepted risk: account pre-hijacking.** An attacker who signs up with an admin's address and a password *before* that admin's first sign-in shares the admin's account afterwards: checked in the Auth emulator, the admin's later email-link sign-in lands on the attacker's UID and marks it verified, and the attacker's password still signs in with `email_verified: true` — both report `sign_in_provider: "password"`, so the rules can't tell them apart. Accepted for this slice: it needs the admin's email in advance, and admin powers here are read-only (older Checks). Worth revisiting before #7 gives admins writes. The fix is turning sign-up off (an Identity Platform setting, probably needing billing, which fits `prod` moving to Blaze in #8) and having adding an admin also create their Auth account through the Admin SDK, so an account only exists once the superadmin creates it. `docs/infra-setup.md` has the manual check of whether production Firebase behaves like the emulator here.
